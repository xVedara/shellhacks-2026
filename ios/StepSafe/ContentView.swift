import SwiftUI
import UIKit

/// Wires SensorSession to AlertManager and publishes state for the tester screen.
final class AppModel: ObservableObject {
    @Published var running = false
    @Published var muted = false
    @Published var confirmed: [HazardKind: Detection] = [:]
    @Published var fps: Double = 0
    @Published var floorSource = FloorSource.estimate
    @Published var thumbnail: CGImage?
    @Published var pathGuardFailed = false
    @Published var audioFailed = false

    let sensors = SensorSession()
    let alerts = AlertManager()
    /// Server side (naming, heads-up, Scout). Never on the path-guard -> alert path.
    lazy var link = ServerLink(alerts: alerts)

    init() {
        let alerts = alerts
        let link = link
        sensors.onPose = { t in
            alerts.setListenerPose(t) // environment node only, safe off main
            link.localizer.setCamera(t)
        }
        sensors.onFrame = { link.namer.capture($0) } // crops only when a report is pending
        sensors.onOutput = { [weak self] out in
            DispatchQueue.main.async { self?.handle(out) }
        }
        sensors.onStatus = { [weak self] status in
            DispatchQueue.main.async {
                guard let self, self.running else { return }
                self.pathGuardFailed = status == .failed
                alerts.pathGuardStatus(status)
            }
        }
        // Start, AR reset, tracking back to normal: forget announced hazards (confirm filters reset in SensorSession).
        sensors.onReset = {
            DispatchQueue.main.async { alerts.clearHistory(); link.reset() }
        }
        alerts.onMuteChange = { [weak self] in self?.muted = $0 }
        alerts.onAudioState = { [weak self] ok in self?.audioFailed = !ok && (self?.running ?? false) }
    }

    private func handle(_ out: SensorSession.Output) {
        guard running, out.generation == sensors.generation else { return } // stale session: drop
        confirmed = out.confirmed
        fps = out.fps
        floorSource = out.floorSource
        if let t = out.thumbnail { thumbnail = t }
        alerts.atCurb = out.atCurb
        alerts.walkerSpeed = out.walkerSpeed
        alerts.headStill = out.headStill
        alerts.update(out.confirmed, closings: out.closings)
        link.handle(out) // after the alert decision: nothing here can delay a warning
    }

    func toggleRunning() {
        running.toggle()
        UIApplication.shared.isIdleTimerDisabled = running // head-mounted: the screen must stay on
        confirmed = [:]
        fps = 0
        thumbnail = nil
        pathGuardFailed = false
        audioFailed = false
        if running {
            alerts.startScanning()
            sensors.start()
            link.startWalking()
        } else {
            sensors.stop()
            alerts.stopScanning()
            link.stopWalking()
        }
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                if model.pathGuardFailed { problem("Path guard failed, restart") }
                if model.audioFailed { problem("Audio failed") }
                if !SensorSession.isSupported {
                    Text("This device has no LiDAR. StepSafe needs an iPhone Pro.")
                        .font(.body)
                        .foregroundStyle(Color.ink2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                BigButton(title: model.running ? "Stop" : "Start",
                          systemImage: model.running ? "stop.fill" : "play.fill",
                          filled: !model.running) { model.toggleRunning() }
                    .accessibilityHint(model.running ? "Stops scanning" : "Starts scanning the path ahead")
                    .disabled(!SensorSession.isSupported)
                BigButton(title: "What's ahead", systemImage: "ear", filled: true) { model.alerts.whatsAhead() }
                    .accessibilityHint("Speaks the nearest hazard. Same as one AirPods press")
                BigButton(title: model.muted ? "Unmute" : "Mute 5 minutes",
                          systemImage: model.muted ? "speaker.wave.2.fill" : "speaker.slash.fill",
                          filled: false) { model.alerts.toggleMute() }
                    .accessibilityHint("Same as two AirPods presses")
                debug
            }
            .padding(16)
        }
        .background(Color.page.ignoresSafeArea())
    }

