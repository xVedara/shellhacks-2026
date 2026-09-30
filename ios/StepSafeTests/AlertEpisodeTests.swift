import XCTest
import simd

/// Walker-frame alert episodes, V3 and the drop-off haptic reminder (Tuning.alertEpisodes, dropOffHapticReminder;
/// analysis/alert_sim/VARIANTS.md). Scenarios are synthetic versions of the VARIANTS.md before/after excerpts:
/// "before" runs with both flags off (the HEAD rules), "after" with both on.
final class AlertEpisodeTests: XCTestCase {
    private var saved = (true, true)
    override func setUp() { saved = (Tuning.alertEpisodes, Tuning.dropOffHapticReminder); flags(true) }
    override func tearDown() { (Tuning.alertEpisodes, Tuning.dropOffHapticReminder) = saved }
    private func flags(_ on: Bool) { Tuning.alertEpisodes = on; Tuning.dropOffHapticReminder = on }

    /// A hazard `ahead` m in front of a walker at `walkerZ` (walking toward -z), `x` m to the right.
    static func det(_ kind: HazardKind, ahead: Float, x: Float = 0, walkerZ: Float = 0) -> Detection {
        Detection(kind: kind, point: SIMD3(x, 0, -(walkerZ + ahead)), ahead: ahead, lateral: x, pointCount: 100)
    }

    /// AlertManager.update without audio: observe, reminder, decide, V3 hold, play (clips last `clip` s; a phrase
    /// that starts over another cuts it off and un-marks it, as AlertManager.play/cutOff do).
    struct Driver {
        struct Event { var t: Double; var phrase: String; var priority: Int; var cut = false }
        var policy = AlertPolicy()
        var clip = 2.0
        var playing: AlertPolicy.Playing?
        var phrases: [Event] = []
        /// (time, why): every drop-off haptic (P1 phrase, V3 queue / same words, reminder).
        var haptics: [(t: Double, why: String)] = []

        mutating func step(_ confirmed: [HazardKind: Detection], now: Double, walkerSpeed: Float = 1.2) {
            policy.observe(confirmed, now: now)
            if policy.dropOffReminderDue(confirmed, now: now) { haptics.append((now, "reminder")) }
            if let p = playing, now >= p.endsAt { playing = nil }
            guard let d = policy.decide(confirmed, now: now, playing: playing, walkerSpeed: walkerSpeed) else { return }
            switch policy.holdBehindSameEdge(d, playing: playing, now: now, walkerSpeed: walkerSpeed) {
            case .sameWords?: haptics.append((now, "same words"))
            case .queued?: haptics.append((now, "queued"))
            case .waiting?: break
            case nil:
                if let p = playing, let victim = p.hazard {
                    policy.unmark(victim)
                    phrases[phrases.count - 1].cut = true
                    policy.noteCutOff(victim: victim, by: d, until: now + clip)
                }
                let priority = AlertPolicy.priority(d)
                playing = AlertPolicy.Playing(priority: priority, hazard: d, endsAt: now + clip, startedAt: now,
                                              ttcAtStart: AlertPolicy.ttc(d, walkerSpeed: walkerSpeed))
                phrases.append(Event(t: now, phrase: AlertPolicy.phrase(d), priority: priority))
                policy.markAnnounced(d, now: now)
                policy.noteSpoken(d, now: now)
                if priority == 1 { haptics.append((now, "phrase")) }
            }
        }

        var cuts: Int { phrases.filter(\.cut).count }
    }

    /// Runs `frame(t)` every 0.2 s (5 Hz, as the sim) from 0 to `seconds`.
    private func run(_ on: Bool, seconds: Double, walkerSpeed: (Double) -> Float = { _ in 1.2 },
                     _ frame: (Double) -> [HazardKind: Detection]) -> Driver {
        flags(on)
        defer { flags(true) }
        var sim = Driver()
        for i in 0...Int((seconds / 0.2).rounded()) {
            let t = Double(i) * 0.2
            sim.step(frame(t), now: t, walkerSpeed: walkerSpeed(t))
        }
        return sim
    }

