import Foundation
import os

/// While scanning: polls /hazards/near every 10 s (60 m, with heading), announces pins ahead as priority 4
/// heads-ups, and casts passive walker downvotes (PLAN.md 3.1 item 4, section 4). All on the main thread.
final class MapSync: @unchecked Sendable { // main-confined; tasks hop back to main
    private let api: APIClient
    private let localizer: Localizer
    private let log = Logger(subsystem: "net.babigian.stepsafe", category: "map")
    private var state = HeadsUpState()
    private var voter = PassiveVoter()
    private var now: Double { ProcessInfo.processInfo.systemUptime }
    private var pollTimer: Timer?
    private var tick: Timer?
    private var polling = false
    /// Bumped in stop so an in-flight /near from the previous walk cannot land or clear `polling`.
    private var pollToken = 0

    private(set) var pins: [NearHazard] = []
    /// Last live path-guard output (uptime) and whether its floor was the plane under the walker.
    private var lastLiveOutput: Double?
    private var floorUnder = false
    /// Pins ahead within MapTuning.headsUpRadiusM (debug panel), refreshed every tick.
    var onAhead: (([HeadsUpState.Due]) -> Void)?
    /// Speak a heads-up as priority 4. `onDrop` runs if that phrase never starts.
    var speak: ((String, _ onDrop: @escaping () -> Void) -> Void)?
    private var taxonomy: [HazardTypeEntry]?
    private let lang = TTSChoice.lang()

    init(api: APIClient, localizer: Localizer) {
        self.api = api
        self.localizer = localizer
    }

    func start() {
        stop()
        state.reset()
        voter.reset()
        pins = [] // previous walk's pins must not heads-up before this walk's poll returns
        let api = api
        Task {
            let entries = try? await api.getTaxonomy()
            DispatchQueue.main.async { if let entries { self.taxonomy = entries } }
        }
        poll()
        pollTimer = Timer.scheduledTimer(withTimeInterval: MapTuning.pollSeconds, repeats: true) { [weak self] _ in self?.poll() }
        // Heads-up and passive votes use the cached pins, so they keep up with walking between polls.
        tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.evaluate() }
    }

    func stop() {
        pollToken += 1
        polling = false
        pollTimer?.invalidate(); pollTimer = nil
        tick?.invalidate(); tick = nil
        onAhead?([])
    }

    /// Path guard confirmed these hazards now (for the passive-downvote rule).
    func noteConfirmed(_ confirmed: [HazardKind: Detection]) {
        guard !confirmed.isEmpty, let walker = localizer.fix else { return }
        voter.noteConfirmed(bands: Set(confirmed.keys.map(\.band)), walker: walker, now: now)
    }

    /// Every analysis output: `live` = path guard was analysing (not the paused output).
    func noteOutput(live: Bool, floorSource: FloorSource) {
        if live { lastLiveOutput = now }
        floorUnder = live && floorSource == .planeUnder
    }

    /// Walking stopped: no stale "live" output survives into the next walk.
    func clearOutput() { lastLiveOutput = nil; floorUnder = false }

    /// A pin this device reported or merged into: never passively downvoted.
    func markOwn(_ id: String) { voter.own.insert(id) }

    private func releaseHeadsUp(_ id: String) { state.release(id) }

    private func poll() {
        guard !polling, let fix = localizer.fix else { return }
        polling = true
        let token = pollToken
        let heading = localizer.walkingHeading
        Task {
            let rows = try? await api.near(lat: fix.lat, lng: fix.lng, radiusM: MapTuning.pollRadiusM, heading: heading)
            DispatchQueue.main.async {
                guard token == self.pollToken else { return }
                self.polling = false
                if let rows { self.pins = rows }
            }
        }
    }

    private func evaluate() {
        guard let walker = localizer.fix, let heading = localizer.walkingHeading else { return }
        onAhead?(HeadsUpState.ahead(pins, walker: walker, heading: heading))
        if let due = state.next(pins, walker: walker, heading: heading, now: now) {
            let id = due.pin.id
            speak?(Spoken.headsUp(due, lang: lang, taxonomy: taxonomy)) { [weak self] in
                self?.releaseHeadsUp(id)
            }
        }
        guard let q = localizer.fixQuality else { return }
        let step = PassiveVoter.Step(walker: walker, heading: heading, accuracyM: q.accuracyM, fixAgeS: q.ageS,
                                     outputAgeS: lastLiveOutput.map { now - $0 }, floorUnder: floorUnder, now: now)
        for pin in voter.step(pins, step) {
            log.info("passive downvote \(pin.id, privacy: .public)")
            Task { _ = try? await api.vote(pin.id, up: false, source: "walker") }
        }
    }
}
