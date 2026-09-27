import MapKit
import SwiftUI
import UIKit

/// Community tab: hazards within 1 mile (list first, map for sighted helpers), live over SSE, with detail,
/// in-person votes, reclassify and report. Never touches the Walker's audio, AR session or location manager:
/// it runs its own Localizer while visible.
@MainActor
final class CommunityModel: ObservableObject {
    @Published var pins: [NearHazard] = []
    @Published var fix: Geo.Fix?
    @Published var heading: Double?
    @Published var user: UserInfo?
    @Published var taxonomy: [HazardTypeEntry]?
    @Published var status: String?
    /// False until the first nearby answer, so the empty row does not flash before it.
    @Published var loaded = false
    /// Hazard ids with a vote being sent (both buttons disabled).
    @Published private(set) var voting: Set<String> = []
    /// Hazard id -> "up"/"down": one vote per hazard per device.
    @Published private(set) var voted: [String: String] = UserDefaults.standard.dictionary(forKey: CommunityModel.votedKey) as? [String: String] ?? [:]

    static let votedKey = "communityVotes"
    let api: APIClient
    let lang = TTSChoice.lang()
    private let localizer = Localizer()
    private var tasks: [Task<Void, Never>] = []
    private var live = false
    private var fetchedAt: Geo.Fix?
    /// The reconnect catch-up refresh; a newer one cancels it so a stale answer never lands last.
    private var catchUp: Task<Void, Never>?
    /// While the Walker session runs, VoiceOver announcements from this tab stay quiet so they never talk
    /// over its hazard alerts (the status text still updates).
    var walkerRunning = false

    init(api: APIClient) { self.api = api }

    func t(_ en: String, _ es: String) -> String { lang == "es" ? es : en }

    func name(type: String, label: String?) -> String {
        Taxonomy.displayName(type: type, label: label, in: taxonomy, lang: lang)
    }

    func rowLabel(_ pin: NearHazard) -> String {
        Community.rowLabel(name: name(type: pin.type, label: pin.label), sample: pin.sample == true, confidence: pin.confidence,
                           walker: fix, pin: pin.fix, distanceM: pin.distanceM, heading: heading, lang: lang)
    }

    func start() {
        guard tasks.isEmpty else { return }
        localizer.start()
        tasks = [
            Task { [weak self] in await self?.trackLocation() },
            Task { [weak self] in await self?.listen() },
            Task { [weak self] in await self?.pollWhileOffline() },
            Task { [weak self] in await self?.loadStatic() },
        ]
    }

    func stop() {
        tasks.forEach { $0.cancel() }
        tasks = []
        catchUp?.cancel()
        catchUp = nil
        live = false
        localizer.stop()
    }

