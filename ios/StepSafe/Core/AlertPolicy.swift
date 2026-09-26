import simd

/// Every fixed notice the app speaks (each has a bundled clip in Phrases/phrases.json; PhraseBookTests checks).
enum Notices {
    static let pathGuardOn = "Path guard on"
    static let pathGuardBack = "Path guard back"
    static let pathGuardPaused = "Path guard paused"
    static let pathGuardFailed = "Path guard failed, restart"
    static let muted = "Muted for 5 minutes"
    static let alertsOn = "Alerts on"
    static let stopped = "StepSafe is stopped"
    /// Never "clear" or "safe": the app only reports what it did not detect.
    static let nothingAhead = "Nothing detected ahead"
    static let listenBeforeCrossing = "Nothing detected. Listen before crossing."
    /// HoldStillHint: vehicle warnings at a curb need a still head (look and hold).
    static let holdStill = "Hold still to check traffic."
    static let all = [pathGuardOn, pathGuardBack, pathGuardPaused, pathGuardFailed, muted, alertsOn, stopped,
                      nothingAhead, listenBeforeCrossing, holdStill]
}

/// Standing at a curb, vehicle warnings from the camera need the head held still (BoxTracker, look and hold): while
/// it keeps moving there is no vehicle speech at all. So, once per session, on the first curb stop where the head
/// has moved for more than 2 s, one short notice: "Hold still to check traffic." Pure, unit-tested.
struct HoldStillHint {
    static let movingSeconds = 2.0
    private var movingSince: Double?
    private(set) var spoken = false

    /// True exactly once per session (a new HoldStillHint per session): speak the notice now.
    mutating func update(now: Double, atCurb: Bool, walkerSpeed: Float, headStill: Bool) -> Bool {
        guard !spoken, atCurb, walkerSpeed < 0.3, !headStill else { movingSince = nil; return false }
        let since = movingSince ?? now
        movingSince = since
        guard now - since > Self.movingSeconds else { return false }
        spoken = true
        return true
    }
}

/// Queue of notices (status, acknowledgements, replies, server phrases). Pure, unit-tested.
/// - Nothing in it ever cuts off a hazard alert or another notice: it plays only when nothing is playing,
///   except that a status notice may cut off a playing server phrase (AlertPolicy.serverPhrasePriority).
/// - Status notices go ahead of server phrases; otherwise first in, first out.
/// - Server phrases queued longer than Tuning.serverPhraseMaxWaitSeconds are dropped (stale distances).
struct NoticeQueue<Item> {
    private var items: [(item: Item, server: Bool, queuedAt: Double)] = []

    var count: Int { items.count }
    mutating func push(_ item: Item, server: Bool, now: Double) { items.append((item, server, now)) }
    mutating func removeAll() { items = [] }
    /// "What's ahead" clears every queued notice and server phrase: it is the only thing left to say.
    mutating func replaceAll(with item: Item, now: Double) { items = [(item, false, now)] }

    /// The notice to play now (removed from the queue), or nil. `playing` = priority playing, nil if idle.
    mutating func pop(playing: Int?, now: Double) -> Item? {
        items.removeAll { $0.server && now - $0.queuedAt > Tuning.serverPhraseMaxWaitSeconds }
        guard let i = items.firstIndex(where: { !$0.server }) ?? (items.isEmpty ? nil : 0) else { return nil }
        let mayStart = playing == nil || (!items[i].server && playing == AlertPolicy.serverPhrasePriority)
        return mayStart ? items.remove(at: i).item : nil
    }
}

