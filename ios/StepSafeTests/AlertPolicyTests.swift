import XCTest
import simd

final class AlertPolicyTests: XCTestCase {
    func det(_ kind: HazardKind, ahead: Float, x: Float = 0) -> Detection {
        Detection(kind: kind, point: SIMD3(x, 0, -ahead), ahead: ahead, lateral: x, pointCount: 100)
    }

    func testSpokenDistanceIsTheMetreBucketInFlooredFeet() {
        for (metres, feet) in zip(1...5, [3, 6, 9, 13, 16]) {
            XCTAssertEqual(AlertPolicy.phrase(det(.dropOff, ahead: Float(metres))), "Drop-off, \(feet) feet, ahead")
        }
    }

    func testMuteNeverSilencesPriorityOne() {
        var p = AlertPolicy()
        p.setMuted(true, now: 0)
        let drop = det(.dropOff, ahead: 1.5)
        XCTAssertEqual(AlertPolicy.priority(drop), 1)
        XCTAssertEqual(p.next([.dropOff: drop], now: 1, playing: nil)?.kind, .dropOff)
    }

    func testMuteSilencesPriorityTwoAndLower() {
        var p = AlertPolicy()
        p.setMuted(true, now: 0)
        let hazards: [HazardKind: Detection] = [
            .headHeight: det(.headHeight, ahead: 2), .ground: det(.ground, ahead: 3), .dropOff: det(.dropOff, ahead: 2.5),
        ]
        XCTAssertNil(p.next(hazards, now: 1, playing: nil))
        XCTAssertNotNil(p.next(hazards, now: Tuning.muteDuration + 1, playing: nil), "mute runs out")
    }

    func testHigherPriorityCutsOffLower() {
        let p = AlertPolicy()
        let hazards: [HazardKind: Detection] = [.dropOff: det(.dropOff, ahead: 1.5), .ground: det(.ground, ahead: 1)]
        XCTAssertEqual(p.next(hazards, now: 0, playing: 3)?.kind, .dropOff)
        XCTAssertNil(p.next(hazards, now: 0, playing: 1))
        XCTAssertNil(p.next([.ground: det(.ground, ahead: 1)], now: 0, playing: 3), "equal priority waits")
    }

    func testSameHazardNotRepeatedWithin30sUnlessClose() {
        var p = AlertPolicy()
        let far = det(.ground, ahead: 4)
        p.markAnnounced(far, now: 0)
        XCTAssertNil(p.next([.ground: det(.ground, ahead: 3.5)], now: 5, playing: nil))
        // The user walks up: the obstacle's world point stays put but is now 1.8 m ahead.
        var close = far; close.ahead = 1.8
        XCTAssertNotNil(p.next([.ground: close], now: 6, playing: nil), "re-announced once when within 2 m")
        p.markAnnounced(close, now: 6)
        XCTAssertNil(p.next([.ground: close], now: 7, playing: nil), "only once")
        XCTAssertNotNil(p.next([.ground: close], now: 6 + Tuning.repeatWindow, playing: nil), "window over")
    }

    func testIdentityIsFirstAnnouncedPointAndDoesNotChain() {
        var p = AlertPolicy()
        p.markAnnounced(det(.ground, ahead: 4), now: 0)
        XCTAssertNil(p.next([.ground: det(.ground, ahead: 3.4)], now: 1, playing: nil), "0.6 m away: same")
        // Seen at 3.4 m (not announced), then at 3.2 m: 0.8 m from the first point, so a new hazard.
        XCTAssertNotNil(p.next([.ground: det(.ground, ahead: 3.2)], now: 2, playing: nil))
    }

    func testClearHistoryForgetsAnnouncements() {
        var p = AlertPolicy()
        let d = det(.headHeight, ahead: 3)
        p.markAnnounced(d, now: 0)
        XCTAssertNil(p.next([.headHeight: d], now: 1, playing: nil))
        p.clearHistory()
        XCTAssertNotNil(p.next([.headHeight: d], now: 1, playing: nil))
    }

