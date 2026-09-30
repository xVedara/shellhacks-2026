import XCTest
import simd

final class FeedbackTests: XCTestCase {
    func det(_ kind: HazardKind, ahead: Float, x: Float = 0) -> Detection {
        Detection(kind: kind, point: SIMD3(x, 0, -ahead), ahead: ahead, lateral: x, pointCount: 100)
    }

    // MARK: Remote controls

    func testPlayPauseNeverMutes() {
        for command in [RemoteCommand.togglePlayPause, .play, .pause] {
            // Any number of presses, any spacing: always what's ahead (or ignored after a route change), never mute.
            for gap in [0.1, 0.5, 1.9, 5] {
                XCTAssertEqual(RemoteControls.action(command, sinceRouteChange: 100 + gap), .whatsAhead)
            }
        }
        XCTAssertEqual(RemoteControls.action(.play, sinceRouteChange: 0.5), .ignore, "AirPod in or out")
        XCTAssertEqual(RemoteControls.action(.pause, sinceRouteChange: 1.4), .ignore)
        XCTAssertEqual(RemoteControls.action(.pause, sinceRouteChange: 1.5), .whatsAhead)
        XCTAssertEqual(RemoteControls.action(.togglePlayPause, sinceRouteChange: 0.1), .whatsAhead)
    }

    func testNextTrackTogglesMuteAndMuteKeepsCarsAndNearDropOffs() {
        XCTAssertEqual(RemoteControls.action(.nextTrack, sinceRouteChange: 0), .toggleMute)
        XCTAssertEqual(RemoteControls.action(.nextTrack, sinceRouteChange: 100), .toggleMute)
        var p = AlertPolicy()
        p.setMuted(true, now: 0) // what .toggleMute does (AlertManager.toggleMute)
        let car = Detection(kind: .closing, point: SIMD3(2, 1, -6), ahead: 6.3, lateral: 2, pointCount: 0,
                            closing: .init(speed: 6, ttc: 1, label: "Car", trackId: 7))
        let closingObject = Detection(kind: .closing, point: SIMD3(0, 1, -3), ahead: 3, lateral: 0, pointCount: 50,
                                      closing: .init(speed: 2, ttc: 1.5, trackId: 8))
        for d in [car, closingObject, det(.dropOff, ahead: 2.0), det(.dropOff, ahead: 1.0)] {
            XCTAssertTrue(AlertPolicy.neverMuted(d))
            var q = p
            XCTAssertEqual(q.decide([d.kind: d], now: 1, playing: nil)?.kind, d.kind, "muted must still say \(AlertPolicy.phrase(d))")
        }
        var q = p
        XCTAssertNil(q.decide([.ground: det(.ground, ahead: 1), .headHeight: det(.headHeight, ahead: 1.5)], now: 1, playing: nil),
                     "routine alerts are off")
    }

    func testMuteNoticeSaysWhatStaysOnAndNoCopyClaimsSafety() {
        XCTAssertTrue(Notices.muted.contains("Routine alerts off"))
        XCTAssertTrue(Notices.muted.contains("Cars and drop-offs stay on"))
        for text in Notices.all {
            XCTAssertNil(text.range(of: "\\b(safe|clear)\\b", options: [.regularExpression, .caseInsensitive]), text)
        }
    }

    // MARK: Haptic grammar

    func testEachKindHasItsOwnPattern() {
        let kinds: [HapticGrammar.Kind] = [.closing, .dropOff, .headHeight, .ground, .fault]
        let patterns = kinds.map { HapticGrammar.events($0, urgent: false) }
        for i in patterns.indices {
            for j in patterns.indices where j > i { XCTAssertNotEqual(patterns[i], patterns[j], "\(kinds[i]) vs \(kinds[j])") }
        }
        XCTAssertEqual(HapticGrammar.events(.dropOff, urgent: true),
                       (0..<3).map { HapticEvent(time: Double($0) * 0.1, intensity: 1, sharpness: 1) }, "the original P1 triplet")
        let closing = HapticGrammar.events(.closing, urgent: true)
        XCTAssertEqual(closing.map(\.sharpness), closing.map(\.sharpness).sorted(), "rising")
        XCTAssertEqual(HapticGrammar.events(.headHeight, urgent: false).count, 2)
        XCTAssertEqual(HapticGrammar.events(.ground, urgent: false).count, 1)
        XCTAssertTrue(HapticGrammar.events(.fault, urgent: false).allSatisfy { $0.duration != nil }, "fault = long buzz, no taps")
        XCTAssertTrue(HapticGrammar.events(.closing, urgent: false).allSatisfy { $0.duration == nil })
    }

