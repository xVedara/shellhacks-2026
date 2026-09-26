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

    init() {
        let alerts = alerts
        sensors.onPose = { alerts.setListenerPose($0) } // environment node only, safe off main
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
            DispatchQueue.main.async { alerts.clearHistory() }
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
        alerts.update(out.confirmed)
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
        } else {
            sensors.stop()
            alerts.stopScanning()
        }
    }
}

extension Color {
    static let navy = Color(red: 8 / 255, green: 22 / 255, blue: 36 / 255)
    static let hazard = Color(red: 1, green: 121 / 255, blue: 0)           // #FF7900, hazards only
    static let control = Color(red: 8 / 255, green: 127 / 255, blue: 245 / 255) // #087FF5
    static let slate = Color(red: 102 / 255, green: 113 / 255, blue: 126 / 255)
}

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                header
                if model.pathGuardFailed { problem("Path guard failed, restart") }
                if model.audioFailed { problem("Audio failed") }
                if !SensorSession.isSupported {
                    Text("This device has no LiDAR. StepSafe needs an iPhone Pro.")
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
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
        .background(Color.navy.ignoresSafeArea())
    }

    private var floorText: String {
        switch model.floorSource {
        case .planeUnder: return "Floor: ARKit plane under you"
        case .planeNearest: return "Floor: nearest ARKit plane"
        case .estimate: return String(format: "Floor: estimated (camera height %.2f m), drop rule off", Tuning.cameraHeightM)
        }
    }

    private var header: some View {
        VStack(spacing: 4) {
            Text("StepSafe").font(.largeTitle.bold()).foregroundStyle(.white)
            Text(model.running ? (model.muted ? "Scanning, muted" : "Scanning") : "Stopped")
                .foregroundStyle(Color.slate)
        }
        .accessibilityElement(children: .combine)
    }

    private func problem(_ text: String) -> some View {
        Label(text, systemImage: "exclamationmark.octagon.fill")
            .font(.title3.bold())
            .foregroundStyle(Color.hazard)
            .frame(maxWidth: .infinity)
            .padding(12)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.hazard, lineWidth: 2))
            .accessibilityLabel("Problem: \(text)")
    }

    private var debug: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Debug").font(.headline).foregroundStyle(.white)
                Spacer()
                Text(String(format: "%.1f fps", model.fps)).monospacedDigit().foregroundStyle(Color.slate)
                    .accessibilityLabel(String(format: "Analysis %.0f frames per second", model.fps))
            }
            Text(floorText)
                .font(.footnote).foregroundStyle(Color.slate)
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
                Label("Path clear", systemImage: "checkmark.circle").foregroundStyle(.white)
            }
            ForEach(hazards, id: \.kind) { d in
                Label(AlertPolicy.phrase(d), systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.hazard)
                    .accessibilityLabel("Hazard: \(AlertPolicy.phrase(d))")
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct BigButton: View {
    let title: String
    let systemImage: String
    let filled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.title2.bold())
                .frame(maxWidth: .infinity, minHeight: 72)
                .foregroundStyle(filled ? Color.white : Color.control)
                .background(filled ? Color.control : Color.clear, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.control, lineWidth: 2))
        }
        .accessibilityLabel(title)
    }
}
