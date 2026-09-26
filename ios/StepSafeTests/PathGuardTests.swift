import XCTest
import simd

/// Synthetic depth: a head-mounted phone in portrait (sensor long axis vertical), 1.6 m up,
/// pitched 20 degrees down, walking toward world -z. Depth is ray-cast against a tiny scene.
final class PathGuardTests: XCTestCase {
    let width = 256, height = 192
    let intrinsics = simd_float3x3(SIMD3(212, 0, 0), SIMD3(0, 212, 0), SIMD3(128, 96, 1))

    var cameraTransform: simd_float4x4 { camera(pitchDeg: -20) }

    func camera(pitchDeg: Float) -> simd_float4x4 {
        // Portrait: camera x (sensor long axis) = world up, camera y = world left, camera z = backward.
        let base = simd_float3x3(SIMD3(0, 1, 0), SIMD3(-1, 0, 0), SIMD3(0, 0, 1))
        let pitch = simd_float3x3(simd_quatf(angle: pitchDeg * .pi / 180, axis: SIMD3(1, 0, 0)))
        let r = pitch * base
        return simd_float4x4(SIMD4(r.columns.0, 0), SIMD4(r.columns.1, 0), SIMD4(r.columns.2, 0),
                             SIMD4(0, 1.6, 0, 1))
    }

    enum Shape {
        /// Horizontal plane at y, only where `keep(point)` is true.
        case plane(y: Float, keep: (SIMD3<Float>) -> Bool)
        case box(min: SIMD3<Float>, max: SIMD3<Float>)
    }

    /// Returns t along `dir` (so depth, since dir has camera z = -1) of the nearest hit.
    func hit(_ shape: Shape, _ o: SIMD3<Float>, _ dir: SIMD3<Float>) -> Float? {
        switch shape {
        case let .plane(y, keep):
            guard dir.y != 0 else { return nil }
            let t = (y - o.y) / dir.y
            return t > 0 && keep(o + dir * t) ? t : nil
        case let .box(lo, hi):
            var tMin: Float = 0, tMax = Float.greatestFiniteMagnitude
            for a in 0..<3 {
                if dir[a] == 0 { if o[a] < lo[a] || o[a] > hi[a] { return nil }; continue }
                var t0 = (lo[a] - o[a]) / dir[a], t1 = (hi[a] - o[a]) / dir[a]
                if t0 > t1 { swap(&t0, &t1) }
                tMin = max(tMin, t0); tMax = min(tMax, t1)
                if tMin > tMax { return nil }
            }
            return tMin
        }
    }

