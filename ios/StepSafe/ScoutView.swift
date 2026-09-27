import ARKit
import SceneKit
import SwiftUI
import UIKit

/// Walker (audio-first, slice 1 screen), Scout (sighted, phone in hand; PLAN.md 3.2) and Community tabs.
struct RootView: View {
    private enum Tab: String, Hashable { case walker, scout, community }

    @ObservedObject var model: AppModel
    /// Walker unless launched with `-tab community` (demo and screenshots).
    @State private var tab = Tab(rawValue: UserDefaults.standard.string(forKey: "tab") ?? "") ?? .walker

    var body: some View {
        TabView(selection: $tab) {
            ContentView(model: model)
                .tabItem { Label("Walker", systemImage: "figure.walk") }
                .tag(Tab.walker)
            ScoutView(model: model, cameraLive: tab == .scout)
                .tabItem { Label("Scout", systemImage: "camera.viewfinder") }
                .tag(Tab.scout)
            CommunityView(api: model.link.api, walkerRunning: model.running, visible: tab == .community)
                .tabItem { Label(TTSChoice.lang() == "es" ? "Comunidad" : "Community", systemImage: "person.3") }
                .tag(Tab.community)
        }
        .tint(Color.control)
    }
}

/// What a tap copied out of the current ARFrame. Holds no reference to the frame.
struct ScoutCapture {
    /// Pixels around the tap, copied out of capturedImage (rendered and encoded off the main thread).
    var region: CVPixelBuffer
    /// LiDAR depth at the tap, as an AR world point; nil when there was no depth there.
    var world: SIMD3<Float>?

    /// Main thread, straight from session.currentFrame; the frame is not kept.
    static func take(_ frame: ARFrame, tap: CGPoint, viewSize: CGSize) -> ScoutCapture? {
        let res = frame.camera.imageResolution
        // View point -> normalized image point (aspect fill, portrait).
        let n = CGPoint(x: tap.x / viewSize.width, y: tap.y / viewSize.height)
            .applying(frame.displayTransform(for: .portrait, viewportSize: viewSize).inverted())
        let pixel = CGPoint(x: n.x * res.width, y: n.y * res.height)
        guard let region = FrameCrop.copyRegion(frame.capturedImage, rect: CropMath.around(pixel, imageSize: res)) else { return nil }
        var world: SIMD3<Float>?
        if let depth = frame.sceneDepth?.depthMap, let d = sample(depth, at: n), d > 0.2, d < 8 {
            let k = frame.camera.intrinsics
            let x = (Float(pixel.x) - k.columns.2.x) / k.columns.0.x * d
            let y = -(Float(pixel.y) - k.columns.2.y) / k.columns.1.y * d // PathGuard's camera convention
            let p = frame.camera.transform * SIMD4(x, y, -d, 1)
            world = SIMD3(p.x, p.y, p.z)
        }
        return ScoutCapture(region: region, world: world)
    }

    private static func sample(_ buffer: CVPixelBuffer, at n: CGPoint) -> Float? {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let u = Int(n.x * CGFloat(w)), v = Int(n.y * CGFloat(h))
        guard (0..<w).contains(u), (0..<h).contains(v), let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        let row = base.advanced(by: v * CVPixelBufferGetBytesPerRow(buffer)).assumingMemoryBound(to: Float32.self)
        return row[u]
    }
}

final class ScoutModel: ObservableObject, @unchecked Sendable { // main-confined; tasks hop back to main
    struct Report { var id: String; var label: String; var merged: Bool }

    @Published var band = "ground"
    @Published var status = ScoutStatus.prompt
    @Published var report: Report?
    /// Hazard types for the correction picker; nil until loaded.
    @Published var taxonomy: [HazardTypeEntry]?
    @Published var taxonomyFailed = false
    let lang = TTSChoice.lang()
    @Published var nearby: [NearHazard] = []
    /// /near: idle until a fix exists, then loading, loaded, or failed. Empty is only `loaded`.
    enum NearbyPhase { case idle, loading, loaded, failed }
    @Published private(set) var nearbyPhase: NearbyPhase = .idle
    @Published var busy = false
    /// Same gate as Community: stay quiet while Walker is scanning.
    var walkerRunning = false
    /// False on the other tabs. The report task can finish after Scout is no longer showing.
    var scoutVisible = false