    // MARK: VARIANTS.md excerpts (before = flags off, after = flags on)

    /// 1. Following a curb on the left at 1.6-2.4 m: many phrases and cut-offs before, one phrase after.
    func testExcerpt1FollowingACurbIsSaidOnce() {
        let curb = { (t: Double) -> [HazardKind: Detection] in
            [.dropOff: Self.det(.dropOff, ahead: Float(2.0 - 0.4 * sin(t * 0.9)), x: -0.34, walkerZ: Float(1.2 * t))]
        }
        let before = run(false, seconds: 22, curb), after = run(true, seconds: 22, curb)
        XCTAssertGreaterThanOrEqual(before.phrases.count, 6)
        XCTAssertEqual(after.phrases.map(\.phrase), ["Drop-off, 6 feet, left"])
        XCTAssertEqual(after.phrases.first?.priority, 1)
        XCTAssertEqual(after.cuts, 0)
        XCTAssertEqual(after.phrases.first?.t, before.phrases.first?.t, "first alert of the episode at the same instant")
    }

    /// 2. A priority-2 edge at 2.3-3 m: the jump guard still speaks each jump of the nearest point, and the 2 m
    /// priority-1 cue lands at the same instant as before.
    func testExcerpt2JumpsAreSpokenAndTheTwoMetreCueIsNotLate() {
        func ahead(_ t: Double) -> Float {
            switch t {
            case ..<3: return 2.9
            case ..<6: return 2.3 // jump 0.6 m
            case ..<9: return 2.9 // jump back
            default: return Float(2.9 - (t - 9) * 0.5) // walks up: 2 m at t = 10.8
            }
        }
        let edge = { (t: Double) -> [HazardKind: Detection] in
            [.dropOff: Self.det(.dropOff, ahead: ahead(t), x: -0.34, walkerZ: Float(1.2 * t))]
        }
        let before = run(false, seconds: 12, edge), after = run(true, seconds: 12, edge)
        XCTAssertLessThan(after.phrases.count, before.phrases.count)
        XCTAssertEqual(after.phrases.filter { $0.t < 10 }.map(\.t), [0, 3, 6], "each jump is a new episode, spoken")
        let firstP1 = { (d: Driver) in d.haptics.first { $0.t >= 10 }?.t }
        XCTAssertNotNil(firstP1(after))
        XCTAssertEqual(firstP1(after), firstP1(before))
    }

    /// 3. V3 same words: the P2 phrase "Drop-off, 6 feet, left" plays out; the P1 at 2 m is a haptic, not a cut-off
    /// and a second identical phrase.
    func testExcerpt3SameWordsGiveTheHapticNotASecondPhrase() {
        let edge = { (t: Double) -> [HazardKind: Detection] in
            [.dropOff: Self.det(.dropOff, ahead: Float(2.4 - 0.5 * t), x: -0.34, walkerZ: Float(1.0 * t))]
        }
        let before = run(false, seconds: 1.4, walkerSpeed: { _ in 1 }, edge)
        let after = run(true, seconds: 1.4, walkerSpeed: { _ in 1 }, edge)
        XCTAssertEqual(before.phrases.map(\.phrase), ["Drop-off, 6 feet, left", "Drop-off, 6 feet, left"])
        XCTAssertEqual(before.cuts, 1)
        XCTAssertEqual(after.phrases.map(\.phrase), ["Drop-off, 6 feet, left"])
        XCTAssertEqual(after.cuts, 0)
        XCTAssertEqual(after.haptics.map(\.why), ["same words"])
        XCTAssertEqual(after.haptics.first?.t, before.haptics.first?.t, "the P1 cue at the same instant")
    }

