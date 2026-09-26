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
}
