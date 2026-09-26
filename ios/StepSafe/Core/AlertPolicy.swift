import simd

/// Which hazard to announce, and when (PLAN.md section 7 priority table). Pure, no audio, so it is unit-tested.
/// - Lower number = higher priority. A higher priority cuts off a lower one.
/// - Notices (acknowledgements, status, what's-ahead replies) never cut off priority 1 or 2; they wait.
/// - Mute silences priority 2 and lower. Priority 1 always plays (Ara's hard rule).
/// - The same hazard (same kind within sameHazardRadius of the point where it was FIRST announced)
///   is not repeated for repeatWindow, except once more when it comes within repeatCloseDistance.
struct AlertPolicy {
    /// Answers to the user's own commands: any hazard alert may cut them off.
    static let onRequestPriority = 5

    private struct Announced {
        let kind: HazardKind
        let point: SIMD3<Float> // identity: never updated after the first announcement
        var time: Double
        var close: Bool
    }

    private var history: [Announced] = []
    private(set) var mutedUntil: Double?

    static func priority(_ d: Detection) -> Int {
        // Future crossing-assist detections (approaching cars, fast-closing objects) MUST return 1: never muted.
        switch d.kind {
        case .dropOff: return d.ahead <= Tuning.dropUrgentDistance ? 1 : 2
        case .headHeight: return 2
        case .ground: return 3
        }
    }

    static func phrase(_ d: Detection) -> String {
        let name: String
        switch d.kind {
        case .dropOff: name = "Drop-off"
        case .headHeight: name = "Head height"
        case .ground: name = "Obstacle"
        }
        let metres = max(1, Int(d.ahead.rounded()))
        let side = d.lateral < -Tuning.sideDeadband ? "left" : d.lateral > Tuning.sideDeadband ? "right" : "ahead"
        return "\(name), \(metres) \(metres == 1 ? "meter" : "meters"), \(side)"
    }

    /// Whether something of priority `incoming` may start now, cutting off `playing` (nil = idle).
    static func mayStart(_ incoming: Int, over playing: Int?) -> Bool {
        guard let playing else { return true }
        if incoming == onRequestPriority { return playing > 2 }
        return incoming < playing
    }

    /// Most urgent first: priority, then distance.
    static func mostUrgent<S: Sequence>(_ hazards: S) -> Detection? where S.Element == Detection {
        hazards.min { (priority($0), $0.ahead) < (priority($1), $1.ahead) }
    }

    func isMuted(now: Double) -> Bool { mutedUntil.map { now < $0 } ?? false }

    mutating func setMuted(_ muted: Bool, now: Double) {
        mutedUntil = muted ? now + Tuning.muteDuration : nil
    }

    /// True once, when a mute runs out on its own.
    mutating func muteExpired(now: Double) -> Bool {
        guard let until = mutedUntil, now >= until else { return false }
        mutedUntil = nil
        return true
    }

    mutating func clearHistory() { history = [] }

    /// The hazard to announce now, or nil. `playing` is the priority of what is playing, nil if idle.
    func next(_ confirmed: [HazardKind: Detection], now: Double, playing: Int?) -> Detection? {
        let muted = isMuted(now: now)
        let due = confirmed.values.filter { d in
            (!muted || Self.priority(d) == 1) && isDue(d, now: now)
        }
        guard let top = Self.mostUrgent(due) else { return nil }
        return Self.mayStart(Self.priority(top), over: playing) ? top : nil // else retried next frame
    }

    /// Call only once the alert's audio has actually started.
    mutating func markAnnounced(_ d: Detection, now: Double) {
        history.removeAll { now - $0.time >= Tuning.repeatWindow }
        let close = d.ahead <= Tuning.repeatCloseDistance
        if let i = match(d, now: now) {
            history[i].time = now
            history[i].close = history[i].close || close
        } else {
            history.append(Announced(kind: d.kind, point: d.point, time: now, close: close))
        }
    }

    /// The alert was cut off before it finished: forget it so it can replay.
    mutating func unmark(_ d: Detection) {
        if let i = history.lastIndex(where: { $0.kind == d.kind && simd_distance($0.point, d.point) <= Tuning.sameHazardRadius }) {
            history.remove(at: i)
        }
    }

    private func isDue(_ d: Detection, now: Double) -> Bool {
        guard let i = match(d, now: now) else { return true } // new hazard, or window expired
        return d.ahead <= Tuning.repeatCloseDistance && !history[i].close
    }

    private func match(_ d: Detection, now: Double) -> Int? {
        history.firstIndex {
            $0.kind == d.kind && now - $0.time < Tuning.repeatWindow
                && simd_distance($0.point, d.point) <= Tuning.sameHazardRadius
        }
    }
}