    /// 4. Freed airtime: the repeated drop-off no longer starves a head-height hazard.
    func testExcerpt4FreedAirtimeGoesToNewHazards() {
        let scene = { (t: Double) -> [HazardKind: Detection] in
            var out: [HazardKind: Detection] = [:]
            let z = Float(1.2 * t)
            if t < 8 { out[.dropOff] = Self.det(.dropOff, ahead: 1.8, x: -0.34, walkerZ: z) } // sliding curb, P1
            if t >= 1 { // a fixed branch 14 m down the path, on the right
                out[.headHeight] = Detection(kind: .headHeight, point: SIMD3(0.5, 1.6, -14), ahead: 14 - z, lateral: 0.5,
                                             pointCount: 100)
            }
            return out
        }
        let before = run(false, seconds: 10, scene), after = run(true, seconds: 10, scene)
        let firstHead = { (d: Driver) in d.phrases.first { $0.phrase.hasPrefix("Head height") }?.t ?? .infinity }
        XCTAssertEqual(after.phrases.filter { $0.phrase.hasPrefix("Drop-off") }.count, 1)
        XCTAssertLessThanOrEqual(firstHead(after), 2.2)
        XCTAssertGreaterThan(firstHead(before), firstHead(after) + 2)
    }

    /// 5. A curb reached and stopped at: no truncated drop-off phrase, and "3 feet" is said at 1 m (the baseline
    /// never re-speaks a still world point at 1 m).
    func testExcerpt5OneMetreTierAndNoTruncatedPhrase() {
        let walked = { (t: Double) in Float(min(0.8 * t, 1.7)) } // 0.8 m/s, stops 0.9 m from the edge
        let edge = { (t: Double) -> [HazardKind: Detection] in
            [.dropOff: Self.det(.dropOff, ahead: 2.6 - walked(t), x: -0.34, walkerZ: walked(t))]
        }
        let speed = { (t: Double) -> Float in 0.8 * t < 1.7 ? 0.8 : 0 }
        let before = run(false, seconds: 6, walkerSpeed: speed, edge), after = run(true, seconds: 6, walkerSpeed: speed, edge)
        XCTAssertFalse(before.phrases.contains { $0.phrase == "Drop-off, 3 feet, left" })
        XCTAssertGreaterThanOrEqual(before.cuts, 1)
        XCTAssertTrue(after.phrases.contains { $0.phrase == "Drop-off, 3 feet, left" && $0.priority == 1 })
        XCTAssertEqual(after.cuts, 0)
        XCTAssertEqual(after.haptics.first?.t, before.haptics.first?.t, "2 m cue (queued haptic) at the same instant")
    }

    // MARK: Safety rules

    func testFirstAlertOfAnEpisodeIsNeverSuppressed() {
        var p = AlertPolicy()
        let far = Self.det(.dropOff, ahead: 2.5, x: -0.34)
        p.observe([.dropOff: far], now: 0)
        XCTAssertNotNil(p.next([.dropOff: far], now: 0, playing: nil), "new episode")
        p.markAnnounced(far, now: 0); p.noteSpoken(far, now: 0)
        // Cut off before it was heard: the episode speaks next.
        p.unmark(far)
        p.observe([.dropOff: far], now: 0.2)
        XCTAssertNotNil(p.next([.dropOff: far], now: 0.2, playing: nil))
        // Head height is gated too, and its first alert plays.
        let head = Self.det(.headHeight, ahead: 3, x: 0.5)
        p.observe([.headHeight: head], now: 0.4)
        XCTAssertNotNil(p.next([.headHeight: head], now: 0.4, playing: nil))
        // The edge gone for longer than the track gap, then a curb 1 m farther on: a new episode, spoken.
        let later = Self.det(.dropOff, ahead: 2.5, x: -0.34, walkerZ: 1)
        p.observe([.dropOff: later], now: 1)
        XCTAssertNotNil(p.next([.dropOff: later], now: 1, playing: nil))
    }