    private let link: ServerLink
    /// True until the first fix is observed. The GPS retry and the prompt restore read this, not `status`.
    private var awaitingFirstFix = true
    private var nearToken = 0
    /// Last report text considered for VoiceOver, so one transition is not spoken twice.
    private var spoken: String?
    init(link: ServerLink, scoutVisible: Bool = false, walkerRunning: Bool = false) {
        self.link = link
        self.scoutVisible = scoutVisible
        self.walkerRunning = walkerRunning
    }

    var hasFix: Bool { link.localizer.fix != nil }
    /// True while /near is in flight. A later GPS wake must not start a second request.
    var nearPending: Bool { nearbyPhase == .loading }

    func submit(_ capture: ScoutCapture) {
        guard let fix = capture.world.flatMap(link.localizer.locate) ?? link.localizer.fix else {
            status = .noFixForReport
            return
        }
        awaitingFirstFix = false
        busy = true
        report = nil
        spoken = nil // a new report speaks even when the words match the last one
        status = .message("Reporting, naming can take 15 seconds")
        speak(status.text)
        let band = band, heading = link.localizer.heading, api = link.api, map = link.map
        Task {
            do {
                guard let jpeg = FrameCrop.render(capture.region).flatMap(FrameCrop.jpeg) else { throw URLError(.cannotDecodeContentData) }
                let r = try await api.report(crop: jpeg, lat: fix.lat, lng: fix.lng, heading: heading, heightBand: band)
                DispatchQueue.main.async {
                    if !r.id.isEmpty { map.markOwn(r.id) } // never passively downvote our own pin
                    self.report = r.id.isEmpty ? nil : Report(id: r.id, label: r.label, merged: r.merged) // no pin to correct
                    self.status = .message(r.id.isEmpty ? "Not pinned: \(r.label)" : r.merged ? "Added to existing pin: \(r.label)" : "Reported: \(r.label)")
                    self.busy = false
                    self.speak(self.status.text)
                    self.refresh()
                }
            } catch {
                DispatchQueue.main.async {
                    self.status = .message("Report failed: \(error.localizedDescription)")
                    self.busy = false
                    self.speak(self.status.text)
                }
            }
        }
    }

    func loadTaxonomy() {
        guard taxonomy == nil else { return }
        let api = link.api
        Task {
            let entries = try? await api.getTaxonomy()
            DispatchQueue.main.async {
                self.taxonomy = entries
                self.taxonomyFailed = entries == nil
            }
        }
    }

    func name(_ pin: NearHazard) -> String {
        Taxonomy.displayName(type: pin.type, label: pin.label, in: taxonomy, lang: lang)
    }

    /// Propose taxonomy type `entry` for hazard `id` (the last report, or a nearby row).
    func correct(_ id: String, to entry: HazardTypeEntry) {
        let api = link.api, name = entry.name(lang: lang)
        Task {
            let r = try? await api.reclassify(id, type: entry.id)
            DispatchQueue.main.async {
                self.status = .message(r.map { $0.applied ? "Type changed to \(name)" : "Proposed \(name) (\($0.agreeing) of 3 agree)" }
                    ?? "Correction failed")
                self.spoken = nil
                self.speak(self.status.text)
                self.refresh()
            }
        }
    }

    func refresh() {
        guard let fix = link.localizer.fix else {
            // No fix yet. Callers keep retrying off `hasFix`, so a rewritten status must not matter here.
            if awaitingFirstFix && !busy && report == nil { status = .waitingForGPS }
            return
        }
        if awaitingFirstFix {
            awaitingFirstFix = false
            if !busy && report == nil { status = .prompt } // first fix: back to the instruction
        }
        nearToken += 1
        let token = nearToken
        nearbyPhase = .loading
        let api = link.api, heading = link.localizer.heading
        Task {
            do {
                let rows = try await api.near(lat: fix.lat, lng: fix.lng, radiusM: MapTuning.scoutRadiusM, heading: heading)
                DispatchQueue.main.async {
                    guard token == self.nearToken else { return }
                    self.nearby = rows
                    self.nearbyPhase = .loaded
                }
            } catch {
                DispatchQueue.main.async {
                    guard token == self.nearToken else { return }
                    self.nearbyPhase = .failed
                }
            }
        }
    }

    /// Posted at a terminal report change, not from `body`, so a re-render does not repeat it.
    /// Remembered even when dropped, so a report that finishes during Walker is not spoken later.
    private func speak(_ text: String) {
        guard text != spoken else { return }
        spoken = text
        postVoiceOverAnnouncement(text, walkerRunning: walkerRunning, tabVisible: scoutVisible)
    }