    private var floorText: String {
        switch model.floorSource {
        case .planeUnder: return "Floor: ARKit plane under you"
        case .planeNearest: return String(format: "Floor: nearest ARKit plane, drop rule off, ground from %.1f ft", Tuning.estimatedFloorGroundMinM * 3.28084)
        case .estimate: return String(format: "Floor: estimated (camera height %.1f ft), drop rule off", Tuning.cameraHeightM * 3.28084)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("StepSafe")
                .font(.largeTitle.weight(.bold))
                .tracking(-0.8)
                .foregroundStyle(Color.ink)
            HStack(spacing: 8) {
                Circle().fill(headerMarkColor).frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(model.running ? (model.muted ? "Scanning, muted" : "Scanning") : "Stopped")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(headerStatusColor)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// Live scanning words use the link ink. Muted is `--ink-2`. Stopped is `--ink-3`.
    private var headerStatusColor: Color {
        if !model.running { return .ink3 }
        return model.muted ? .ink2 : .signalText
    }

    /// The status dot is a fill, so it keeps `--signal` (`#087FF5` in light).
    private var headerMarkColor: Color {
        if !model.running { return .ink3 }
        return model.muted ? .ink2 : .signal
    }

    /// Web warning notice: `--warn-tint` fill, `--warn-ink` words, `--hazard` edge.
    private func problem(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.octagon.fill")
                .font(.body)
                .foregroundStyle(Color.hazard)
            Text(text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.warnInk)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.warnTint, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.hazard.opacity(0.7), lineWidth: 2))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Problem: \(text)")
    }

    private var debug: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Debug").font(.headline).tracking(-0.3).foregroundStyle(Color.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Text(String(format: "%.1f fps", model.fps)).font(.footnote.monospacedDigit()).foregroundStyle(Color.ink3)
                    .accessibilityLabel(String(format: "Analysis %.0f frames per second", model.fps))
            }
            Text(floorText)
                .font(.footnote).foregroundStyle(Color.ink3)
            if let image = model.thumbnail {
                // Depth arrives in the sensor's landscape orientation; rotate for the portrait mount.
                Image(decorative: image, scale: 1, orientation: .right)
                    .resizable()
                    .interpolation(.none)
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("Depth view. Blue is the walking lane, orange is a hazard")
            }
            let hazards = model.confirmed.values.sorted { AlertPolicy.priority($0) < AlertPolicy.priority($1) }
            if hazards.isEmpty {
                Label(Notices.nothingAhead, systemImage: "checkmark.circle")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.signalText)
            }
            ForEach(hazards, id: \.kind) { d in
                hazardRow(d)
            }
            ServerStatusView(link: model.link)
        }
        .padding(16)
        .cardSurface()
    }

    /// Height bands use the locked sheet. A live closing vehicle has no tile on that sheet.
    private func hazardRow(_ d: Detection) -> some View {
        HStack(spacing: 12) {
            switch d.kind {
            case .ground:
                LockedHazardIcon(name: "height-ground", side: 28)
            case .headHeight:
                LockedHazardIcon(name: "height-head", side: 28)
            case .dropOff:
                LockedHazardIcon(name: "height-dropoff", side: 28)
            case .closing:
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.warnInk)
            }
            Text(AlertPolicy.phrase(d))
                .font(.body.weight(.semibold))
                .tracking(-0.2)
                .foregroundStyle(Color.warnInk)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Hazard: \(AlertPolicy.phrase(d))")
    }
}

struct BigButton: View {
    let title: String
    let systemImage: String
    let filled: Bool
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Label {
                Text(title).tracking(-0.3)
            } icon: {
                Image(systemName: systemImage)
            }
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 72)
                .foregroundStyle(filled ? Color.primaryInk : Color.ink)
                .background(filled ? Color.primaryFill : Color.clear, in: Capsule())
                .overlay(Capsule().stroke(filled ? Color.clear : Color.borderStrong, lineWidth: 1))
                .opacity(isEnabled ? 1 : 0.4) // explicit fills ignore the system disabled fade
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(title)
    }
}