    func testDropOffWithinTwoMetresOnANewEdgeCuesAtOnce() {
        for muted in [false, true] {
            var p = AlertPolicy()
            p.setMuted(muted, now: 0)
            let left = Self.det(.dropOff, ahead: 1.8, x: -0.34)
            p.observe([.dropOff: left], now: 0)
            XCTAssertNotNil(p.next([.dropOff: left], now: 0, playing: nil))
            p.markAnnounced(left, now: 0); p.noteSpoken(left, now: 0)
            // Same edge, sliding: silent. A new edge on the right within 2 m: at once, even over a P2 phrase.
            let slid = Self.det(.dropOff, ahead: 1.8, x: -0.34, walkerZ: 1)
            p.observe([.dropOff: slid], now: 0.2)
            XCTAssertNil(p.next([.dropOff: slid], now: 0.2, playing: nil))
            let right = Self.det(.dropOff, ahead: 1.5, x: 0.34, walkerZ: 1)
            p.observe([.dropOff: right], now: 0.4)
            let p2 = AlertPolicy.Playing(priority: 2, hazard: Self.det(.headHeight, ahead: 3), endsAt: 2, startedAt: 0)
            XCTAssertEqual(p.next([.dropOff: right], now: 0.4, playing: p2)?.lateral, 0.34, "muted: \(muted)")
            XCTAssertNil(p.holdBehindSameEdge(right, playing: p2, now: 0.4, walkerSpeed: 1), "V3 holds only the same edge")
            // A P2 about the left edge playing: the right edge is another edge, it is not held.
            let p2Left = AlertPolicy.Playing(priority: 2, hazard: Self.det(.dropOff, ahead: 2.5, x: -0.34), endsAt: 2)
            XCTAssertNil(p.holdBehindSameEdge(right, playing: p2Left, now: 0.4, walkerSpeed: 1))
        }
    }

    func testMuteStillNeverSilencesPriorityOneWithEpisodes() {
        var p = AlertPolicy()
        p.setMuted(true, now: 0)
        let drop = Self.det(.dropOff, ahead: 1.5, x: -0.34)
        var car = Self.det(.closing, ahead: 8, x: 1)
        car.closing = .init(speed: 6, ttc: 1.3, label: "Car", trackId: 3)
        var object = Self.det(.closing, ahead: 3, x: 0)
        object.closing = .init(speed: 3, ttc: 1, trackId: 4)
        for d in [drop, car, object] {
            p.observe([d.kind: d], now: 1)
            XCTAssertEqual(p.next([d.kind: d], now: 1, playing: nil)?.kind, d.kind)
        }
        // A closing object repeats on its own clock: episodes never touch it.
        p.markAnnounced(car, now: 1)
        p.observe([.closing: car], now: 1 + Tuning.closingRepeatSeconds)
        XCTAssertNotNil(p.next([.closing: car], now: 1 + Tuning.closingRepeatSeconds, playing: nil))
        // Muted: an unspoken P2 drop-off stays unspoken, so its episode still speaks at 2 m.
        var q = AlertPolicy()
        q.setMuted(true, now: 0)
        let p2 = Self.det(.dropOff, ahead: 2.4, x: -0.34)
        q.observe([.dropOff: p2], now: 0)
        XCTAssertNil(q.next([.dropOff: p2], now: 0, playing: nil))
        let p1 = Self.det(.dropOff, ahead: 1.95, x: -0.34)
        q.observe([.dropOff: p1], now: 0.2)
        XCTAssertNotNil(q.next([.dropOff: p1], now: 0.2, playing: nil))
    }

