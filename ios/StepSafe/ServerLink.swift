import SwiftUI

/// Everything that talks to the StepSafe server in walker mode: hazard naming, map heads-up, spoken labels.
/// AppModel calls the hooks; none of them sits on the path-guard -> alert path. Main thread unless noted.
final class ServerLink: ObservableObject {
    @Published var reachable: Bool?
    @Published var lastReport = "None yet"
    @Published var ahead: [HeadsUpState.Due] = []
    @Published var pinCount = 0
    @Published var baseURL: String {
        didSet { UserDefaults.standard.set(baseURL, forKey: APIClient.baseURLKey) }
    }

    let api = APIClient()
    let localizer = Localizer()
    let tts: TTSPlayer
    let namer: HazardNamer
    let map: MapSync
    private var walking = false
    var scoutActive = false

    init(alerts: AlertManager) {
        baseURL = UserDefaults.standard.string(forKey: APIClient.baseURLKey) ?? APIClient.defaultBaseURL
        tts = TTSPlayer(api: api)
        namer = HazardNamer(api: api, localizer: localizer)
        map = MapSync(api: api, localizer: localizer)
        api.onReachability = { [weak self] ok in DispatchQueue.main.async { self?.reachable = ok } }
        namer.onResult = { [weak self] in self?.lastReport = $0 }
        let map = map
        namer.onReported = { map.markOwn($0) }
        let tts = tts
        namer.speak = { text in tts.clip(for: text) { alerts.sayServer(text, clip: $0) } }
        map.speak = { text in tts.clip(for: text) { alerts.sayServer(text, clip: $0) } }
        map.onAhead = { [weak self] in
            self?.ahead = $0
            self?.pinCount = self?.map.pins.count ?? 0
        }
    }

    func startWalking() {
        walking = true
        namer.start()
        localizer.start()
        map.start()
    }

    func stopWalking() {
        walking = false
        namer.stop() // cancels in-flight reports
        map.stop()
        map.clearOutput()
        if !scoutActive { localizer.stop() }
    }

    func setScout(_ active: Bool) {
        scoutActive = active
        if active { localizer.start() } else if !walking { localizer.stop() }
    }

    /// Every fresh analysis output while walking.
    func handle(_ out: SensorSession.Output) {
        map.noteOutput(live: out.floorY != nil, floorSource: out.floorSource) // nil floorY = the paused output
        let mapHazards = out.confirmed.filter { $0.key != .closing } // moving objects are not map pins
        namer.update(mapHazards, floorY: out.floorY, pins: map.pins)
        map.noteConfirmed(mapHazards)
    }

    /// AR world reset: world points no longer match earlier identities.
    func reset() { namer.reset() }
}

/// Server status in the walker debug panel: reachability, last report, pins ahead, server URL.
struct ServerStatusView: View {
    @ObservedObject var link: ServerLink

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            let reach = link.reachable.map { $0 ? "reachable" : "unreachable" } ?? "not contacted"
            Label("Server \(reach)", systemImage: link.reachable == false ? "wifi.slash" : "network")
                .foregroundStyle(link.reachable == false ? Color.hazard : .white)
            Text("Last report: \(link.lastReport)").font(.footnote).foregroundStyle(Color.slate)
            Text("Pins within 195 ft: \(link.pinCount). Ahead within 95 ft:").font(.footnote).foregroundStyle(Color.slate)
            ForEach(link.ahead, id: \.pin.id) { due in
                Text(Spoken.headsUp(due) + (due.pin.sample == true ? " (sample)" : ""))
                    .font(.footnote).foregroundStyle(.white)
            }
            TextField("Server URL", text: $link.baseURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .font(.footnote.monospaced())
                .padding(8)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                .foregroundStyle(.white)
                .accessibilityLabel("Server URL")
        }
        .accessibilityElement(children: .contain)
    }
}