    /// Fix and heading, once a second; the heading only moves the rows when it turns a clock hour's worth.
    /// Rows re-sort by live distance on every new fix; the list is refetched after moving 200 m.
    private func trackLocation() async {
        while !Task.isCancelled {
            if let f = localizer.fix, fix.map({ Geo.distance($0, f) > 5 }) ?? true {
                fix = f
                resort()
                if fetchedAt.map({ Geo.distance($0, f) > Community.refetchMovedM }) ?? true { await refresh() }
            }
            let h = localizer.heading
            if (h == nil) != (heading == nil) || abs(Geo.relative(h ?? 0, to: heading ?? 0)) >= 15 { heading = h }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func resort() {
        guard let fix else { return }
        for i in pins.indices { pins[i].distanceM = Geo.distance(fix, pins[i].fix) }
        pins.sort { ($0.distanceM ?? .infinity) < ($1.distanceM ?? .infinity) }
    }

    private func loadStatic() async {
        if taxonomy == nil { taxonomy = try? await api.getTaxonomy() }
        user = try? await api.user()
    }

    func refresh() async {
        guard let fix else { status = t("Waiting for GPS", "Esperando GPS"); return }
        do {
            let fresh = try await api.near(lat: fix.lat, lng: fix.lng, radiusM: Community.radiusM, heading: heading)
                .filter(\.isActive)
            guard !Task.isCancelled else { return }
            pins = fresh
            fetchedAt = fix
            resort()
            loaded = true
            status = nil
        } catch {
            guard !Task.isCancelled else { return }
            status = t("Server unreachable", "Servidor no disponible")
        }
    }

    /// SSE with exponential backoff (1 s up to 30 s). The backoff resets only after a hazard event or 10 s open,
    /// so a server that answers 200 and drops at once is not hammered.
    private func listen() async {
        var delay: Double = 1
        while !Task.isCancelled {
            var openedAt: Date?
            do {
                for try await event in api.events() {
                    if event == .open { openedAt = Date() } else { delay = 1 }
                    apply(event)
                }
            } catch {}
            if let openedAt, Date().timeIntervalSince(openedAt) >= 10 { delay = 1 }
            live = false
            try? await Task.sleep(for: .seconds(delay))
            delay = min(delay * 2, 30)
        }
    }

    /// The 15 s poll runs only while SSE is down.
    private func pollWhileOffline() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(Community.pollSeconds))
            if !live, !Task.isCancelled { await refresh() }
        }
    }

    private func apply(_ event: Community.Event) {
        switch event {
        case .open:
            live = true
            catchUp?.cancel() // catch up on what changed while disconnected
            catchUp = Task { [weak self] in await self?.refresh() }
        case .remove(let id):
            pins.removeAll { $0.id == id }
        case .upsert(var h):
            let d = fix.map { Geo.distance($0, h.fix) }
            guard h.isActive, let d, d <= Community.radiusM else { pins.removeAll { $0.id == h.id }; return }
            h.distanceM = d
            if let i = pins.firstIndex(where: { $0.id == h.id }) {
                pins[i] = h
            } else {
                pins.append(h)
                if Community.isFresh(lastSeen: h.lastSeen), !walkerRunning {
                    UIAccessibility.post(notification: .announcement,
                                         argument: t("New hazard reported, ", "Nuevo peligro reportado, ") + Community.distance(d, lang: lang))
                }
            }
            pins.sort { ($0.distanceM ?? .infinity) < ($1.distanceM ?? .infinity) }
        }
    }

    /// A fresh, accurate fix (read live, not the 5 m-throttled `fix`).
    var fixUsable: Bool {
        localizer.fixQuality.map { Community.fixUsable(accuracyM: $0.accuracyM, ageS: $0.ageS) } ?? false
    }

    func canVote(_ pin: Geo.Fix) -> Bool {
        guard let q = localizer.fixQuality else { return false }
        return Community.canVote(from: localizer.fix, accuracyM: q.accuracyM, ageS: q.ageS, to: pin)
    }

    /// "Marked still there by you" / "Marked gone by you", or nil before this device voted.
    func votedText(_ id: String) -> String? {
        voted[id].map { $0 == "up" ? t("Marked still there by you", "Marcado como presente por ti")
                                   : t("Marked gone by you", "Marcado como ya no está por ti") }
    }

    func vote(_ id: String, at pin: Geo.Fix, up: Bool) async {
        guard voted[id] == nil, !voting.contains(id) else { return }
        guard canVote(pin) else {
            announce(fixUsable ? t("Get closer to confirm", "Acércate para confirmar") : t("Waiting for GPS", "Esperando GPS"))
            return
        }
        voting.insert(id)
        defer { voting.remove(id) }
        do {
            _ = try await api.vote(id, up: up, source: "scout")
            voted[id] = up ? "up" : "down"
            UserDefaults.standard.set(voted, forKey: Self.votedKey)
            announce(votedText(id)!)
            user = try? await api.user()
            await refresh()
        } catch let e as APIClient.ServerError
                    where e.status == 404 || (e.status == 400 && e.message?.localizedCaseInsensitiveContains("cleared") == true) {
            announce(t("This hazard is no longer on the map", "Este peligro ya no está en el mapa"))
        } catch {
            announce(t("Vote failed", "El voto falló"))
        }
    }

    func reclassify(_ id: String, type: HazardTypeEntry?, category: String?, band: String?) async {
        do {
            let r = try await api.reclassify(id, type: type?.id, category: category, heightBand: band)
            announce(r.applied ? t("Change applied", "Cambio aplicado")
                               : t("Proposed, \(r.agreeing) of 3 agree", "Propuesto, \(r.agreeing) de 3 coinciden"))
        } catch {
            announce(t("Change failed", "El cambio falló"))
        }
    }

    func report(_ id: String, reason: String) async {
        do {
            try await api.report(id, reason: reason)
            announce(t("Reported. Thank you", "Denunciado. Gracias"))
        } catch {
            announce(t("Report failed", "La denuncia falló"))
        }
    }

    func announce(_ text: String) {
        status = text
        if !walkerRunning { UIAccessibility.post(notification: .announcement, argument: text) }
    }
}