    func testJumpGuardStartsANewEpisode() {
        var p = AlertPolicy()
        let d = Self.det(.dropOff, ahead: 2.9, x: -0.34)
        p.observe([.dropOff: d], now: 0)
        p.markAnnounced(d, now: 0); p.noteSpoken(d, now: 0)
        var t = 0.0, z: Float = 0
        for _ in 0..<10 { // the walker follows the edge: the world point slides 2.4 m, one episode, silent
            t += 0.2; z += 0.24
            let slid = Self.det(.dropOff, ahead: 2.9, x: -0.34, walkerZ: z)
            p.observe([.dropOff: slid], now: t)
            XCTAssertNil(p.next([.dropOff: slid], now: t, playing: nil))
        }
        let jumped = Self.det(.dropOff, ahead: 2.3, x: -0.34, walkerZ: z) // 0.6 m nearer in one frame
        p.observe([.dropOff: jumped], now: t + 0.2)
        XCTAssertNotNil(p.next([.dropOff: jumped], now: t + 0.2, playing: nil))
    }

    func testHapticReminderEveryFiveSecondsAndNoAudio() {
        var sim = Driver()
        for i in 0...60 { // curb at 1.8 m on the left for 12 s, sliding with the walker
            let t = Double(i) * 0.2
            sim.step([.dropOff: Self.det(.dropOff, ahead: 1.8, x: -0.34, walkerZ: Float(1.2 * t))], now: t)
        }
        XCTAssertEqual(sim.phrases.count, 1, "the reminder never plays audio")
        XCTAssertEqual(sim.haptics.map(\.why), ["phrase", "reminder", "reminder"])
        XCTAssertEqual(sim.haptics.map(\.t), [0, 5, 10])
        // Beyond 2 m, or before any P1 cue: no reminder.
        var p = AlertPolicy()
        let p2 = Self.det(.dropOff, ahead: 2.5, x: -0.34)
        p.observe([.dropOff: p2], now: 0); p.markAnnounced(p2, now: 0); p.noteSpoken(p2, now: 0)
        let near = Self.det(.dropOff, ahead: 1.9, x: -0.34)
        p.observe([.dropOff: near], now: 6)
        XCTAssertFalse(p.dropOffReminderDue([.dropOff: near], now: 6))
        // Flag off: none.
        flags(false); Tuning.alertEpisodes = true
        var off = Driver()
        for i in 0...60 {
            let t = Double(i) * 0.2
            off.step([.dropOff: Self.det(.dropOff, ahead: 1.8, x: -0.34, walkerZ: Float(1.2 * t))], now: t)
        }
        XCTAssertEqual(off.haptics.map(\.why), ["phrase"])
    }
}

/// AlertPolicyTests again, with Tuning.alertEpisodes and dropOffHapticReminder off: the HEAD rules unchanged.
final class AlertPolicyFlagsOffTests: XCTestCase {
    override class var defaultTestSuite: XCTestSuite {
        let suite = FlagsOffSuite(name: "AlertPolicyTests (flags off)")
        FlagsOffProbe.probe.forEach(suite.addTest)
        AlertPolicyTests.defaultTestSuite.tests.forEach(suite.addTest)
        return suite
    }
}

private final class FlagsOffSuite: XCTestSuite {
    override func perform(_ run: XCTestRun) {
        let saved = (Tuning.alertEpisodes, Tuning.dropOffHapticReminder)
        Tuning.alertEpisodes = false
        Tuning.dropOffHapticReminder = false
        defer { (Tuning.alertEpisodes, Tuning.dropOffHapticReminder) = saved }
        super.perform(run)
    }
}

/// Proves the suite above really runs with the flags off. Runs only inside it.
final class FlagsOffProbe: XCTestCase {
    static var probe: [XCTest] { [FlagsOffProbe(selector: #selector(testFlagsAreOff))] }
    override class var defaultTestSuite: XCTestSuite { XCTestSuite(name: "FlagsOffProbe") }
    @objc func testFlagsAreOff() {
        XCTAssertFalse(Tuning.alertEpisodes)
        XCTAssertFalse(Tuning.dropOffHapticReminder)
    }
}