    func render(_ scene: [Shape], transform: simd_float4x4? = nil,
                confidenceBeyond: ((SIMD3<Float>) -> Bool)? = nil) -> DepthFrame {
        let t = transform ?? cameraTransform
        let o = SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let rot = simd_float3x3(SIMD3(t.columns.0.x, t.columns.0.y, t.columns.0.z),
                                SIMD3(t.columns.1.x, t.columns.1.y, t.columns.1.z),
                                SIMD3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
        var depth = [Float](repeating: 0, count: width * height)
        var conf = [UInt8](repeating: 0, count: width * height)
        for v in 0..<height {
            for u in 0..<width {
                let dir = rot * SIMD3((Float(u) + 0.5 - 128) / 212, -(Float(v) + 0.5 - 96) / 212, -1)
                guard let d = scene.compactMap({ hit($0, o, dir) }).min(), d < 8 else { continue }
                if let lowConf = confidenceBeyond, lowConf(o + dir * d) { continue }
                depth[v * width + u] = d
                conf[v * width + u] = 2
            }
        }
        return DepthFrame(depth: depth, confidence: conf, width: width, height: height,
                          intrinsics: intrinsics, cameraTransform: t, floorY: 0)
    }

    let floor = Shape.plane(y: 0) { _ in true }

    func testFlatFloorNoAlert() {
        let r = PathGuard.analyze(render([floor]))
        XCTAssertTrue(r.detections.isEmpty, "\(r.detections)")
    }

    func testBoxInLaneIsGroundObstacle() throws {
        let box = Shape.box(min: SIMD3(-0.3, 0, -2.3), max: SIMD3(0.3, 0.6, -1.7))
        let r = PathGuard.analyze(render([floor, box]))
        let d = try XCTUnwrap(r.detections[.ground])
        XCTAssertEqual(d.ahead, 1.7, accuracy: 0.1)
        XCTAssertNil(r.detections[.headHeight])
        XCTAssertNil(r.detections[.dropOff])
    }

    func testBoxOutsideLaneIgnored() {
        let box = Shape.box(min: SIMD3(1.0, 0, -2.3), max: SIMD3(1.6, 0.6, -1.7))
        XCTAssertTrue(PathGuard.analyze(render([floor, box])).detections.isEmpty)
    }

    func testBarAtHeadHeight() throws {
        let bar = Shape.box(min: SIMD3(-2, 1.55, -2.05), max: SIMD3(-0.2, 1.65, -1.95))
        let r = PathGuard.analyze(render([floor, bar]))
        let d = try XCTUnwrap(r.detections[.headHeight])
        XCTAssertEqual(d.ahead, 1.95, accuracy: 0.1)
        XCTAssertLessThan(d.lateral, 0, "bar is on the left")
        XCTAssertNil(r.detections[.ground])
        XCTAssertNil(r.detections[.dropOff])
    }

    func testStepDownIsDropOff() throws {
        // Floor ends 1.5 m ahead; the lower level is 1 m down.
        let upper = Shape.plane(y: 0) { $0.z > -1.5 }
        let lower = Shape.plane(y: -1) { $0.z <= -1.5 }
        let r = PathGuard.analyze(render([upper, lower]))
        let d = try XCTUnwrap(r.detections[.dropOff])
        XCTAssertEqual(d.ahead, 1.5, accuracy: 0.1)
        XCTAssertNil(r.detections[.ground])
    }

    func testMissingFloorIsDropOff() throws {
        // No usable depth past 1.5 m (e.g. an edge with nothing in LiDAR range).
        let r = PathGuard.analyze(render([floor], confidenceBeyond: { $0.z < -1.5 }))
        let d = try XCTUnwrap(r.detections[.dropOff])
        XCTAssertEqual(d.ahead, 1.5, accuracy: 0.1)
    }

    func testCurb15cmAt2_6mIsDropOff() throws {
        // Standard 15 cm curb down, 2.6 m ahead (dropoffDepthM 0.12 leaves margin).
        let upper = Shape.plane(y: 0) { $0.z > -2.6 }
        let lower = Shape.plane(y: -0.15) { $0.z <= -2.6 }
        let r = PathGuard.analyze(render([upper, lower]))
        let d = try XCTUnwrap(r.detections[.dropOff])
        XCTAssertEqual(d.ahead, 2.6, accuracy: 0.1)
        XCTAssertNil(r.detections[.ground])
    }

    func testFloorOutOfViewIsNotDropOff() {
        // Looking 10 degrees up: the floor 1-3 m ahead is out of view, so few expected pixels.
        XCTAssertTrue(PathGuard.analyze(render([floor], transform: camera(pitchDeg: 10))).detections.isEmpty)
    }

    // Sidewalk behind the walker (z > 1), street under and ahead; the walker is at x,z = 0.
    let sidewalk = FloorPlane(y: 0.15, isFloor: true, centerX: 0, centerZ: 3, width: 4, depth: 4)
    let street = FloorPlane(y: 0, isFloor: true, centerX: 0, centerZ: -3, width: 6, depth: 6)
    let walker = SIMD3<Float>(0, 1.6, 0)

    func testSteppedDownCurbStreetIsNotDropOff() {
        let f = PathGuard.floor(planes: [sidewalk, street], camera: walker)
        XCTAssertEqual(f.y, 0)
        XCTAssertEqual(f.source, .planeUnder)
        var frame = render([floor])
        frame.floorY = f.y
        XCTAssertTrue(PathGuard.analyze(frame).detections.isEmpty)
    }

    func testFloorPlaneRules() {
        let table = FloorPlane(y: 0.9, isFloor: false, centerX: 0, centerZ: 0, width: 2, depth: 2)
        let upper = FloorPlane(y: 1.3, isFloor: true, centerX: 0, centerZ: 0, width: 9, depth: 9) // < 0.5 m below
        XCTAssertEqual(PathGuard.floor(planes: [table, upper, sidewalk, street], camera: walker).y, 0)
        // Standing on the sidewalk: its plane is under the walker and highest.
        let onSidewalk = SIMD3<Float>(0, 1.75, 3)
        XCTAssertEqual(PathGuard.floor(planes: [sidewalk, street], camera: onSidewalk).y, 0.15)
        // No plane under the walker: the one nearest camera y - cameraHeightM.
        let away = SIMD3<Float>(20, 1.6, 20)
        let n = PathGuard.floor(planes: [sidewalk, street], camera: away)
        XCTAssertEqual(n.source, .planeNearest)
        XCTAssertEqual(n.y, 0)
        let e = PathGuard.floor(planes: [table], camera: walker)
        XCTAssertEqual(e.source, .estimate)
        XCTAssertEqual(e.y, 1.6 - Tuning.cameraHeightM, accuracy: 1e-6)
        // Yaw: a plane long along world z (width along local x, turned 90 degrees).
        let turned = FloorPlane(y: 0, isFloor: true, centerX: 0, centerZ: 0, yaw: .pi / 2, width: 6, depth: 0.4)
        XCTAssertTrue(turned.contains(x: 0, z: 2.5))
        XCTAssertFalse(turned.contains(x: 2.5, z: 0))
    }

    func testEstimatedFloorShortWearerFlatFloorIsClear() {
        // Camera really 1.45 m up, cameraHeightM 1.6: the estimated floor is 15 cm too low.
        var t = cameraTransform
        t.columns.3.y = 1.45
        var frame = render([floor], transform: t)
        let f = PathGuard.floor(planes: [], camera: SIMD3(0, 1.45, 0))
        XCTAssertEqual(f.source, .estimate)
        frame.floorY = f.y
        frame.floorIsEstimate = true
        XCTAssertTrue(PathGuard.analyze(frame).detections.isEmpty, "\(PathGuard.analyze(frame).detections)")
    }

    func testEstimatedFloorSkipsDropPixelRule() {
        // Wearer height set too high: the estimated floor sits 25 cm above the real one.
        var frame = render([floor])
        frame.floorY = 0.25
        frame.floorIsEstimate = true
        XCTAssertNil(PathGuard.analyze(frame).detections[.dropOff])
        // The missing-floor rule still fires on an estimate.
        var edge = render([floor], confidenceBeyond: { $0.z < -1.5 })
        edge.floorIsEstimate = true
        XCTAssertNotNil(PathGuard.analyze(edge).detections[.dropOff])
    }

    func testTrackerConfirmsAfterConfirmSecondsAndClearsAfterClearSeconds() {
        let det = Detection(kind: .ground, point: .zero, ahead: 2, lateral: 0, pointCount: 100)
        var tracker = HazardTracker()
        // Frames every 70 ms, so no timestamp lands exactly on a threshold (0.4 s confirm, 1.0 s clear).
        func t(_ i: Int) -> Double { Double(i) * 0.07 }
        for i in 0...5 { XCTAssertNil(tracker.update([.ground: det], time: t(i))[.ground], "frame \(i)") }
        XCTAssertNotNil(tracker.update([.ground: det], time: t(6))[.ground], "0.42 s of hits")
        for i in 7...20 { XCTAssertNotNil(tracker.update([:], time: t(i))[.ground], "frame \(i)") }
        XCTAssertNil(tracker.update([:], time: t(21))[.ground], "1.05 s since the last hit")
    }

    func testTrackerMissResetsConfirmStreak() {
        let det = Detection(kind: .ground, point: .zero, ahead: 2, lateral: 0, pointCount: 100)
        var tracker = HazardTracker()
        _ = tracker.update([.ground: det], time: 0)
        _ = tracker.update([:], time: 0.2)
        XCTAssertNil(tracker.update([.ground: det], time: 0.45)[.ground])
    }
}