/// Which hazard to announce, and when (PLAN.md section 7 priority table). Pure, no audio, so it is unit-tested.
/// - Lower number = higher priority. A higher priority cuts off a lower one.
/// - Notices (acknowledgements, status) never cut anything off; they wait. A what's-ahead press cuts off
///   everything below priority 1 and clears the notice queue (whatsAheadCutsOff, NoticeQueue.replaceAll).
/// - Mute silences priority 2 and lower. Priority 1 always plays.
/// - The same hazard (same kind within sameHazardRadius of the point where it was FIRST announced; closing
///   objects by track id) is not repeated for repeatWindow (closing: closingRepeatSeconds, one clip), except
///   once more when it comes within repeatCloseDistance.
///
/// Ara's hard rule, as implemented (the spec for closing objects: cars and anything closing fast):
/// - Closing objects are never muted.
/// - Each closing object's haptic and spatial crossing tone fire immediately (closingToPing), even while
///   another clip plays.
/// - Only the spoken words may queue, at most one phrase behind another priority-1 alert: a closing object
///   cuts off a playing NON-closing hazard whenever it would otherwise speak too late (TTC < time left in the
///   clip); closing vs closing needs the clip to have played p1MinPlaySeconds and the newcomer to be
///   p1PreemptMarginSeconds more urgent. Pre-emption is one-way (noteCutOff): what was cut off never cuts back.
/// - A cut-off closing object that becomes most urgent speaks next (unmark makes it due again).
/// - A closing object and a drop-off both urgent (TTC < combinedTTCSeconds) are ONE phrase, closing first,
///   but only when the closing object is itself due; otherwise a due drop-off plays alone.
struct AlertPolicy {
    /// Answers to the user's own commands: any hazard alert may cut them off.
    static let onRequestPriority = 5
    /// What a server phrase (spoken label, map heads-up; clip or speech fallback) counts as while it plays:
    /// below everything, so every hazard alert (priority 1-3) may cut it off.
    static let serverPhrasePriority = 6

    private struct Announced {
        let kind: HazardKind
        let point: SIMD3<Float> // identity: never updated after the first announcement
        /// Closing objects: the detector's track id is the identity (they move).
        let trackId: Int?
        var time: Double
        var close: Bool
    }

    /// What is playing: its priority, the hazard if it is an alert, and when it ends.
    struct Playing {
        var priority: Int
        var hazard: Detection?
        var endsAt: Double
        /// When it started, and its hazard's time to contact then (aged by now - startedAt for comparisons).
        var startedAt: Double = -.infinity
        var ttcAtStart: Float = .infinity
    }

    /// One-way pre-emption: `victim` was cut off by `cutter`; it may not cut `cutter` off until `until`
    /// (the end of the cutter's playback).
    private var blocked: [(victim: Detection, cutter: Detection, until: Double)] = []
    /// Closing objects (track ids) whose alert has been spoken at least once.
    private var spokenClosing: Set<Int> = []
    /// The one deferred closing phrase (decide): when its object was last confirmed, and the first idle moment
    /// (nothing playing) since it was queued.
    private(set) var pending: (d: Detection, lastSeen: Double, idleSince: Double?)?
    /// Drop-offs (points) that already got their immediate tone + haptic while blocked behind closing words.
    /// Start time of the closing phrase during which a drop-off got its haptic (one cue per closing phrase).
    private var cuedPhraseStart: Double?
    /// What was playing at the last decide() that could not start anything (for follow-on drop-offs).
    private var lastPlaying: Playing?

    private var history: [Announced] = []
    private(set) var mutedUntil: Double?

    static func priority(_ d: Detection) -> Int {
        // Future crossing-assist detections (approaching cars, fast-closing objects) MUST return 1: never muted.
        switch d.kind {
        case .dropOff: // priority 1 only within 2 m (never muted); time to contact only orders priority-1 alerts
            return d.ahead <= Tuning.dropUrgentDistance ? 1 : 2
        case .headHeight: return 2
        case .ground: return 3
        case .closing: return 1 // detectors report only objects that will plausibly reach the walker
        }
    }

    /// Ara's hard rule: priority 1 (every closing object included) ignores mute.
    static func neverMuted(_ d: Detection) -> Bool { priority(d) == 1 }

    /// Time to contact, seconds: measured for closing objects (a vehicle only passing by, kept at a curb, sorts
    /// after everything); distance / walker speed (floor Tuning.minWalkerSpeedMps) for everything else.
    static func ttc(_ d: Detection, walkerSpeed: Float) -> Float {
        if let c = d.closing { return c.passing ? c.ttc + 100 : c.ttc }
        return d.ahead / max(walkerSpeed, Tuning.minWalkerSpeedMps)
    }

