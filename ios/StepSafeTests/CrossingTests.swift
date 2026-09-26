import CoreGraphics
import XCTest
import simd

/// Crossing assist on a synthetic head rig (portrait, 1.6 m up, pitched down, facing -z), ray-cast depth at 12 Hz.
/// The scenarios follow the audit harness (scratchpad audit-s3), which found the head-yaw false alarms.
final class CrossingTests: XCTestCase {
    struct Box { var lo: SIMD3<Float>; var hi: SIMD3<Float> }

    /// + yaw = looking right (+x).
    func camera(_ pos: SIMD3<Float>, yawDeg: Float = 0, pitchDeg: Float = -15) -> simd_float4x4 {
        let base = simd_float3x3(SIMD3(0, 1, 0), SIMD3(-1, 0, 0), SIMD3(0, 0, 1))
        let pitch = simd_float3x3(simd_quatf(angle: pitchDeg * .pi / 180, axis: SIMD3(1, 0, 0)))
        let yaw = simd_float3x3(simd_quatf(angle: -yawDeg * .pi / 180, axis: SIMD3(0, 1, 0)))
        let r = yaw * pitch * base
        return simd_float4x4(SIMD4(r.columns.0, 0), SIMD4(r.columns.1, 0), SIMD4(r.columns.2, 0), SIMD4(pos, 1))
    }

    func hit(_ b: Box, _ o: SIMD3<Float>, _ d: SIMD3<Float>) -> Float? {
        var tMin: Float = 0, tMax = Float.greatestFiniteMagnitude
        for a in 0..<3 {
            if d[a] == 0 { if o[a] < b.lo[a] || o[a] > b.hi[a] { return nil }; continue }
            var t0 = (b.lo[a] - o[a]) / d[a], t1 = (b.hi[a] - o[a]) / d[a]
            if t0 > t1 { swap(&t0, &t1) }
            tMin = max(tMin, t0); tMax = min(tMax, t1)
            if tMin > tMax { return nil }
        }
        return tMin
    }