    /// Hazard ids with a vote being sent (both buttons disabled), as in Community.
    @Published private(set) var voting: Set<String> = []

    /// One vote per hazard per device, the same store Community uses.
    let votes = VoteStore.shared

    /// "up" / "down" once this device voted on the hazard, from either tab.
    func myVote(_ id: String) -> String? { votes.vote(id) }

    /// Same rules as the Community detail: one vote per hazard, a fresh accurate fix, disabled while sending,
    /// and the result spoken through the Walker and tab gate.
    func vote(_ pin: NearHazard, up: Bool) {
        guard myVote(pin.id) == nil, !voting.contains(pin.id) else { return }
        let name = name(pin)
        guard let q = link.localizer.fixQuality,
              Community.canVote(from: link.localizer.fix, accuracyM: q.accuracyM, ageS: q.ageS, to: pin.fix) else {
            // Same distinctions as Community: no fix yet, a fix too weak or old to count, or too far away.
            let fix = link.localizer.fixQuality
            announce(.message(fix == nil ? "Waiting for GPS to vote on \(name)"
                              : !Community.fixUsable(accuracyM: fix!.accuracyM, ageS: fix!.ageS)
                                ? "GPS too weak to vote on \(name). Try again in the open"
                                : "Get closer to vote on \(name)"))
            return
        }
        voting.insert(pin.id)
        let api = link.api
        Task {
            let ok = (try? await api.vote(pin.id, up: up, source: "scout")) != nil
            DispatchQueue.main.async {
                self.voting.remove(pin.id)
                if ok { self.votes.record(pin.id, up: up) }
                self.announce(.message(ok ? (up ? "Marked still there by you: " : "Marked gone by you: ") + name
                                          : "Vote failed: \(name)"))
                self.refresh()
            }
        }
    }

    private func announce(_ s: ScoutStatus) {
        status = s
        spoken = nil // the same words after a new action are still news
        speak(s.text)
    }
}

/// The shared AR session's camera feed; a tap reports what is under the finger.
struct ARPreview: UIViewRepresentable {
    let session: ARSession
    /// False on the Walker tab. The shared ARSession keeps running for path guard; this view stops drawing.
    var cameraLive: Bool
    let onTap: (ScoutCapture) -> Void

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session // the delegate stays SensorSession
        view.automaticallyUpdatesLighting = false
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap)))
        view.isAccessibilityElement = true
        view.accessibilityLabel = "Camera"
        view.accessibilityHint = "Double tap to report what is in the middle of the view"
        view.accessibilityTraits = .button
        setLive(view, cameraLive)
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {
        context.coordinator.onTap = onTap
        setLive(view, cameraLive)
    }

    /// Stops the SceneKit render loop only. Does not pause `session` (path guard still owns it).
    private func setLive(_ view: ARSCNView, _ live: Bool) {
        view.rendersContinuously = live
        view.isPlaying = live
        view.scene.isPaused = !live
    }
    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

    final class Coordinator: NSObject {
        var onTap: (ScoutCapture) -> Void
        init(onTap: @escaping (ScoutCapture) -> Void) { self.onTap = onTap }

        @objc func tap(_ g: UITapGestureRecognizer) {
            guard let view = g.view as? ARSCNView, let frame = view.session.currentFrame,
                  let capture = ScoutCapture.take(frame, tap: g.location(in: view), viewSize: view.bounds.size) else { return }
            onTap(capture)
        }
    }
}

struct ScoutView: View {
    @ObservedObject var model: AppModel
    /// Walker tab keeps this view around; the camera preview should not keep rendering there.
    var cameraLive: Bool
    @StateObject private var scout: ScoutModel
    @State private var startedSession = false
    /// The hazard whose type is being corrected (sheet shown while set).
    @State private var picking: PickTarget?
    @Environment(\.dynamicTypeSize) private var typeSize

    struct PickTarget: Identifiable { let id: String; let name: String }