    /// Same object: closing alerts by track id, others by kind and first-announced point.
    static func sameObject(_ a: Detection, _ b: Detection) -> Bool {
        guard a.kind == b.kind else { return false }
        if let ia = a.closing?.trackId, let ib = b.closing?.trackId { return ia == ib }
        return simd_distance(a.point, b.point) <= radius(a.kind)
    }

    static let listenBeforeCrossing = Notices.listenBeforeCrossing
    /// Appended to a closing alert when a drop-off is urgent at the same time (one phrase, closing first).
    static let dropOffAhead = "Drop-off ahead."

    /// Answer to "what's ahead". At a curb with nothing closing, adds the crossing advice (advice only: it never
    /// says "go" or "safe").
    static func whatsAheadPhrase(_ latest: [HazardKind: Detection], atCurb: Bool) -> String {
        if let c = latest[.closing] { return phrase(c) } // something is coming: that is the answer
        let advice = atCurb
        guard let d = mostUrgent(latest.values) else { return advice ? listenBeforeCrossing : Notices.nothingAhead }
        return advice ? "\(phrase(d)). \(listenBeforeCrossing)" : phrase(d)
    }

    /// "What's ahead" (Ara: it clears queued sounds and just tells what's ahead). The hazard its answer names:
    /// the closing object if any, else the most urgent one (nil: nothing detected). AlertManager marks it
    /// announced once the answer starts, so the same hazard does not replay right after (normal repeat rules).
    static func whatsAheadHazard(_ latest: [HazardKind: Detection]) -> Detection? {
        latest[.closing] ?? mostUrgent(latest.values)
    }

    /// A press cuts off whatever is playing, except a priority-1 alert (the answer then waits behind it).
    static func whatsAheadCutsOff(_ playing: Int?) -> Bool { playing.map { $0 >= 2 } ?? false }

    /// The answer plays like the alert for the hazard it names (at most priority 2): only a more urgent alert cuts
    /// it off; other hazards wait, as behind any priority-2 alert. "Nothing detected" plays as onRequestPriority,
    /// so any hazard alert cuts it off.
    static func whatsAheadPriority(_ hazard: Detection?) -> Int { hazard.map { min(2, priority($0)) } ?? onRequestPriority }

    private static func radius(_ kind: HazardKind) -> Float {
        kind == .closing ? Tuning.closingSameRadiusM : Tuning.sameHazardRadius
    }

    static func phrase(_ d: Detection) -> String {
        let name: String
        switch d.kind {
        case .dropOff:
            if d.followOn { return dropOffAhead }
            name = "Drop-off"
        case .headHeight: name = "Head height"
        case .ground: name = "Obstacle"
        case .closing:
            // "Car approaching, right" / "Object approaching, ahead"
            let aheadBand = d.ahead * sin(Tuning.closingAheadDeg * .pi / 180)
            let side = d.lateral < -aheadBand ? "left" : d.lateral > aheadBand ? "right" : "ahead"
            let base = "\(d.closing?.label ?? "Object") approaching, \(side)"
            return d.closing?.dropOffPoint == nil ? base : "\(base). \(dropOffAhead)"
        }
        let metres = max(1, Int(d.ahead.rounded()))
        let side = d.lateral < -Tuning.sideDeadband ? "left" : d.lateral > Tuning.sideDeadband ? "right" : "ahead"
        return "\(name), \(metres) \(metres == 1 ? "meter" : "meters"), \(side)"
    }

    /// Whether something of priority `incoming` may start now, cutting off `playing` (nil = idle). For notices
    /// and server phrases; hazards use mayStart(_:over:now:walkerSpeed:).
    static func mayStart(_ incoming: Int, over playing: Int?) -> Bool {
        guard let playing else { return true }
        if incoming == onRequestPriority { return playing > 2 }
        return incoming < playing
    }