    func testNoticeCannotCutPriorityOneOrTwo() {
        let notice = AlertPolicy.onRequestPriority
        XCTAssertFalse(AlertPolicy.mayStart(notice, over: 1))
        XCTAssertFalse(AlertPolicy.mayStart(notice, over: 2))
        XCTAssertTrue(AlertPolicy.mayStart(notice, over: 3))
        XCTAssertTrue(AlertPolicy.mayStart(notice, over: nil))
        XCTAssertTrue(AlertPolicy.mayStart(1, over: notice), "any hazard cuts a notice")
    }

    func testCutOffAlertIsUnmarkedAndReplays() {
        var p = AlertPolicy()
        let d = det(.ground, ahead: 3)
        p.markAnnounced(d, now: 0)
        XCTAssertNil(p.next([.ground: d], now: 1, playing: nil))
        p.unmark(d)
        XCTAssertNotNil(p.next([.ground: d], now: 1, playing: nil))
    }

    func testServerPhraseIsCutOffByEveryHazardAlert() {
        // A spoken label or heads-up playing must never delay a warning, including a new ground obstacle (3).
        for p in 1...3 { XCTAssertTrue(AlertPolicy.mayStart(p, over: AlertPolicy.serverPhrasePriority), "\(p)") }
        let ground = Detection(kind: .ground, point: SIMD3(0, 0.5, -2), ahead: 2, lateral: 0, pointCount: 100)
        let policy = AlertPolicy()
        XCTAssertNotNil(policy.next([.ground: ground], now: 0, playing: AlertPolicy.serverPhrasePriority))
        XCTAssertNil(policy.next([.ground: ground], now: 0, playing: 3)) // a real priority 3 still is not cut by 3
    }

    func testSlopeThatTurnsOutToBeADropOffIsSaidAgain() {
        // Said "Slope down" at 1.5 m; the same hazard is then labelled "Drop-off": due at once (the scarier words),
        // once only. The reverse (Drop-off, then Slope) is not repeated.
        var p = AlertPolicy()
        var slope = det(.dropOff, ahead: 1.5); slope.slope = true
        p.markAnnounced(slope, now: 0)
        XCTAssertNil(p.next([.dropOff: slope], now: 1, playing: nil), "same label: not repeated")
        var steep = slope; steep.slope = false; steep.ahead = 1.4
        XCTAssertEqual(p.next([.dropOff: steep], now: 1, playing: nil)?.slope, false)
        XCTAssertEqual(AlertPolicy.phrase(steep), "Drop-off, 3 feet, ahead")
        p.markAnnounced(steep, now: 1)
        XCTAssertNil(p.next([.dropOff: steep], now: 2, playing: nil), "only once")
        XCTAssertNil(p.next([.dropOff: slope], now: 3, playing: nil), "back to slope: nothing new")
        var q = AlertPolicy()
        q.markAnnounced(steep, now: 0)
        XCTAssertNil(q.next([.dropOff: slope], now: 1, playing: nil), "Drop-off then Slope: not repeated")
    }

    func testFollowOnDropOffAheadClearsTheSlopeRecord() {
        // "Car approaching... " then the follow-on "Drop-off ahead." for a hazard first said as "Slope down": the
        // record becomes Drop-off, so a later Drop-off label is not said a third time.
        var p = AlertPolicy()
        var slope = det(.dropOff, ahead: 1.5); slope.slope = true
        p.markAnnounced(slope, now: 0)
        var follow = slope; follow.followOn = true
        XCTAssertEqual(AlertPolicy.phrase(follow), AlertPolicy.dropOffAhead)
        p.markAnnounced(follow, now: 1)
        var steep = slope; steep.slope = false
        XCTAssertNil(p.next([.dropOff: steep], now: 2, playing: nil))
    }