struct CommunityView: View {
    @StateObject private var model: CommunityModel
    /// List | Map, remembered (also settable with `-communityMode map`).
    @AppStorage("communityMode") private var mode = "list"
    @State private var path: [String] = []
    @State private var openedLaunchHazard = false
    @State private var mapPosition: MapCameraPosition = .automatic
    @State private var mapCentered = false

    /// AppModel.running: the Walker session is live, so this tab makes no VoiceOver announcements.
    var walkerRunning: Bool

    init(api: APIClient, walkerRunning: Bool) {
        self.walkerRunning = walkerRunning
        _model = StateObject(wrappedValue: CommunityModel(api: api))
    }

    private func t(_ en: String, _ es: String) -> String { model.t(en, es) }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 12) {
                header
                Picker(t("View", "Vista"), selection: $mode) {
                    Text(t("List", "Lista")).tag("list")
                    Text(t("Map", "Mapa")).tag("map")
                }
                .pickerStyle(.segmented)
                if let status = model.status {
                    Text(status).foregroundStyle(Color.slate).accessibilityAddTraits(.updatesFrequently)
                }
                if mode == "map" { map } else { list }
            }
            .padding(.horizontal, 16)
            .background(Color.navy.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { HazardDetailView(id: $0, model: model) }
        }
        .onChange(of: walkerRunning, initial: true) { model.walkerRunning = walkerRunning }
        .onAppear {
            model.start()
            // `-openHazard <id>` opens one detail at launch (demo and screenshots).
            if !openedLaunchHazard, let id = UserDefaults.standard.string(forKey: "openHazard") { path = [id] }
            openedLaunchHazard = true
        }
        .onDisappear { model.stop() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(t("Community", "Comunidad")).font(.largeTitle.bold()).foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let u = model.user {
                Text(t("You: \(Int(u.karma)) points", "Tú: \(Int(u.karma)) puntos"))
                    .font(.headline).foregroundStyle(Color.slate)
            }
        }
        .padding(.top, 8)
    }

    private var list: some View {
        List {
            Section {
                if model.pins.isEmpty && model.loaded {
                    Text(t("No hazards reported within 1 mile", "Sin peligros reportados a menos de 1 milla"))
                        .foregroundStyle(Color.slate)
                        .listRowBackground(Color.white.opacity(0.06))
                }
                ForEach(model.pins) { pin in
                    NavigationLink(value: pin.id) { row(pin) }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(model.rowLabel(pin))
                        .accessibilityHint(t("Opens details", "Abre los detalles"))
                        .accessibilityAddTraits(.isButton)
                        .listRowBackground(Color.white.opacity(0.06))
                }
            } header: {
                Text(t("Within 1 mile", "A menos de 1 milla")).foregroundStyle(Color.slate)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await model.refresh() }
    }

    private func row(_ pin: NearHazard) -> some View {
        let d = model.fix.map { Geo.distance($0, pin.fix) } ?? pin.distanceM
        let dir = model.fix.map { Community.direction(bearing: Geo.bearing(from: $0, to: pin.fix), heading: model.heading, lang: model.lang) }
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(model.name(type: pin.type, label: pin.label)).font(.title3.bold()).foregroundStyle(.white)
                if pin.sample == true {
                    Text(t("Sample", "Muestra")).font(.caption.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.slate, in: Capsule()).foregroundStyle(.white)
                }
            }
            Text([d.map { Community.distance($0, lang: model.lang) }, dir,
                  t("confidence ", "confianza ") + Community.confidence(pin.confidence)]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(Color.slate)
        }
        .padding(.vertical, 6)
    }

    private var map: some View {
        Map(position: $mapPosition) {
            UserAnnotation()
            if let fix = model.fix {
                MapCircle(center: CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lng), radius: Community.radiusM)
                    .foregroundStyle(Color.control.opacity(0.08))
                    .stroke(Color.control.opacity(0.6), lineWidth: 1.5)
            }
            ForEach(model.pins) { pin in
                Annotation(model.name(type: pin.type, label: pin.label), coordinate: CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)) {
                    Button { path.append(pin.id) } label: {
                        Text(String(pin.category.prefix(1)).uppercased())
                            .font(.caption.bold())
                            .frame(width: 28, height: 28)
                            .background(Color.hazard, in: Circle())
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                            .foregroundStyle(Color.navy)
                    }
                    .accessibilityLabel(model.rowLabel(pin))
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.bottom, 8)
        .onAppear { mapCentered = false; centerMap() }
        .onChange(of: model.fix) { if !mapCentered { centerMap() } }
    }

    /// Opens on the user with the whole 1-mile radius in view, plus 10% padding on each side.
    private func centerMap() {
        guard let fix = model.fix else { return }
        let span = Community.radiusM * 2 * 1.2
        mapPosition = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lng),
                                                 latitudinalMeters: span, longitudinalMeters: span))
        mapCentered = true
    }
}