    init(model: AppModel, cameraLive: Bool = true) {
        self.model = model
        self.cameraLive = cameraLive
        _scout = StateObject(wrappedValue: ScoutModel(link: model.link, scoutVisible: cameraLive, walkerRunning: model.running))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Text("Scout").font(.largeTitle.bold()).foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
                ARPreview(session: model.sensors.session, cameraLive: cameraLive) { capture in
                    if !scout.busy { scout.submit(capture) }
                }
                .frame(height: 380)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                Picker("Height", selection: $scout.band) {
                    Text("Ground").tag("ground")
                    Text("Head height").tag("head")
                    Text("Drop-off").tag("dropoff")
                }
                .pickerStyle(.segmented)
                .accessibilityLabel("Height of the hazard")
                Text(scout.status.text)
                    .font(.title3).foregroundStyle(.white).multilineTextAlignment(.center)
                    .accessibilityAddTraits(.updatesFrequently)
                if let report = scout.report { correctButton(PickTarget(id: report.id, name: report.label), wide: true) }
                if scout.taxonomyFailed {
                    Text("Types unavailable").foregroundStyle(Color.slate)
                }
                nearbyList
            }
            .padding(16)
        }
        .background(Color.navy.ignoresSafeArea())
        .onAppear {
            model.link.setScout(true)
            if !model.running && SensorSession.isSupported { model.sensors.start(); startedSession = true }
            scout.refresh()
            scout.loadTaxonomy()
        }
        .onChange(of: model.running, initial: true) { scout.walkerRunning = model.running }
        .onChange(of: cameraLive, initial: true) { scout.scoutVisible = cameraLive }
        // Poll the localizer, not `status`. A tap before the first fix rewrites the status string
        // and must not stop this. When a fix is in and /near is not already pending, refresh once.
        .task {
            while !Task.isCancelled && !scout.hasFix {
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
            guard !Task.isCancelled, scout.hasFix, !scout.nearPending else { return }
            scout.refresh()
        }
        .sheet(item: $picking) { target in
            TypePicker(title: target.name, entries: scout.taxonomy ?? [], lang: scout.lang) { entry in
                picking = nil
                scout.correct(target.id, to: entry)
            } cancel: { picking = nil }
        }
        .onDisappear {
            model.link.setScout(false)
            if startedSession && !model.running { model.sensors.stop() }
            startedSession = false
        }
    }

    /// Opens the type picker; hidden until the taxonomy loaded (and when it failed).
    @ViewBuilder
    private func correctButton(_ target: PickTarget, wide: Bool = false) -> some View {
        if scout.taxonomy != nil {
            Button { picking = target } label: {
                Label(wide ? "Correct type" : "", systemImage: "pencil")
                    .labelStyle(wide ? AnyLabelStyle(.titleAndIcon) : AnyLabelStyle(.iconOnly))
                    .font(wide ? .title3.bold() : .title2)
                    .frame(maxWidth: wide ? .infinity : nil)
                    .frame(minWidth: 56, minHeight: 56)
                    .background(wide ? Color.control : Color.navy, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
            }
            .accessibilityLabel("Correct type: \(target.name)")
        }
    }

    private var nearbyList: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Nearby, 650 ft").font(.headline).foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button { scout.refresh() } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }
                    .accessibilityLabel("Refresh nearby hazards")
                    .disabled(scout.nearPending)
            }
            if scout.nearbyPhase == .loading {
                ProgressView("Loading hazards")
                    .tint(Color.slate)
                    .foregroundStyle(Color.slate)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if scout.nearbyPhase == .failed {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Could not load nearby hazards").foregroundStyle(Color.slate)
                    Button("Try again") { scout.refresh() }
                        .font(.headline)
                        .frame(minHeight: 44)
                        .foregroundStyle(Color.control)
                }
            } else if scout.nearbyPhase == .loaded, scout.nearby.isEmpty {
                Text("No hazards nearby").foregroundStyle(Color.slate)
            }
            ForEach(scout.nearby) { pin in
                // Buttons drop below the text at accessibility sizes instead of squeezing it.
                let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                                                          : AnyLayout(HStackLayout(spacing: 8))
                layout {
                    // Same formatting as the Community list: Sample badge, "220 feet · ground · confidence 3".
                    VStack(alignment: .leading, spacing: 4) {
                        let titleRow = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                                                                    : AnyLayout(HStackLayout())
                        titleRow {
                            Text(scout.name(pin)).foregroundStyle(.white)
                            if pin.sample == true {
                                Text("Sample").font(.caption.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.slate, in: Capsule()).foregroundStyle(Color.navy)
                            }
                        }
                        Text([pin.distanceM.map { Community.distance($0) }, Community.band(pin.heightBand).lowercased(),
                              "confidence " + Community.confidence(pin.confidence)]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(Color.slate)
                    }
                    .accessibilityElement(children: .combine)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 8) {
                        voteButton(pin, up: true)
                        voteButton(pin, up: false)
                        correctButton(PickTarget(id: pin.id, name: scout.name(pin)))
                    }
                }
                .padding(8)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func voteButton(_ pin: NearHazard, up: Bool) -> some View {
        let mine = scout.myVote(pin.id)
        let sending = scout.voting.contains(pin.id)
        return Button { scout.vote(pin, up: up) } label: {
            Image(systemName: up ? "hand.thumbsup.fill" : "hand.thumbsdown.fill")
                .font(.title2)
                .frame(minWidth: 56, minHeight: 56) // grows with the symbol at large text sizes
                // Navy well inside the card: #087FF5 is 4.66:1 on it (2.96:1 on the old white-10% surface).
                .background(Color.navy, in: RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(up ? Color.control : Color.white) // orange is for hazards, not controls
        }
        .disabled(sending || mine != nil)
        .opacity(sending || (mine != nil && mine != (up ? "up" : "down")) ? 0.4 : 1) // your vote stays bright
        .accessibilityLabel(up ? "Still there: \(scout.name(pin))" : "Gone: \(scout.name(pin))")
        .accessibilityValue(mine == (up ? "up" : "down") ? "Marked by you" : "")
    }
}

/// Scout status line. GPS states are cases, not strings, so code never compares display text.
enum ScoutStatus: Equatable {
    case prompt
    case waitingForGPS
    /// A camera tap arrived before the first fix.
    case noFixForReport
    /// Report, vote and correction results.
    case message(String)

    var text: String {
        switch self {
        case .prompt: return "Tap an obstacle to report it"
        case .waitingForGPS: return "Waiting for GPS"
        case .noFixForReport: return "No GPS fix yet, try again outdoors"
        case .message(let m): return m
        }
    }
}

/// Type-erased label style, so one button can switch between icon-only and title + icon.
struct AnyLabelStyle: LabelStyle {
    private let make: (Configuration) -> AnyView
    init<S: LabelStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// Searchable list of taxonomy types (shown in the phone's language); picking one sends its id.
/// With `propose` set it also offers category and height band, sent as one proposal with the type (the server
/// keeps one proposal per device, and applies it once 3 devices sent the same one).
struct TypePicker: View {
    let title: String
    let entries: [HazardTypeEntry]
    let lang: String
    let pick: (HazardTypeEntry) -> Void
    let cancel: () -> Void
    /// (type, category, heightBand); nil fields stay unchanged.
    var propose: ((HazardTypeEntry?, String?, String?) -> Void)? = nil
    @State private var query = ""
    @State private var category = ""
    @State private var band = ""

    private func t(_ en: String, _ es: String) -> String { lang == "es" ? es : en }

    var body: some View {
        NavigationStack {
            List {
                if let propose {
                    Section {
                        Picker(t("Category", "Categoría"), selection: $category) {
                            Text(t("Unchanged", "Sin cambio")).tag("")
                            Text(t("Moving", "Móvil")).tag("moving")
                            Text(t("Temporary", "Temporal")).tag("temporary")
                            Text(t("Permanent", "Permanente")).tag("permanent")
                        }
                        Picker(t("Height", "Altura"), selection: $band) {
                            Text(t("Unchanged", "Sin cambio")).tag("")
                            Text(t("Ground", "Suelo")).tag("ground")
                            Text(t("Head height", "Altura de la cabeza")).tag("head")
                            Text(t("Drop-off", "Desnivel")).tag("dropoff")
                        }
                        if !category.isEmpty || !band.isEmpty {
                            Button(t("Propose without changing the type", "Proponer sin cambiar el tipo")) {
                                propose(nil, category.nilIfEmpty, band.nilIfEmpty)
                            }
                        }
                    } footer: {
                        Text(t("Or pick a type below. Changes apply once 3 people agree.",
                               "O elige un tipo abajo. Se aplica cuando 3 personas coinciden."))
                    }
                }
                ForEach(Taxonomy.search(entries, query, lang: lang)) { entry in
                    Button {
                        if let propose { propose(entry, category.nilIfEmpty, band.nilIfEmpty) } else { pick(entry) }
                    } label: {
                        Text(Spoken.capitalized(entry.name(lang: lang)))
                            .font(.title3)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .accessibilityHint(t("Proposes this type", "Propone este tipo"))
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: t("Search types", "Buscar tipos"))
            .navigationTitle(t("Type of \(title)", "Tipo de \(title)"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("Cancel", "Cancelar"), action: cancel) } }
        }
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