    func render(_ boxes: [Box], _ t: simd_float4x4) -> DepthFrame {
        let w = 256, h = 192
        let o = SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let rot = simd_float3x3(SIMD3(t.columns.0.x, t.columns.0.y, t.columns.0.z),
                                SIMD3(t.columns.1.x, t.columns.1.y, t.columns.1.z),
                                SIMD3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
        var depth = [Float](repeating: 0, count: w * h), conf = [UInt8](repeating: 0, count: w * h)
        for v in 0..<h {
            for u in 0..<w {
                let dir = rot * SIMD3((Float(u) + 0.5 - 128) / 212, -(Float(v) + 0.5 - 96) / 212, -1)
                var best: Float = .infinity
                if dir.y < 0 { best = -o.y / dir.y } // floor at y = 0
                for b in boxes { if let d = hit(b, o, dir), d < best { best = d } }
                guard best < 8 else { continue }
                depth[v * w + u] = best
                conf[v * w + u] = 2
            }
        }
        return DepthFrame(depth: depth, confidence: conf, width: w, height: h,
                          intrinsics: simd_float3x3(SIMD3(212, 0, 0), SIMD3(0, 212, 0), SIMD3(128, 96, 1)),
                          cameraTransform: t, floorY: 0)
    }

    /// First trigger (time, object), or nil.
    func run(seconds: Double, scene: (Double) -> [Box], cam: (Double) -> simd_float4x4) -> (t: Double, c: ClosingObject)? {
        var det = ClosingDetector()
        for i in 0...Int(seconds * 12) {
            let t = Double(i) / 12
            if let c = det.update(render(scene(t), cam(t)), time: t).first { return (t, c) }
        }
        return nil
    }

    func cart(at c: SIMD2<Float>) -> [Box] { // 0.5 w x 1.0 h x 0.8 deep, front face at c
        [Box(lo: SIMD3(c.x - 0.25, 0, c.y - 0.8), hi: SIMD3(c.x + 0.25, 1.0, c.y))]
    }

    // MARK: Depth closing detector

    func testCartAt1_2mpsFrom5mTriggersBy4mWithSideAndTTC() throws {
        let hit = try XCTUnwrap(run(seconds: 3, scene: { t in self.cart(at: SIMD2(0.8, -5 + 1.2 * Float(t))) },
                                    cam: { _ in self.camera(SIMD3(0, 1.6, 0)) }))
        XCTAssertGreaterThanOrEqual(hit.c.range, 3.5) // announced by 4 m at the latest (range < closeRangeM)
        XCTAssertLessThanOrEqual(hit.c.range, Tuning.closeRangeM + 0.05)
        XCTAssertEqual(hit.c.speed, 1.2, accuracy: 0.25)
        XCTAssertEqual(hit.c.ttc, hit.c.range / hit.c.speed, accuracy: 0.4)
        XCTAssertLessThan(hit.c.missM, Tuning.closingMissM)
        let d = Detection(kind: .closing, point: hit.c.point, ahead: hit.c.range, lateral: hit.c.lateral, pointCount: 0,
                          closing: .init(speed: hit.c.speed, ttc: hit.c.ttc, label: nil))
        XCTAssertEqual(AlertPolicy.phrase(d), "Object approaching, right")
        XCTAssertEqual(AlertPolicy.priority(d), 1)
    }

    func testWalkingTowardWallWithHeadYawDoesNotTrigger() {
        let wall = [Box(lo: SIMD3(-10, 0, -7.2), hi: SIMD3(10, 2.5, -7))]
        for walk: Float in [1.2, 1.5] {
            for yaw: Float in [20, 30, 40] {
                XCTAssertNil(run(seconds: 4.5, scene: { _ in wall },
                                 cam: { t in self.camera(SIMD3(0, 1.6, -walk * Float(t)), yawDeg: yaw) }),
                             "walk \(walk) m/s, yaw \(yaw)")
            }
        }
    }

    func testWalkingPastParkedBoxWithYawDoesNotTrigger() {
        let parked = [Box(lo: SIMD3(0.7, 0, -5), hi: SIMD3(1.5, 1.4, -3.2))]
        for yaw: Float in [0, 30] {
            XCTAssertNil(run(seconds: 5, scene: { _ in parked },
                             cam: { t in self.camera(SIMD3(0, 1.6, -1.3 * Float(t)), yawDeg: yaw) }), "yaw \(yaw)")
        }
    }

    func testSlowDriftDoesNotTrigger() {
        XCTAssertNil(run(seconds: 3, scene: { t in self.cart(at: SIMD2(0.3, -3.5 + 0.4 * Float(t))) },
                         cam: { _ in self.camera(SIMD3(0, 1.6, 0)) }))
    }

    func testCrossTrafficCartIsTrackedAcrossBins() throws {
        // Diagonal from front-left at 45 degrees, 1.3 m/s (0.92 m/s sideways): it sweeps across many 2-degree
        // bins and aims at the walker, so it is reported (tracked by world position, not by bin).
        let hit = try XCTUnwrap(run(seconds: 3, scene: { t in
            let d = Float(1.3 * t) / Float(2).squareRoot()
            return self.cart(at: SIMD2(-3.2 + d, -3.2 + d))
        }, cam: { _ in self.camera(SIMD3(0, 1.6, 0), yawDeg: -30) }))
        XCTAssertLessThan(hit.c.lateral, 0) // still on the left when announced
        XCTAssertLessThan(hit.c.missM, Tuning.closingMissM)
        // Purely sideways crossing 3 m ahead: it never reaches the walker, so nothing is said.
        XCTAssertNil(run(seconds: 3, scene: { t in self.cart(at: SIMD2(-2 + 1.2 * Float(t), -3)) },
                         cam: { _ in self.camera(SIMD3(0, 1.6, 0)) }))
    }

    func testOncomingPedestrianOnlyWhenOnCollisionCourse() {
        func pedestrian(_ lateral: Float) -> (Double) -> [Box] {
            { t in
                let z = -6.5 + 1.3 * Float(t)
                return [Box(lo: SIMD3(lateral - 0.25, 0, z - 0.3), hi: SIMD3(lateral + 0.25, 1.7, z))]
            }
        }
        let walker: (Double) -> simd_float4x4 = { t in self.camera(SIMD3(0, 1.6, -1.3 * Float(t))) }
        XCTAssertNotNil(run(seconds: 2.5, scene: pedestrian(0.3), cam: walker)) // will bump into the walker
        XCTAssertNil(run(seconds: 2.5, scene: pedestrian(1.6), cam: walker)) // passes beside: no alert
    }

    func testClosingDetectorCost() {
        var det = ClosingDetector()
        let frame = render(cart(at: SIMD2(0.4, -3)), camera(SIMD3(0, 1.6, 0)))
        let start = DispatchTime.now().uptimeNanoseconds
        for i in 0..<24 { _ = det.update(frame, time: Double(i) / 12) }
        let ms = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6 / 24
        print("CLOSING_COST_MS \(String(format: "%.2f", ms)) per 256x192 frame")
        XCTAssertLessThan(ms, 40)
    }

    // MARK: Ara's hard rule: closing alerts are priority 1, never muted, never cut off, never delayed

    func closing(range: Float, lateral: Float = 0, label: String? = nil) -> Detection {
        Detection(kind: .closing, point: SIMD3(lateral, 1, -range), ahead: range, lateral: lateral, pointCount: 0,
                  closing: .init(speed: 2, ttc: range / 2, label: label))
    }

    func testMutedClosingStillPlaysAsPriorityOne() {
        var policy = AlertPolicy()
        policy.setMuted(true, now: 0)
        let far = closing(range: 3.9)
        XCTAssertEqual(AlertPolicy.priority(far), 1) // no "far" tier any more
        XCTAssertTrue(AlertPolicy.neverMuted(far))
        let ground = Detection(kind: .ground, point: SIMD3(0, 0.5, -2), ahead: 2, lateral: 0, pointCount: 100)
        XCTAssertEqual(policy.next([.closing: far, .ground: ground], now: 1, playing: nil)?.kind, .closing)
        XCTAssertNil(policy.next([.ground: ground], now: 1, playing: nil))
    }

    func testPriorityOneOrderedByTimeToContactAndPreemption() {
        func car(_ range: Float, id: Int, ttc: Float) -> Detection {
            Detection(kind: .closing, point: SIMD3(1, 1, -range), ahead: range, lateral: 1, pointCount: 0,
                      closing: .init(speed: 2, ttc: ttc, label: "Car", trackId: id))
        }
        let drop = Detection(kind: .dropOff, point: SIMD3(0, 0, -1.5), ahead: 1.5, lateral: 0, pointCount: 300)
        // Drop-off TTC = 1.5 m / walker speed (floor 0.5 m/s) = 3 s standing, 1.15 s walking 1.3 m/s.
        XCTAssertEqual(AlertPolicy.ttc(drop, walkerSpeed: 0), 3, accuracy: 1e-5)
        XCTAssertEqual(AlertPolicy.mostUrgent([drop, car(10, id: 1, ttc: 2)], walkerSpeed: 0)?.kind, .closing)
        XCTAssertEqual(AlertPolicy.mostUrgent([drop, car(10, id: 1, ttc: 2)], walkerSpeed: 1.3)?.kind, .dropOff)
        // A vehicle only passing by (kept at a curb) sorts after the drop-off.
        var passing = car(8, id: 3, ttc: 0.8); passing.closing?.passing = true
        XCTAssertEqual(AlertPolicy.mostUrgent([drop, passing], walkerSpeed: 0)?.kind, .dropOff)
        // Pre-emption among priority 1 (closing vs closing): clip >= 0.8 s old, too little lead after it, 0.3 s more urgent.
        // Playing: car 1 (TTC 3 s when it started at t = 0), clip ends at t = 2.6.
        let playingA = AlertPolicy.Playing(priority: 1, hazard: car(4, id: 1, ttc: 3), endsAt: 2.6, startedAt: 0, ttcAtStart: 3)
        XCTAssertTrue(AlertPolicy.mayStart(car(6, id: 2, ttc: 1.2), over: playingA, now: 0.9, walkerSpeed: 0)) // 1.2 < 1.7 left, < 2.1 - 0.3
        XCTAssertFalse(AlertPolicy.mayStart(car(6, id: 2, ttc: 1.2), over: playingA, now: 0.5, walkerSpeed: 0)) // clip under 0.8 s old
        XCTAssertFalse(AlertPolicy.mayStart(car(6, id: 2, ttc: 1.9), over: playingA, now: 0.9, walkerSpeed: 0)) // not 0.3 s more urgent
        XCTAssertFalse(AlertPolicy.mayStart(car(6, id: 2, ttc: 2.5), over: playingA, now: 0.9, walkerSpeed: 0)) // waits (tone+haptic now)
        XCTAssertFalse(AlertPolicy.mayStart(car(3, id: 1, ttc: 0.5), over: playingA, now: 0.9, walkerSpeed: 0)) // same object never
        XCTAssertTrue(AlertPolicy.mayStart(car(6, id: 2, ttc: 1.0), over: AlertPolicy.Playing(priority: 1, hazard: drop, endsAt: 2,
                                           startedAt: 0, ttcAtStart: 3), now: 0.9, walkerSpeed: 0))
        // One-way: once car 2 cut car 1 off, car 1 cannot cut car 2 back while car 2 plays.
        var oneWay = AlertPolicy()
        oneWay.noteCutOff(victim: car(4, id: 1, ttc: 1), by: car(6, id: 2, ttc: 1.2), until: 3)
        let playingB = AlertPolicy.Playing(priority: 1, hazard: car(6, id: 2, ttc: 3), endsAt: 3, startedAt: 0, ttcAtStart: 3)
        XCTAssertTrue(AlertPolicy.mayStart(car(4, id: 1, ttc: 0.4), over: playingB, now: 1.0, walkerSpeed: 0)) // the static rule alone would
        XCTAssertFalse(oneWay.mayStart(car(4, id: 1, ttc: 0.4), over: playingB, now: 1.0, walkerSpeed: 0)) // but not back
        // Lower priorities, notices and server phrases never block a closing alert; notices wait behind it.
        let ground = Detection(kind: .ground, point: SIMD3(0, 0.5, -2), ahead: 2, lateral: 0, pointCount: 100)
        XCTAssertTrue(AlertPolicy.mayStart(car(6, id: 2, ttc: 2.5), over: AlertPolicy.Playing(priority: 3, hazard: ground, endsAt: 9), now: 0, walkerSpeed: 0))
        XCTAssertEqual(AlertPolicy().next([.closing: car(3, id: 5, ttc: 2)], now: 0, playing: AlertPolicy.serverPhrasePriority)?.kind, .closing)
        XCTAssertEqual(AlertPolicy().next([.closing: car(3, id: 5, ttc: 2)], now: 0, playing: AlertPolicy.onRequestPriority)?.kind, .closing)
        XCTAssertFalse(AlertPolicy.mayStart(AlertPolicy.onRequestPriority, over: 1))
        var q = NoticeQueue<String>()
        q.push("Path guard paused", server: false, now: 0)
        XCTAssertNil(q.pop(playing: 1, now: 0))
    }

    func testClosingIdentityByTrackIdAndRepeat() {
        var policy = AlertPolicy()
        let a = Detection(kind: .closing, point: SIMD3(0, 1, -3), ahead: 3, lateral: 0, pointCount: 0,
                          closing: .init(speed: 1.4, ttc: 2.1, label: nil, trackId: 1))
        policy.markAnnounced(a, now: 0)
        var aLater = a; aLater.point = SIMD3(0, 1, -1.5) // moved 1.5 m: still the same object (id)
        XCTAssertNil(policy.next([.closing: aLater], now: 1, playing: nil))
        XCTAssertNotNil(policy.next([.closing: aLater], now: Tuning.closingRepeatSeconds + 0.01, playing: nil)) // one clip later
        var b = a; b.closing?.trackId = 2 // pedestrian B on the same line: a new object right away
        XCTAssertNotNil(policy.next([.closing: b], now: 1, playing: nil))
    }

    func testCrossingPhrases() {
        XCTAssertEqual(AlertPolicy.phrase(closing(range: 10, lateral: 4, label: "Car")), "Car approaching, right")
        XCTAssertEqual(AlertPolicy.phrase(closing(range: 10, lateral: -4, label: "Car")), "Car approaching, left")
        XCTAssertEqual(AlertPolicy.phrase(closing(range: 3, lateral: 0.3)), "Object approaching, ahead")
        let drop = Detection(kind: .dropOff, point: SIMD3(0, 0, -1.2), ahead: 1.2, lateral: 0, pointCount: 300)
        let advice = AlertPolicy.whatsAheadPhrase([.dropOff: drop], atCurb: true)
        XCTAssertEqual(advice, "Drop-off, 1 meter, ahead. Nothing detected. Listen before crossing.")
        XCTAssertEqual(AlertPolicy.whatsAheadPhrase([:], atCurb: true), Notices.listenBeforeCrossing)
        XCTAssertEqual(AlertPolicy.whatsAheadPhrase([:], atCurb: false), "Nothing detected ahead")
        XCTAssertEqual(AlertPolicy.whatsAheadPhrase([.dropOff: drop, .closing: closing(range: 8, lateral: 3, label: "Car")],
                                                    atCurb: true), "Car approaching, right")
        for phrase in [advice] + Notices.all {
            XCTAssertNil(phrase.range(of: "\\b(go|safe|clear)\\b", options: [.regularExpression, .caseInsensitive]), phrase)
        }
    }

    // MARK: YOLO tracker (world bearings, angular height)

    /// Sensor 1920x1440, f 1580, portrait head rig with yaw; a car (1.5 m tall, 1.8 m wide) at world point `p`.
    func carBox(_ p: SIMD3<Float>, cam: simd_float4x4, label: String = "car") -> (BoxTracker.Box?, BoxTracker.Camera) {
        let rot = simd_float3x3(SIMD3(cam.columns.0.x, cam.columns.0.y, cam.columns.0.z),
                                SIMD3(cam.columns.1.x, cam.columns.1.y, cam.columns.1.z),
                                SIMD3(cam.columns.2.x, cam.columns.2.y, cam.columns.2.z))
        let c = BoxTracker.Camera(fx: 1580, fy: 1580, cx: 960, cy: 720, width: 1920, height: 1440, rotation: rot)
        let o = SIMD3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        func project(_ w: SIMD3<Float>) -> CGPoint? { // world -> portrait normalized (inverse of BoxTracker.direction)
            let v = rot.transpose * (w - o)
            guard v.z < -0.1 else { return nil }
            let xs = c.cx + c.fx * v.x / -v.z, ys = c.cy - c.fy * v.y / -v.z
            return CGPoint(x: CGFloat(1 - ys / c.height), y: CGFloat(xs / c.width))
        }
        var pts: [CGPoint] = []
        for dx: Float in [-0.9, 0.9] { for y: Float in [0, 1.5] { if let q = project(p + SIMD3(dx, y, 0)) { pts.append(q) } } }
        guard pts.count == 4 else { return (nil, c) }
        let xs = pts.map(\.x), ys = pts.map(\.y)
        let r = CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        return (BoxTracker.Box(label: label, rect: r, confidence: 0.9), c)
    }

    func testIoUAndGroups() {
        XCTAssertEqual(BoxTracker.iou(CGRect(x: 0, y: 0, width: 1, height: 1), CGRect(x: 0, y: 0, width: 1, height: 1)), 1)
        XCTAssertEqual(BoxTracker.iou(CGRect(x: 0, y: 0, width: 2, height: 1), CGRect(x: 1, y: 0, width: 2, height: 1)), 1.0 / 3, accuracy: 1e-9)
        XCTAssertEqual(BoxTracker.group("truck"), BoxTracker.group("car"))
        XCTAssertNotEqual(BoxTracker.group("person"), BoxTracker.group("car"))
        XCTAssertTrue(BoxTracker.isClipped(CGRect(x: 0.4, y: 0.995, width: 0.1, height: 0.004))) // bottom
        XCTAssertFalse(BoxTracker.isClipped(CGRect(x: 0.995, y: 0.4, width: 0.004, height: 0.1))) // side: height intact
        XCTAssertEqual(BoxTracker.spokenLabel("truck"), "Car")
    }

    func testHeadOnCarWithHeadYawTriggersEarly() throws {
        // 12 m/s from 50 m straight down the road (-z), standing, head yawing at 0 / 10 deg/s (under the 12 deg/s
        // look-and-hold threshold); YOLO at 5 Hz. The label flips car/truck (same group), and head rotation must not
        // break the track. At 20 deg/s the head is moving: standing, no growth samples, so no closing at all.
        for yawRate: Float in [0, 10, 20] {
            var tracker = BoxTracker()
            var hit: (t: Double, ttc: Double)?
            for i in 0...25 {
                let t = Double(i) * 0.2
                let cam = camera(SIMD3(0, 1.6, 0), yawDeg: -20 + yawRate * Float(t), pitchDeg: 0)
                let (box, c) = carBox(SIMD3(0, 0, -(50 - 12 * Float(t))), cam: cam, label: i % 3 == 1 ? "truck" : "car")
                for tr in tracker.update(box.map { [$0] } ?? [], time: t, camera: c) where tr.group == "vehicle" {
                    XCTAssertEqual(tr.heightM, 1.5) // frozen at the first detection (car), never rescaled by flips
                    if hit == nil, let cl = BoxTracker.closing(tr, egoTowardMps: 0),
                       Float(cl.speed) >= Tuning.vehicleMinClosingSpeedMps, Float(cl.ttc) < Tuning.ttcSeconds {
                        hit = (t, cl.ttc)
                        XCTAssertEqual(cl.speed, 12, accuracy: 2)
                    }
                }
            }
            if yawRate > Float(HeadMotion.stillYawDegPerSec) {
                XCTAssertNil(hit, "yaw \(yawRate) deg/s: head moving while standing must not grow a box")
                continue
            }
            let h = try XCTUnwrap(hit, "yaw \(yawRate) deg/s")
            XCTAssertGreaterThanOrEqual(h.ttc, 2.5, "yaw \(yawRate) deg/s")
            XCTAssertGreaterThanOrEqual(50 - 12 * h.t, 2.5 * 12 * 0.9) // true TTC at trigger >= ~2.3 s
        }
    }

    func testStaticObjectsWhileHeadYawsDoNotClose() {
        // A parked car 10 m ahead while the head turns 20 or 40 deg/s toward the frame edge: angular height
        // is unchanged by rotation, so no closing (pixel height would grow by 1/cos).
        for rate: Float in [20, 40] {
            var tracker = BoxTracker()
            for i in 0...10 {
                let t = Double(i) * 0.2
                let cam = camera(SIMD3(0, 1.6, 0), yawDeg: rate * Float(t), pitchDeg: 0)
                let (box, c) = carBox(SIMD3(0, 0, -10), cam: cam)
                for tr in tracker.update(box.map { [$0] } ?? [], time: t, camera: c) {
                    // Bounding boxes of an off-axis face grow a little (perspective slant): never a trigger.
                    if let cl = BoxTracker.closing(tr, egoTowardMps: 0) {
                        XCTAssertFalse(Float(cl.speed) >= Tuning.vehicleMinClosingSpeedMps && Float(cl.ttc) < Tuning.ttcSeconds,
                                       "rate \(rate): \(cl)")
                    }
                }
            }
        }
        // Walking toward a parked car at 1.4 m/s: the growth is the walker's own.
        var parked = BoxTracker()
        for i in 0...5 {
            let t = Double(i) * 0.2
            let cam = camera(SIMD3(0, 1.6, -1.4 * Float(t)), pitchDeg: 0)
            let (box, c) = carBox(SIMD3(0.5, 0, -12), cam: cam)
            for tr in parked.update(box.map { [$0] } ?? [], time: t, camera: c) {
                let cl = BoxTracker.closing(tr, egoTowardMps: 1.4)
                XCTAssertTrue(cl == nil || cl!.speed < Double(Tuning.vehicleMinClosingSpeedMps))
            }
        }
    }
    func testHoldStillHintOncePerSessionAtCurbWithMovingHead() {
        var h = HoldStillHint()
        func step(_ t: Double, curb: Bool = true, speed: Float = 0, still: Bool = false) -> Bool {
            h.update(now: t, atCurb: curb, walkerSpeed: speed, headStill: still)
        }
        // Head moving while walking, away from a curb, or held still: never.
        for t in stride(from: 0.0, through: 5, by: 0.25) {
            XCTAssertFalse(step(t, speed: 1.2))
            XCTAssertFalse(step(t, curb: false))
        }
        // Standing at the curb: moving 1.5 s, still once (restarts the clock), then moving > 2 s: one notice.
        XCTAssertFalse(step(10)); XCTAssertFalse(step(11.5)); XCTAssertFalse(step(11.75, still: true))
        XCTAssertFalse(step(12)); XCTAssertFalse(step(14))
        XCTAssertTrue(step(14.25))
        // Never again this session, whatever happens.
        for t in stride(from: 15.0, through: 40, by: 0.25) { XCTAssertFalse(step(t)) }
        XCTAssertTrue(h.spoken)
    }
    // MARK: What's ahead (device bug: the answer was followed by the head-height alert it had just described)

    /// Mirrors AlertManager.whatsAhead + perform(.whatsAhead): cut off below priority 1, replace the notice queue,
    /// answer at whatsAheadPriority and mark the named hazard announced. Returns the answer as it plays.
    static func pressWhatsAhead(_ policy: inout AlertPolicy, _ queue: inout NoticeQueue<String>, latest: [HazardKind: Detection],
                                playing: AlertPolicy.Playing?, now: Double) -> AlertPolicy.Playing? {
        let p = playing.flatMap { AlertPolicy.whatsAheadCutsOff($0.priority) ? nil : $0 }
        queue.replaceAll(with: "what's ahead", now: now)
        guard queue.pop(playing: p?.priority, now: now) != nil else { return nil } // waits behind a priority-1 alert
        let d = AlertPolicy.whatsAheadHazard(latest)
        if let d { policy.markAnnounced(d, now: now) }
        return AlertPolicy.Playing(priority: AlertPolicy.whatsAheadPriority(d), hazard: d, endsAt: now + 2.2, startedAt: now)
    }

    func testWhatsAheadSpeaksOnlyTheAnswerNoHeadHeightReplay() throws {
        for ahead: Float in [3, 1.8] { // beyond and within repeatCloseDistance (the "once more when close" rule)
            var policy = AlertPolicy()
            var queue = NoticeQueue<String>()
            let head = Detection(kind: .headHeight, point: SIMD3(0, 1.7, -ahead), ahead: ahead, lateral: 0, pointCount: 80)
            let latest: [HazardKind: Detection] = [.headHeight: head]
            XCTAssertEqual(AlertPolicy.whatsAheadPhrase(latest, atCurb: false), AlertPolicy.phrase(head))
            let answer = try XCTUnwrap(Self.pressWhatsAhead(&policy, &queue, latest: latest, playing: nil, now: 0))
            XCTAssertEqual(answer.priority, 2)
            // No head-height alert, during the answer or after it, for the whole repeat window.
            var t = 0.0
            while t < Tuning.repeatWindow - 0.1 {
                XCTAssertNil(policy.decide(latest, now: t, playing: t < answer.endsAt ? answer : nil), "ahead \(ahead), t \(t)")
                t += 1.0 / 12
            }
            XCTAssertEqual(policy.decide(latest, now: Tuning.repeatWindow + 0.1, playing: nil)?.kind, .headHeight) // normal repeat
            // Another hazard in view does not cut the answer off (it waits, as behind any priority-2 alert).
            let ground = Detection(kind: .ground, point: SIMD3(0.5, 0.3, -2.5), ahead: 2.5, lateral: 0.5, pointCount: 90)
            XCTAssertNil(policy.decide([.headHeight: head, .ground: ground], now: 1, playing: answer))
        }
    }

    func testWhatsAheadClearsQueuedHeadsUpAndStatus() {
        var policy = AlertPolicy()
        var queue = NoticeQueue<String>()
        queue.push("Construction ahead", server: true, now: 0) // a map heads-up
        queue.push(Notices.pathGuardBack, server: false, now: 0) // a status notice
        let ground = Detection(kind: .ground, point: SIMD3(0, 0.3, -3), ahead: 3, lateral: 0, pointCount: 90)
        // Pressed while a priority-3 alert plays: cut off, queue cleared, the answer alone plays.
        let playingGround = AlertPolicy.Playing(priority: 3, hazard: ground, endsAt: 2, startedAt: 0)
        XCTAssertNotNil(Self.pressWhatsAhead(&policy, &queue, latest: [.ground: ground], playing: playingGround, now: 0.5))
        XCTAssertNil(queue.pop(playing: nil, now: 3))
        XCTAssertEqual(queue.count, 0)
        for p in [2, 3, AlertPolicy.onRequestPriority, AlertPolicy.serverPhrasePriority] { XCTAssertTrue(AlertPolicy.whatsAheadCutsOff(p)) }
        XCTAssertFalse(AlertPolicy.whatsAheadCutsOff(1))
        XCTAssertFalse(AlertPolicy.whatsAheadCutsOff(nil))
        XCTAssertEqual(AlertPolicy.whatsAheadPriority(nil), AlertPolicy.onRequestPriority) // "Nothing detected": any hazard cuts it
    }

    func testWhatsAheadNeverDelaysPriorityOne() throws {
        func car(_ id: Int, ttc: Float, range: Float) -> Detection {
            Detection(kind: .closing, point: SIMD3(0, 1, -range), ahead: range, lateral: 0, pointCount: 0,
                      closing: .init(speed: range / ttc, ttc: ttc, label: "Car", trackId: id))
        }
        let head = Detection(kind: .headHeight, point: SIMD3(0, 1.7, -3), ahead: 3, lateral: 0, pointCount: 80)
        // A closing object arriving during the answer plays at once (cuts it off).
        var policy = AlertPolicy()
        var queue = NoticeQueue<String>()
        let answer = try XCTUnwrap(Self.pressWhatsAhead(&policy, &queue, latest: [.headHeight: head], playing: nil, now: 0))
        XCTAssertEqual(policy.decide([.headHeight: head, .closing: car(7, ttc: 2.5, range: 6)], now: 0.3, playing: answer)?.closing?.trackId, 7)
        // Pressed during a priority-1 alert: the answer waits; a pending closing phrase is kept and plays first.
        var p1 = AlertPolicy()
        var q1 = NoticeQueue<String>()
        let a = car(1, ttc: 2.8, range: 7), b = car(2, ttc: 2.9, range: 7.5)
        let playingA = AlertPolicy.Playing(priority: 1, hazard: a, endsAt: 1.7, startedAt: 0, ttcAtStart: 2.8)
        p1.markAnnounced(a, now: 0)
        XCTAssertNil(p1.decide([.closing: b], now: 0.2, playing: playingA)) // B queues (pending)
        XCTAssertNotNil(p1.pending)
        XCTAssertNil(Self.pressWhatsAhead(&p1, &q1, latest: [.closing: b, .headHeight: head], playing: playingA, now: 0.4))
        XCTAssertNotNil(p1.pending) // the press never drops it
        XCTAssertEqual(p1.decide([.headHeight: head], now: 1.8, playing: nil)?.closing?.trackId, 2) // B speaks when A ends
        XCTAssertEqual(q1.count, 1) // the answer is still queued, after B
    }
}