    func testPriorityOnePatternsAreFullStrength() {
        for kind in [HapticGrammar.Kind.closing, .dropOff, .headHeight, .ground] {
            XCTAssertTrue(HapticGrammar.events(kind, urgent: true).allSatisfy { $0.intensity == 1 }, "\(kind)")
        }
        // Every priority-1 hazard maps to an urgent pattern with the kind's own rhythm.
        for d in [det(.dropOff, ahead: 1.5), Detection(kind: .closing, point: .zero, ahead: 4, lateral: 0, pointCount: 0,
                                                        closing: .init(speed: 3, ttc: 1.2))] {
            XCTAssertTrue(AlertPolicy.neverMuted(d))
            XCTAssertEqual(HapticGrammar.events(HapticGrammar.kind(d.kind), urgent: true).map(\.time),
                           HapticGrammar.events(HapticGrammar.kind(d.kind), urgent: false).map(\.time))
        }
    }

    // MARK: Fault cue

    func testFaultCueGraceRepeatAndRecovery() {
        var f = FaultCue(grace: 2, repeatSeconds: 30)
        XCTAssertNil(f.update(down: true, scanning: true, now: 0))
        XCTAssertNil(f.update(down: true, scanning: true, now: 1.9))
        XCTAssertEqual(f.update(down: true, scanning: true, now: 2), .cue)
        XCTAssertNil(f.update(down: true, scanning: true, now: 20))
        XCTAssertEqual(f.update(down: true, scanning: true, now: 32), .cue, "repeats every 30 s")
        XCTAssertNil(f.update(down: true, scanning: true, now: 40))
        XCTAssertEqual(f.update(down: false, scanning: true, now: 41), .recovered)
        XCTAssertNil(f.update(down: false, scanning: true, now: 42), "recovered once")
    }

    func testFaultCueIgnoresShortDropsAndStoppedScanning() {
        var f = FaultCue(grace: 2, repeatSeconds: 30)
        XCTAssertNil(f.update(down: true, scanning: true, now: 0))
        XCTAssertNil(f.update(down: false, scanning: true, now: 1.5), "a blip below the grace: nothing, no recovery")
        XCTAssertNil(f.update(down: true, scanning: true, now: 2), "grace restarts")
        XCTAssertNil(f.update(down: true, scanning: true, now: 3.9))
        XCTAssertEqual(f.update(down: true, scanning: true, now: 4), .cue)
        XCTAssertNil(f.update(down: true, scanning: false, now: 5), "stopped: silent reset")
        XCTAssertNil(f.update(down: true, scanning: false, now: 100))
        XCTAssertNil(f.update(down: false, scanning: true, now: 101), "no recovery notice after a stop")
    }

    // MARK: Map heads-up

    func testHeadsUpIsAReportWithItsAge() {
        let home = Geo.Fix(lat: 25.7563, lng: -80.3739)
        let f = Geo.offset(home, east: 0, north: 12)
        let now = try! XCTUnwrap(Community.date("2026-09-30T12:00:00.000Z"))
        var pin = NearHazard(id: "p", type: "pothole", category: "fixed", lat: f.lat, lng: f.lng, heightBand: "ground",
                             confidence: 1, status: "active", label: "pothole", sample: false)
        let due = { HeadsUpState.Due(pin: pin, distanceM: 12, relativeDeg: 0) }
        XCTAssertEqual(Spoken.headsUp(due(), now: now), "Reported pothole, 40 feet, ahead", "no lastSeen: no age")
        pin.lastSeen = "2026-09-28T10:00:00.000Z"
        XCTAssertEqual(Spoken.headsUp(due(), now: now), "Reported pothole, 40 feet, ahead, 2 days ago")
        XCTAssertEqual(Spoken.headsUp(due(), lang: "es", now: now), "Reporte: pothole, 40 pies, al frente, hace 2 días")
        pin.lastSeen = "2026-09-30T09:00:00.000Z"
        XCTAssertEqual(Spoken.headsUp(due(), now: now), "Reported pothole, 40 feet, ahead, today")
        XCTAssertEqual(Spoken.reportAge(86_400 * 1.5), "1 day ago")
        XCTAssertEqual(Spoken.reportAge(86_400 * 21), "3 weeks ago")
        XCTAssertEqual(Spoken.reportAge(86_400 * 95, lang: "es"), "hace 3 meses")
        XCTAssertEqual(Spoken.reportAge(-50), "today", "clock skew")
        XCTAssertFalse(Spoken.headsUp(due(), now: now).contains("metre"))
    }
}