    // MARK: Same-edge dedupe (drop-offs)

    func drop(_ x: Float, _ z: Float, ahead: Float, lateral: Float = 0) -> Detection {
        Detection(kind: .dropOff, point: SIMD3(x, 0, z), ahead: ahead, lateral: lateral, pointCount: 300)
    }

    /// Runs decide() every frame at analysisHz like AlertManager, marking what it returns as announced.
    func run(_ p: inout AlertPolicy, _ frames: [(Double, Detection?)]) -> [(Double, Detection)] {
        var said: [(Double, Detection)] = []
        for (t, d) in frames {
            if let a = p.decide(d.map { [.dropOff: $0] } ?? [:], now: t, playing: nil) { p.markAnnounced(a, now: t); said.append((t, a)) }
        }
        return said
    }

    func testDropPointMovingWithTheWalkerIsOneEdge() {
        // A sloping edge whose nearest drop point stays 1.0 m ahead while the walker walks 1.2 m/s for 20 s: said once
        // (today: again every 0.75 m).
        var p = AlertPolicy()
        let hz = Tuning.analysisHz
        let said = run(&p, (0..<Int(20 * hz)).map { k in
            let z = -1 - 1.2 * Float(k) / Float(hz)
            return (Double(k) / hz, drop(0, z, ahead: 1.0))
        })
        XCTAssertEqual(said.count, 1)
    }

    func testEdgeDedupeSwitchOffIsToday() {
        // Tuning.edgeDedupeOn off: the same moving edge is said again every sameHazardRadius (today's behaviour).
        UserDefaults.standard.set(false, forKey: Tuning.edgeDedupeKey)
        defer { UserDefaults.standard.removeObject(forKey: Tuning.edgeDedupeKey) }
        var p = AlertPolicy()
        let hz = Tuning.analysisHz
        let said = run(&p, (0..<Int(20 * hz)).map { k in
            let z = -1 - 1.2 * Float(k) / Float(hz)
            return (Double(k) / hz, drop(0, z, ahead: 1.0))
        })
        XCTAssertGreaterThan(said.count, 20)
    }

    func testCornerCurbAfterAParallelCurbIsANewEdge() {
        // A curb running beside the walker (nearest drop point 1.0 m ahead, 0.3 m left, moving with them), then the
        // corner curb across the path 1.8 m ahead: the drop point moved away by 0.8 m, so it is a new edge.
        var p = AlertPolicy()
        let hz = Tuning.analysisHz
        var frames: [(Double, Detection?)] = (0..<Int(3 * hz)).map { k in
            (Double(k) / hz, drop(-0.3, -1 - 1.2 * Float(k) / Float(hz), ahead: 1.0, lateral: -0.3))
        }
        let z0 = -1 - 1.2 * 3 as Float
        frames += (0..<Int(hz)).map { k in (3 + Double(k) / hz, drop(0, z0 - 0.8, ahead: 1.8 - 1.2 * Float(k) / Float(hz))) }
        XCTAssertEqual(run(&p, frames).count, 2)
    }