struct HazardDetailView: View {
    let id: String
    @ObservedObject var model: CommunityModel
    @State private var detail: HazardDetail?
    @State private var failed = false
    @State private var picking = false

    private func t(_ en: String, _ es: String) -> String { model.t(en, es) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let d = detail { content(d) } else if failed {
                    Text(t("Could not load this hazard", "No se pudo cargar este peligro")).foregroundStyle(Color.slate)
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
        .background(Color.navy.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
        .sheet(isPresented: $picking) {
            if let d = detail {
                TypePicker(title: model.name(type: d.type, label: d.label), entries: model.taxonomy ?? [], lang: model.lang,
                           pick: { _ in }, cancel: { picking = false }) { type, category, band in
                    picking = false
                    Task { await model.reclassify(d.id, type: type, category: category, band: band); await load() }
                }
            }
        }
    }

    private func load() async {
        do { detail = try await model.api.hazard(id) } catch { failed = true }
    }

    @ViewBuilder
    private func content(_ d: HazardDetail) -> some View {
        let nameEN = Spoken.capitalized(d.label ?? d.type)
        let nameES = d.spokenLabel_es.map(Spoken.capitalized)
        VStack(alignment: .leading, spacing: 4) {
            if d.sample == true { Text(t("Sample", "Muestra")).font(.caption.bold()).foregroundStyle(Color.slate) }
            Text(model.lang == "es" ? (nameES ?? nameEN) : nameEN).font(.largeTitle.bold()).foregroundStyle(.white)
            if let other = model.lang == "es" ? nameEN : nameES {
                Text(other).font(.title3).foregroundStyle(Color.slate)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)

        if let crop = d.crop, !crop.isEmpty, let data = Data(base64Encoded: crop), let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFit()
                .clipShape(RoundedRectangle(cornerRadius: 12))
                // Never the model's label: a photo description would repeat a guess as fact.
                .accessibilityLabel(t("Photo from the person who reported it", "Foto de quien lo reportó"))
        }

        VStack(alignment: .leading, spacing: 8) {
            if let fix = model.fix {
                let dist = Geo.distance(fix, d.fix)
                fact(t("Distance", "Distancia"), Community.distance(dist, lang: model.lang) + ", "
                     + Community.direction(bearing: Geo.bearing(from: fix, to: d.fix), heading: model.heading, lang: model.lang))
            }
            fact(t("Height", "Altura"), band(d.heightBand))
            if let c = d.measurements?.clearanceM { fact(t("Clearance", "Espacio libre"), Community.distance(c, lang: model.lang)) }
            if let w = d.measurements?.widthM { fact(t("Width", "Ancho"), Community.distance(w, lang: model.lang)) }
            fact(t("Severity", "Gravedad"), "\(Community.confidence(d.severity)) / 3")
            fact(t("Confidence", "Confianza"), Community.confidence(d.confidence))
            fact(t("Votes", "Votos"), t("\(d.ups) still there, \(d.downs) gone", "\(d.ups) presente, \(d.downs) ya no está"))
            if let seen = Community.date(d.lastSeen) { fact(t("Last seen", "Visto por última vez"), relative(seen)) }
            if let exp = Community.date(d.expiresAt) { fact(t("Expires", "Vence"), relative(exp)) }
        }

        votes(d)

        HStack(spacing: 12) {
            if model.taxonomy != nil {
                Button { picking = true } label: { actionLabel(t("Wrong type", "Tipo incorrecto"), "pencil") }
            }
            Menu {
                Button(t("Spam", "Spam")) { Task { await model.report(d.id, reason: "spam") } }
                Button(t("Abuse", "Abuso")) { Task { await model.report(d.id, reason: "abuse") } }
                Button(t("Other", "Otro")) { Task { await model.report(d.id, reason: "other") } }
            } label: { actionLabel(t("Report", "Denunciar"), "flag") }
            .accessibilityHint(t("Report spam or abuse", "Denunciar spam o abuso"))
        }

        if let status = model.status {
            Text(status).foregroundStyle(Color.slate)
        }
    }

    @ViewBuilder
    private func votes(_ d: HazardDetail) -> some View {
        if let done = model.votedText(d.id) {
            Text(done).font(.title3).foregroundStyle(.white)
        } else if d.status == "active", model.canVote(d.fix) {
            Text(t("Is it still there?", "¿Sigue ahí?")).font(.headline).foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 12) {
                Button { Task { await model.vote(d.id, at: d.fix, up: true); await load() } } label: {
                    actionLabel(t("Still there", "Sigue ahí"), "hand.thumbsup.fill", fill: .control)
                }
                Button { Task { await model.vote(d.id, at: d.fix, up: false); await load() } } label: {
                    actionLabel(t("Gone", "Ya no está"), "hand.thumbsdown.fill", fill: .hazard)
                }
            }
            .disabled(model.voting.contains(d.id))
        } else if d.status == "active", !model.fixUsable {
            Text(t("Waiting for GPS", "Esperando GPS")).foregroundStyle(Color.slate)
        } else if d.status == "active" {
            Text(t("Get closer to confirm. Votes need you within 1 mile.",
                   "Acércate para confirmar. Para votar debes estar a menos de 1 milla."))
                .foregroundStyle(Color.slate)
        }
    }

    private func fact(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(key).foregroundStyle(Color.slate)
            Spacer()
            Text(value).foregroundStyle(.white).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }

    private func actionLabel(_ title: String, _ icon: String, fill: Color = Color.white.opacity(0.1)) -> some View {
        Label(title, systemImage: icon)
            .font(.title3.bold())
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(fill, in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
    }

    private func band(_ b: String) -> String {
        switch b {
        case "head": return t("Head height", "Altura de la cabeza")
        case "dropoff": return t("Drop-off", "Desnivel")
        default: return t("Ground", "Suelo")
        }
    }

    private func relative(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: model.lang)
        return f.localizedString(for: date, relativeTo: Date())
    }
}