    /// A hazard alert may cut off what is playing when it has a higher priority, or when both are priority 1,
    /// it is a different object, and its time to contact is shorter than what is left of the playing alert
    /// (it would otherwise be too late). The same object never cuts itself off.
    static func mayStart(_ d: Detection, over playing: Playing?, now: Double, walkerSpeed: Float) -> Bool {
        guard let playing else { return true }
        let p = priority(d)
        if p < playing.priority { return true }
        guard p == 1, playing.priority == 1, let current = playing.hazard, !sameObject(d, current) else { return false }
        // Priority 1 over priority 1. A drop-off (or any non-closing hazard) never cuts off closing words: it
        // queues behind them (the closing object's tone and haptic already fired). For the rest, one rule for
        // "too late after the clip": waiting would leave the newcomer under p1LeadSeconds to react
        // (TTC - time left in the clip); plain TTC < time left never fires, both shrink at the same rate.
        if d.kind != .closing && current.kind == .closing { return false }
        let t = Double(ttc(d, walkerSpeed: walkerSpeed))
        let tooLateAfter = t - (playing.endsAt - now) < Tuning.p1LeadSeconds
        // A closing object over a non-closing hazard: no window, no margin (the one-way block prevents cut-back).
        if d.kind == .closing && current.kind != .closing { return tooLateAfter }
        // Otherwise (closing vs closing, drop-off vs drop-off): the clip has played p1MinPlaySeconds and the
        // newcomer is p1PreemptMarginSeconds more urgent than the playing hazard's TTC (aged).
        let aged = Double(playing.ttcAtStart) - (now - playing.startedAt)
        return now - playing.startedAt >= Tuning.p1MinPlaySeconds && tooLateAfter && t < aged - Tuning.p1PreemptMarginSeconds
    }

    /// mayStart plus the one-way rule: a hazard cut off by the playing one never cuts it back.
    func mayStart(_ d: Detection, over playing: Playing?, now: Double, walkerSpeed: Float) -> Bool {
        if let cutter = playing?.hazard,
           blocked.contains(where: { now < $0.until && Self.sameObject($0.victim, d) && Self.sameObject($0.cutter, cutter) }) {
            return false
        }
        // A closing object already spoken once may not cut off a drop-off whose words have not been heard yet
        // (heardWordsSeconds of audible words after its tone): the drop-off is new information, the object is not.
        if d.kind == .closing, let id = d.closing?.trackId, spokenClosing.contains(id),
           let playing, playing.hazard?.kind == .dropOff,
           now - playing.startedAt < Tuning.dropOffToneSeconds + Tuning.heardWordsSeconds {
            return false
        }
        return Self.mayStart(d, over: playing, now: now, walkerSpeed: walkerSpeed)
    }

    /// The closing object that should get the immediate crossing tone + haptic now: a track id not pinged yet
    /// (AlertManager.pingNewClosing; the spoken alert follows the normal rules).
    static func closingToPing(_ confirmed: [HazardKind: Detection], pinged: Set<Int>) -> Detection? {
        guard let c = confirmed[.closing], let id = c.closing?.trackId, !pinged.contains(id) else { return nil }
        return c
    }

    /// A due priority-1 drop-off blocked behind closing words (a drop-off never cuts them off) gets its tone and
    /// haptic AT ONCE, mixed over the words, once per drop-off; its words follow ("Drop-off ahead."). AlertManager
    /// plays what this returns on the tone player; the policy sims log it.
    mutating func dropOffToCue(_ confirmed: [HazardKind: Detection], playing: Playing?, now: Double) -> Detection? {
        guard let d = confirmed[.dropOff], Self.priority(d) == 1, isDue(d, now: now),
              let playing, let current = playing.hazard, current.kind == .closing,
              cuedPhraseStart != playing.startedAt else { return nil } // one cue per closing phrase
        cuedPhraseStart = playing.startedAt
        return d
    }

    /// `cutter` cut off `victim`, and plays until `until`.
    mutating func noteCutOff(victim: Detection, by cutter: Detection, until: Double) {
        blocked.removeAll { $0.until < until - 60 }
        blocked.append((victim, cutter, until))
    }