    /// Which consecutive or distinct edges re-announce and which merge under the OR identity rule (+ recede).
    func testRapidConsecutiveCurbsMergeOrReannounce() {
        let hz = Tuning.analysisHz
        // Walker at 1.2 m/s: curb A at z = -2 seen from 2.0 m down to 1.0 m ahead, 0.5 s without a drop-off, then
        // curb B at z = -3.5 (1.5 m further in the world, 1.9 m ahead): re-announced (recede rule).
        var p = AlertPolicy()
        var frames: [(Double, Detection?)] = (0..<Int(0.8 * hz)).map { k in
            let t = Double(k) / hz; return (t, drop(0, -2, ahead: 2 - 1.2 * Float(t)))
        }
        frames += (0..<Int(0.5 * hz)).map { (0.8 + Double($0) / hz, nil) }
        frames += (0..<Int(hz)).map { k in
            let t = 1.3 + Double(k) / hz; return (t, drop(0, -3.5, ahead: 3.5 - 1.2 * Float(t)))
        }
        XCTAssertEqual(run(&p, frames).count, 2, "consecutive curbs")
        // Sub-1 m: curb B only 0.8 m beyond A (z = -2.8, 1.26 m ahead after the gap): within edgeJumpM in the world and
        // not receding, so merged - said once (documented residual; B is within the close band A already used).
        var s = AlertPolicy()
        var near: [(Double, Detection?)] = Array(frames.prefix(Int(0.8 * hz) + Int(0.5 * hz)))
        near += (0..<Int(hz)).map { k in
            let t = 1.3 + Double(k) / hz; return (t, drop(0, -2.8, ahead: 2.8 - 1.2 * Float(t)))
        }
        XCTAssertEqual(run(&s, near).count, 1, "sub-1 m consecutive curb: merged")
        // Far in the world AND far relative to the walker (no recede): a new edge.
        var r = AlertPolicy()
        var far: [(Double, Detection?)] = (0..<Int(hz)).map { (Double($0) / hz, drop(0, -1.5, ahead: 1.5)) }
        far += (0..<Int(hz)).map { (1 + Double($0) / hz, drop(3, -2.5, ahead: 1.5, lateral: 1.4)) }
        XCTAssertEqual(run(&r, far).count, 2, "far in both frames")
        // Merged (OR rule, documented residual): 2 m away in the world but at the same spot relative to the walker
        // within 1 s - an ARKit position jump, or a quick head turn to another curb. Said once.
        var q = AlertPolicy()
        var turn: [(Double, Detection?)] = (0..<Int(hz)).map { (Double($0) / hz, drop(0, -1.5, ahead: 1.5)) }
        turn += (0..<Int(hz)).map { (1 + Double($0) / hz, drop(1.5, 0, ahead: 1.5)) }
        XCTAssertEqual(run(&q, turn).count, 1, "same relative spot: merged")
    }

    func testCloserBandIsSaidOnce() {
        // A fixed curb first said 2.6 m ahead; the walker closes in: said once more within 2 m, never again.
        var p = AlertPolicy()
        let hz = Tuning.analysisHz
        let said = run(&p, (0..<Int(2 * hz)).map { k in
            let t = Double(k) / hz
            return (t, drop(0, -2.6, ahead: 2.6 - 1.2 * Float(t)))
        })
        XCTAssertEqual(said.map { $0.1.ahead <= Tuning.repeatCloseDistance }, [false, true])
    }

    func testNewEdgeAfterACurbIsAnnounced() {
        let hz = Tuning.analysisHz
        // Stairs after a curb: the curb's drop-off ends (the walker steps down), 1.5 s later stairs 2 m further on.
        var p = AlertPolicy()
        var frames: [(Double, Detection?)] = (0..<Int(hz)).map { (Double($0) / hz, drop(0, -1.8, ahead: 1.8)) }
        frames += (0..<Int(1.5 * hz)).map { (1 + Double($0) / hz, nil) }
        frames += (0..<Int(hz)).map { (2.5 + Double($0) / hz, drop(0, -3.8, ahead: 1.8)) }
        XCTAssertEqual(run(&p, frames).count, 2, "stairs after a curb")
        // A second curb 3 m beyond the first, detected continuously: the drop point jumps 3 m -> a new edge.
        var q = AlertPolicy()
        var cont: [(Double, Detection?)] = (0..<Int(hz)).map { (Double($0) / hz, drop(0, -2.5, ahead: 2.5)) }
        cont += (0..<Int(hz)).map { (1 + Double($0) / hz, drop(0, -5.5, ahead: 5.5 - 1.2)) }
        XCTAssertEqual(run(&q, cont).count, 2, "second curb 3 m later")
    }
}
