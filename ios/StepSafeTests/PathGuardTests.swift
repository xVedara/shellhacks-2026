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
        /// Walkway falling at `grade` (rise / run) from `start` m ahead (world -z); flat before it.
        case ramp(start: Float, grade: Float)
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
        case let .ramp(start, grade):
            // y = -grade * (ahead - start) with ahead = -z
            let den = dir.y - grade * dir.z
            guard den != 0 else { return nil }
            let t = (-grade * (-o.z - start) - o.y) / den
            return t > 0 && -(o.z + dir.z * t) > start ? t : nil
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

    func testSharedRaysMatchDirectAnalysis() {
        let box = Shape.box(min: SIMD3(-0.3, 0, -2.3), max: SIMD3(0.3, 0.6, -1.7))
        let frame = render([floor, box])
        var rays: [SIMD3<Float>] = []
        DepthRays.fill(frame, into: &rays)
        XCTAssertEqual(rays.count, width * height)
        let direct = PathGuard.analyze(frame, wantLabels: true)
        let shared = PathGuard.analyze(frame, wantLabels: true, rays: rays)
        XCTAssertEqual(shared.detections[.ground]?.point, direct.detections[.ground]?.point)
        XCTAssertEqual(shared.detections[.ground]?.pointCount, direct.detections[.ground]?.pointCount)
        XCTAssertEqual(shared.labels, direct.labels)
        DepthRays.fill(frame, into: &rays) // same buffer, same size
        XCTAssertEqual(PathGuard.analyze(frame, rays: rays).detections[.ground]?.pointCount,
                       direct.detections[.ground]?.pointCount)
        // A short buffer is not this frame: analysis computes its own rays.
        XCTAssertEqual(PathGuard.analyze(frame, rays: []).detections[.ground]?.pointCount,
                       direct.detections[.ground]?.pointCount)

        let edge = render([floor], confidenceBeyond: { $0.z < -1.5 })
        var edgeRays: [SIMD3<Float>] = []
        DepthRays.fill(edge, into: &edgeRays)
        let drop = PathGuard.analyze(edge)
        let dropShared = PathGuard.analyze(edge, rays: edgeRays)
        XCTAssertEqual(dropShared.detections[.dropOff]?.point, drop.detections[.dropOff]?.point)
        XCTAssertEqual(dropShared.detections[.dropOff]?.pointCount, drop.detections[.dropOff]?.pointCount)

        // Blank frame: shared rays and the direct path both report nothing, and a short buffer is ignored.
        let blank = DepthFrame(depth: [Float](repeating: 0, count: 4), confidence: [UInt8](repeating: 0, count: 4),
                               width: 2, height: 2, intrinsics: matrix_identity_float3x3,
                               cameraTransform: matrix_identity_float4x4, floorY: 0)
        var blankRays: [SIMD3<Float>] = []
        DepthRays.fill(blank, into: &blankRays)
        var det = ClosingDetector()
        XCTAssertEqual(det.update(blank, time: 0, rays: blankRays), [])
        XCTAssertEqual(det.update(blank, time: 1.0 / 12, rays: []), [])
    }

    /// ClosingDetector's direct unproject is `rot * (dirCam * d)`; the shared ray is `(rot * dirCam) * d`.
    func testSharedRayAgreesWithDirectUnprojectWithinAMillimetre() {
        let t = cameraTransform
        let rot = t.rotation3
        let cam = t.translation
        let k = intrinsics
        let fx = k.columns.0.x, fy = k.columns.1.y, cx = k.columns.2.x, cy = k.columns.2.y
        for v in stride(from: 0, to: height, by: 17) {
            for u in stride(from: 0, to: width, by: 19) {
                let d: Float = 4
                let ray = DepthRays.direction(u: u, v: v, intrinsics: k, rotation: rot)
                let shared = cam + ray * d
                let direct = cam + rot * SIMD3((Float(u) + 0.5 - cx) / fx * d, -(Float(v) + 0.5 - cy) / fy * d, -d)
                XCTAssertEqual(shared.x, direct.x, accuracy: 1e-3)
                XCTAssertEqual(shared.y, direct.y, accuracy: 1e-3)
                XCTAssertEqual(shared.z, direct.z, accuracy: 1e-3)
            }
        }
    }

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

    func testSteppedDownJustPastCurbEdgePicksStreet() {
        // Street runs up to the curb at z = 1; the walker stands on it 0.29 m past the sidewalk's edge.
        // With the margin the sidewalk (higher) would also contain the walker; the exact pass must win.
        let street = FloorPlane(y: 0, isFloor: true, centerX: 0, centerZ: -2.5, width: 6, depth: 7)
        let justPast = SIMD3<Float>(0, 1.6, 1 - 0.29)
        let f = PathGuard.floor(planes: [sidewalk, street], camera: justPast)
        XCTAssertEqual(f.y, 0)
        XCTAssertEqual(f.source, .planeUnder)
        // No plane contains the walker exactly: the margin still counts (sidewalk just ahead of its edge).
        XCTAssertEqual(PathGuard.floor(planes: [sidewalk], camera: justPast).y, 0.15)
        XCTAssertEqual(PathGuard.floor(planes: [sidewalk], camera: justPast).source, .planeUnder)
    }

    func testOnlyPlaneUnderUsesTrustedFloorRules() {
        XCTAssertFalse(FloorSource.planeUnder.usesEstimateRules)
        XCTAssertTrue(FloorSource.planeNearest.usesEstimateRules)
        XCTAssertTrue(FloorSource.estimate.usesEstimateRules)
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

    // MARK: Slope label (analysis/pathguard_slope.py; b6 review cases)

    func step(_ edge: Float, _ depth: Float) -> [Shape] {
        [Shape.plane(y: 0) { $0.z > -edge }, Shape.plane(y: -depth) { $0.z <= -edge }]
    }

    /// Depth map blurred by a normalized box filter (radius px) over valid pixels: LiDAR smearing a curb edge.
    /// ARKit marks depth discontinuities low-confidence (dropped at minConfidence 1): blank `k` columns either side
    /// of every depth jump (> 4 % between neighbouring columns), as b6's edgeconf_probe.py.
    func edgeDropout(_ f: DepthFrame, k: Int) -> DepthFrame {
        var out = f
        for v in 0..<f.height {
            for u in 0..<(f.width - 1) {
                let a = f.depth[v * f.width + u], b = f.depth[v * f.width + u + 1]
                guard abs(b - a) > 0.04 * max(a, 1e-3) else { continue }
                for x in max(0, u - k)...min(f.width - 1, u + 1 + k) {
                    out.depth[v * f.width + x] = 0; out.confidence[v * f.width + x] = 0
                }
            }
        }
        return out
    }

    func blurred(_ f: DepthFrame, radius r: Int) -> DepthFrame {
        var out = f
        for v in 0..<f.height {
            for u in 0..<f.width where f.depth[v * f.width + u] > 0 {
                var sum: Float = 0, n = 0
                for dv in -r...r { for du in -r...r {
                    let vv = v + dv, uu = u + du
                    guard vv >= 0, vv < f.height, uu >= 0, uu < f.width else { continue }
                    let d = f.depth[vv * f.width + uu]
                    if d > 0 { sum += d; n += 1 }
                } }
                out.depth[v * f.width + u] = sum / Float(n)
            }
        }
        return out
    }

    /// name -> frame. Ramps first, then real drops (steps, ledges, blurred curbs, holes, side drops, missing floor).
    func labelScenes() -> [(String, DepthFrame)] {
        var out: [(String, DepthFrame)] = []
        for g: Float in [0.083, 0.12, 0.25] {
            out.append(("ramp \(g)", render([Shape.plane(y: 0) { $0.z > -1.2 }, Shape.ramp(start: 1.2, grade: g)])))
        }
        for (e, d): (Float, Float) in [(1.8, 0.15), (2.5, 0.15), (2.0, 0.13), (1.5, 1.0), (1.5, 2.0), (2.5, 2.0)] {
            out.append(("step \(d) at \(e)", render(step(e, d))))
        }
        for e: Float in [1.9, 2.2, 2.4] {
            out.append(("blurred 0.13 at \(e)", blurred(render(step(e, 0.13)), radius: 3)))
        }
        // b6: 0.15 m wide, 0.3 m deep holes straddling the middle / right strip boundary (lateral 0.04-0.19; the
        // camera looks along -z, so lateral = world x here), 0.6 m and 1 m long.
        for (a0, a1): (Float, Float) in [(1.8, 2.4), (1.6, 2.6)] {
            let hole = { (p: SIMD3<Float>) in p.x > 0.04 && p.x < 0.19 && p.z < -a0 && p.z > -a1 }
            out.append(("straddling hole \(a0)-\(a1)",
                        render([Shape.plane(y: 0) { !hole($0) }, Shape.plane(y: -0.3) { hole($0) }])))
        }
        let side = { (p: SIMD3<Float>) in p.x < -0.25 && p.z < -2.4 }
        out.append(("drop beside the lane", render([Shape.plane(y: 0) { !side($0) }, Shape.plane(y: -0.3) { side($0) }])))
        let third = { (p: SIMD3<Float>) in p.x < -0.12 && p.z < -1.8 }
        out.append(("drop over the left third", render([Shape.plane(y: 0) { !third($0) }, Shape.plane(y: -0.3) { third($0) }])))
        for (e, d, k): (Float, Float, Int) in [(2.2, 0.13, 3), (2.5, 0.15, 3), (2.8, 0.2, 3), (1.8, 0.13, 6), (2.4, 0.3, 8)] {
            out.append(("edge dropout \(k) px: \(d) at \(e)", edgeDropout(render(step(e, d)), k: k)))
        }
        // b6: a no-depth patch (puddle, dark mat) 1.2-1.5 m ahead, nearer than a 12 % ramp starting at 1.8 m.
        out.append(("no-depth patch before a 0.12 ramp",
                    render([Shape.plane(y: 0) { $0.z > -1.8 }, Shape.ramp(start: 1.8, grade: 0.12)],
                           confidenceBeyond: { $0.z < -1.2 && $0.z > -1.5 && abs($0.x) < 0.1 })))
        out.append(("missing floor", render([floor], confidenceBeyond: { $0.z < -1.5 })))
        out.append(("flat", render([floor])))
        return out
    }

    /// Today's drop-off detection on every scene (pointCount, ahead, lateral), captured from origin/work e3c7905
    /// before the slope label existed: the label must not change detection.
    static let todayDropOff: [String: (Int, Float, Float)?] = [
            "ramp 0.083": (912, 2.474548, -0.3455186),
            "ramp 0.12": (2032, 2.054822, -0.3448346),
            "ramp 0.25": (4238, 1.5677185, -0.34785286),
            "step 0.15 at 1.8": (2980, 1.8086053, -0.34443334),
            "step 0.15 at 2.5": (808, 2.5239875, -0.33733782),
            "step 0.13 at 2.0": (2214, 2.0016036, -0.34932923),
            "step 1.0 at 1.5": (4612, 1.509185, -0.3476537),
            "step 2.0 at 1.5": (4612, 1.509185, -0.3476537),
            "step 2.0 at 2.5": (808, 2.5239875, -0.33733782),
            "blurred 0.13 at 1.9": (2400, 1.9504907, -0.34241915),
            "blurred 0.13 at 2.2": (1394, 2.270243, -0.34771448),
            "blurred 0.13 at 2.4": (912, 2.474548, -0.3455186),
            "straddling hole 1.8-2.4": (410, 1.8086053, 0.04769077),
            "straddling hole 1.6-2.6": (719, 1.6044381, 0.04361839),
            "drop beside the lane": (152, 2.4032702, -0.33746216),
            "drop over the left third": (979, 1.8086053, -0.34443334),
            "edge dropout 3 px: 0.13 at 2.2": (1794, 2.1292858, -0.34255204),
            "edge dropout 3 px: 0.15 at 2.5": (1016, 2.4266577, -0.3401056),
            "edge dropout 3 px: 0.2 at 2.8": (462, 2.7103763, -0.34298393),
            "edge dropout 6 px: 0.13 at 1.8": (3452, 1.7087809, -0.34020844),
            "edge dropout 8 px: 0.3 at 2.4": (1562, 2.2080774, -0.3401369),
            "no-depth patch before a 0.12 ramp": (1088, 1.2945757, -0.09567432),
            "missing floor": (4612, 1.509185, -0.3476537),
            "flat": nil,
        ]

    func testSlopeLabelLeavesDetectionAsToday() throws {
        let scenes = labelScenes()
        XCTAssertEqual(scenes.count, Self.todayDropOff.count)
        for (name, f) in scenes {
            let d = PathGuard.analyze(f).detections[.dropOff]
            guard let today = try XCTUnwrap(Self.todayDropOff[name], name) else { XCTAssertNil(d, name); continue }
            let now = try XCTUnwrap(d, name)
            XCTAssertEqual(now.pointCount, today.0, name)
            XCTAssertEqual(now.ahead, today.1, accuracy: 1e-5, name)
            XCTAssertEqual(now.lateral, today.2, accuracy: 1e-5, name)
        }
    }

    func testRampsAreLabelledSlope() throws {
        for (name, f) in labelScenes() where name == "ramp 0.083" || name == "ramp 0.12" {
            XCTAssertTrue(try XCTUnwrap(PathGuard.analyze(f).detections[.dropOff], name).slope, name)
        }
    }

    func testRealDropsAndAmbiguousAreLabelledDropOff() throws {
        // Steps (13-15 cm, 1-2 m ledges), blurred 13 cm curbs, holes straddling a strip boundary, drops beside the
        // lane, steps whose depth edge ARKit dropped as low-confidence (3-8 px), a ramp behind a nearer no-depth patch,
        // the missing-floor rule, and a 25 % apron (7.5 cm per 0.3 m: the scarier label). Every one is detected.
        var n = 0
        for (name, f) in labelScenes() where !name.hasPrefix("ramp 0.0") && !name.hasPrefix("ramp 0.1") && name != "flat" {
            XCTAssertFalse(try XCTUnwrap(PathGuard.analyze(f).detections[.dropOff], name).slope, name)
            n += 1
        }
        XCTAssertEqual(n, 21)
    }

    func testSlopeLabelKeepsConfirmTimingAndEpisodeLabel() {
        let ramp = PathGuard.analyze(labelScenes()[0].1).detections[.dropOff]!
        var steep = ramp; steep.slope = false
        // Same confirm/clear times whatever the label (the tracker only reads presence).
        // 12 Hz: confirmed on the 6th hit (0.42 s >= confirmSeconds 0.4), cleared 1 s after the last hit.
        let script: [Detection?] = Array(repeating: ramp, count: 6) + [steep, ramp, nil, ramp]
            + Array(repeating: nil, count: 14) + Array(repeating: ramp, count: 7)
        var a = HazardTracker(), b = HazardTracker()
        var labels: [Bool?] = []
        for (k, d) in script.enumerated() {
            let t = Double(k) / Tuning.analysisHz
            let ca = a.update(d.map { [.dropOff: $0] } ?? [:], time: t)[.dropOff]
            var plain = d; plain?.slope = false
            let cb = b.update(plain.map { [.dropOff: $0] } ?? [:], time: t)[.dropOff]
            XCTAssertEqual(ca != nil, cb != nil, "frame \(k)")
            XCTAssertEqual(ca?.ahead, cb?.ahead)
            labels.append(ca?.slope)
        }
        // Slope while every frame of the run was a slope; one steep frame makes the rest of that episode "Drop-off";
        // the next episode (after clearing) starts over.
        XCTAssertNil(labels[4], "not confirmed yet")
        XCTAssertEqual(labels[5], true)
        XCTAssertEqual(labels[6], false)
        XCTAssertEqual(labels[9], false, "still the same episode")
        XCTAssertNil(labels[23], "cleared")
        XCTAssertEqual(labels.last!, true, "a new episode starts over")
    }

    func testCurbContextUnchangedForRamps() {
        // SensorSession's curb context reads confirmed[.dropOff] and its ahead: a ramp still confirms as a drop-off.
        var tracker = HazardTracker()
        var confirmed: Detection?
        for k in 0..<10 {
            confirmed = tracker.update(PathGuard.analyze(labelScenes()[0].1).detections, time: Double(k) / Tuning.analysisHz)[.dropOff]
        }
        let d = try? XCTUnwrap(confirmed)
        XCTAssertEqual(d?.slope, true)
        XCTAssertLessThanOrEqual(d?.ahead ?? .infinity, Tuning.curbContextM)
    }

    func testSlopePhrase() {
        var d = Detection(kind: .dropOff, point: .zero, ahead: 2, lateral: 0, pointCount: 300)
        XCTAssertEqual(AlertPolicy.phrase(d), "Drop-off, 6 feet, ahead")
        d.slope = true
        XCTAssertEqual(AlertPolicy.phrase(d), "Slope down, 6 feet, ahead")
        d.followOn = true
        XCTAssertEqual(AlertPolicy.phrase(d), AlertPolicy.dropOffAhead, "a follow-on keeps the scarier words")
    }
}