    /// The phrase to say: when a closing object and a drop-off are both urgent (TTC < combinedTTCSeconds),
    /// ONE phrase, closing first, then "Drop-off ahead."
    static func combined(_ top: Detection, _ confirmed: [HazardKind: Detection], walkerSpeed: Float) -> Detection {
        guard let c = confirmed[.closing], let drop = confirmed[.dropOff], top.kind == .closing || top.kind == .dropOff,
              !(c.closing?.passing ?? false),
              ttc(c, walkerSpeed: walkerSpeed) < Tuning.combinedTTCSeconds,
              ttc(drop, walkerSpeed: walkerSpeed) < Tuning.combinedTTCSeconds,
              // About equally urgent: one phrase, closing first. A clearly more urgent drop-off goes first alone
              // (the closing object's tone and haptic already fired; its words follow).
              ttc(c, walkerSpeed: walkerSpeed) - ttc(drop, walkerSpeed: walkerSpeed) < Tuning.combineSimilarTTCSeconds else { return top }
        var out = c
        out.closing?.dropOffPoint = drop.point
        out.closing?.dropOffAhead = drop.ahead
        return out
    }

    /// Most urgent first: priority, then time to contact (drop-off: distance / walker speed).
    static func mostUrgent<S: Sequence>(_ hazards: S, walkerSpeed: Float = 0) -> Detection? where S.Element == Detection {
        hazards.min { (priority($0), ttc($0, walkerSpeed: walkerSpeed)) < (priority($1), ttc($1, walkerSpeed: walkerSpeed)) }
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

    mutating func clearHistory() { history = []; spokenClosing = []; pending = nil; blocked = []; cuedPhraseStart = nil }

    /// The hazard to announce now, or nil.
    func next(_ confirmed: [HazardKind: Detection], now: Double, playing: Playing?, walkerSpeed: Float = 0) -> Detection? {
        let muted = isMuted(now: now)
        let due = confirmed.values.filter { d in
            (!muted || Self.neverMuted(d)) && isDue(d, now: now)
        }
        guard let first = Self.mostUrgent(due, walkerSpeed: walkerSpeed) else { return nil }
        // Combine only when the closing object is itself due; otherwise a due drop-off plays alone.
        let closingDue = confirmed[.closing].map { c in due.contains { Self.sameObject($0, c) } } ?? false
        let top = closingDue ? Self.combined(first, confirmed, walkerSpeed: walkerSpeed) : first
        return mayStart(top, over: playing, now: now, walkerSpeed: walkerSpeed) ? top : nil // else retried next frame
    }

    /// next() plus the queue for deferred closing speech: ONE pending closing phrase (the most urgent due closing
    /// object that could not speak yet). It stays a candidate for pendingClosingSeconds after its object was last
    /// confirmed, even if it left the camera view, so it is said when the voice frees; only a more urgent closing
    /// object replaces it. AlertManager and the policy sims call this.
    mutating func decide(_ confirmed: [HazardKind: Detection], now: Double, playing: Playing?, walkerSpeed: Float = 0) -> Detection? {
        // Expiry: kept through whatever is playing; dropped only if still unspoken pendingClosingSeconds after the
        // first idle opportunity, or once its time to contact has passed, or when it is no longer due.
        if let p = pending, !isDue(p.d, now: now) || p.d.closing.map({ $0.ttc - Float(now - p.lastSeen) <= 0 }) == true
            || p.idleSince.map({ now - $0 > Tuning.pendingClosingSeconds }) == true {
            pending = nil
        }
        // Passing curb vehicles queue too (they sort after other hazards by their TTC penalty).
        if let c = confirmed[.closing], isDue(c, now: now) {
            if let p = pending, !Self.sameObject(p.d, c),
               Self.ttc(aged(p, now: now), walkerSpeed: walkerSpeed) <= Self.ttc(c, walkerSpeed: walkerSpeed) { // passing penalty included
                // keep the more urgent pending phrase
            } else if let p = pending, Self.sameObject(p.d, c) {
                pending = (c, now, p.idleSince)
            } else {
                pending = (c, now, nil)
            }
        }
        if playing == nil, pending != nil, pending?.idleSince == nil { pending?.idleSince = now }
        var candidates = confirmed
        if let p = pending, confirmed[.closing].map({ !Self.sameObject($0, p.d) }) ?? true {
            candidates[.closing] = aged(p, now: now) // out of view, or more urgent than what is in view
        }
        guard var d = next(candidates, now: now, playing: playing, walkerSpeed: walkerSpeed) else {
            if let playing { lastPlaying = playing }
            return nil
        }
        if let p = pending, d.kind == .closing, Self.sameObject(d, p.d) { pending = nil }
        // A drop-off that waited behind closing words follows them at once as "Drop-off ahead." (no tone): the
        // combined phrase, completed after the fact.
        if d.kind == .dropOff, playing == nil, let lp = lastPlaying, lp.hazard?.kind == .closing,
           lp.hazard?.closing?.dropOffPoint == nil, now - lp.endsAt < Tuning.followOnSeconds {
            d.followOn = true
            d.preCued = cuedPhraseStart == lp.startedAt // its haptic already fired during those closing words
        }
        lastPlaying = nil
        return d
    }

    /// The pending closing object as of now: its time to contact and range shrink with the time since it was seen.
    private func aged(_ p: (d: Detection, lastSeen: Double, idleSince: Double?), now: Double) -> Detection {
        var d = p.d
        let dt = Float(now - p.lastSeen)
        if let c = d.closing {
            d.closing?.ttc = max(0.05, c.ttc - dt)
            d.ahead = max(0.1, d.ahead - c.speed * dt)
        }
        return d
    }

    /// `playing` = priority of a notice or phrase playing (no hazard), nil if idle.
    func next(_ confirmed: [HazardKind: Detection], now: Double, playing: Int?) -> Detection? {
        next(confirmed, now: now, playing: playing.map { Playing(priority: $0, hazard: nil, endsAt: .infinity) })
    }

    /// Call only once the alert's audio has actually started.
    mutating func markAnnounced(_ d: Detection, now: Double) {
        if let id = d.closing?.trackId { spokenClosing.insert(id) }
        if let p = d.closing?.dropOffPoint { // combined phrase: the drop-off was said too
            markAnnounced(Detection(kind: .dropOff, point: p, ahead: d.closing?.dropOffAhead ?? 0, lateral: 0, pointCount: 0), now: now)
        }
        history.removeAll { now - $0.time >= ($0.kind == .closing ? Tuning.closingRepeatSeconds : Tuning.repeatWindow) }
        let close = d.ahead <= Tuning.repeatCloseDistance
        if let i = match(d, now: now) {
            history[i].time = now
            history[i].close = history[i].close || close
        } else {
            history.append(Announced(kind: d.kind, point: d.point, trackId: d.closing?.trackId, time: now, close: close))
        }
    }

    /// The alert was cut off before it finished: forget it so it can replay.
    mutating func unmark(_ d: Detection) {
        if let i = history.lastIndex(where: { same($0, d) }) {
            history.remove(at: i)
        }
        if let p = d.closing?.dropOffPoint { // a cut-off combined phrase: the drop-off part was not heard either
            unmark(Detection(kind: .dropOff, point: p, ahead: d.closing?.dropOffAhead ?? 0, lateral: 0, pointCount: 0))
        }
    }

    private func isDue(_ d: Detection, now: Double) -> Bool {
        guard let i = match(d, now: now) else { return true } // new hazard, or window expired
        if d.kind == .closing { return false } // re-announced after closingRepeatSeconds (match expires)
        return d.ahead <= Tuning.repeatCloseDistance && !history[i].close
    }

    private func same(_ a: Announced, _ d: Detection) -> Bool {
        guard a.kind == d.kind else { return false }
        if let id = a.trackId, let did = d.closing?.trackId { return id == did }
        return simd_distance(a.point, d.point) <= Self.radius(d.kind)
    }

    /// A closing object still coming is repeated after one clip length (Tuning.closingRepeatSeconds), never later.
    private func match(_ d: Detection, now: Double) -> Int? {
        let window = d.kind == .closing ? Tuning.closingRepeatSeconds : Tuning.repeatWindow
        return history.firstIndex { now - $0.time < window && same($0, d) }
    }
}
