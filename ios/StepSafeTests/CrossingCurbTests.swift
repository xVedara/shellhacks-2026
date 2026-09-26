import CoreGraphics
import XCTest
import simd

/// Standing at a curb among parked cars, and two-car re-match traps (ported from audit-r6 mc and two).
/// Seeded, deterministic.
final class CrossingCurbTests: XCTestCase {
    typealias B = CrossingScenarioBoxPolicyTests
    typealias S = CrossingScenarioTests

    /// YOLO-like box of a car; `silhouette` = body (lower 55%) plus a shorter, narrower cabin, like a real car.
    static func box(_ car: B.Car, cam: simd_float4x4, jitterPx: Double, silhouette: Bool, rng: inout S.SplitMix) -> BoxTracker.Box? {
        let r = B.rot(cam), c = B.info(cam)
        let o = SIMD3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        let fwd = SIMD3<Float>(cos(car.heading), 0, sin(car.heading)), side = SIMD3<Float>(-fwd.z, 0, fwd.x)
        let parts: [(Float, Float, Float, Float, Float)] = silhouette ? [(1, 1, 0, 0.55, 0), (0.55, 0.85, 0.55, 1, -0.05)] : [(1, 1, 0, 1, 0)]
        var pts: [CGPoint] = []
        for (lf, wf, y0, y1, off) in parts {
            for a: Float in [-0.5, 0.5] { for b: Float in [-0.5, 0.5] { for y in [y0, y1] {
                let w = car.center + fwd * ((a * lf + off) * car.len) + side * (b * wf * car.wid) + SIMD3(0, y * car.h, 0)
                let v = r.transpose * (w - o)
                guard v.z < -0.3 else { return nil }
                pts.append(CGPoint(x: CGFloat(1 - (c.cy - c.fy * v.y / -v.z) / c.height), y: CGFloat((c.cx + c.fx * v.x / -v.z) / c.width)))
            } } }
        }
        func j() -> CGFloat { jitterPx > 0 ? CGFloat(Double.random(in: -jitterPx...jitterPx, using: &rng) / 640) : 0 }
        var x0 = pts.map(\.x).min()! + j(), x1 = pts.map(\.x).max()! + j(), y0 = pts.map(\.y).min()! + j(), y1 = pts.map(\.y).max()! + j()
        if x1 < 0 || x0 > 1 || y1 < 0 || y0 > 1 { return nil }
        x0 = max(0, x0); y0 = max(0, y0); x1 = min(1, x1); y1 = min(1, y1)
        guard (x1 - x0) * 640 > 12, (y1 - y0) * 640 > 12 else { return nil }
        return BoxTracker.Box(label: car.label, rect: CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0), confidence: 0.8)
    }

    /// Any non-passing alert in the run (`anyOutput`: passing ones count too).
    static func alerts(secs: Double, drop: Double, jitterPx: Double, silhouette: Bool, rng: inout S.SplitMix,
                       cars: (Double) -> [(B.Car, Bool)], cam: (Double) -> simd_float4x4, anyOutput: Bool = false) -> Int {
        var tracker = BoxTracker()
        var lastCam: (t: Double, p: SIMD3<Float>)?
        var vel = SIMD2<Float>.zero
        var n = 0
        var t = 0.0
        while t <= secs + 1e-9 {
            let cm = cam(t)
            var boxes: [BoxTracker.Box] = []
            for (car, visible) in cars(t) where visible {
                if let b = box(car, cam: cm, jitterPx: jitterPx, silhouette: silhouette, rng: &rng),
                   Double.random(in: 0..<1, using: &rng) >= drop { boxes.append(b) }
            }
            let p = SIMD3(cm.columns.3.x, cm.columns.3.y, cm.columns.3.z)
            if let l = lastCam, t > l.t { vel = vel * 0.5 + 0.5 * SIMD2(p.x - l.p.x, p.z - l.p.z) / Float(t - l.t) }
            lastCam = (t, p)
            _ = tracker.update(boxes, time: t, camera: B.info(cm))
            let look = -B.rot(cm).columns.2
            n += tracker.assess(time: t, walker: SIMD2(p.x, p.z), walkerVelocity: vel, forward: simd_normalize(SIMD2(look.x, look.z)))
                .filter { anyOutput || !$0.passing }.count
            t += 0.2
        }
        return n
    }

    /// Random parked layout: 3-8 cars, 4-25 m, bearing +-100 deg, random heading.
    static func randomLayout(_ g: inout S.SplitMix) -> [B.Car] {
        (0..<Int.random(in: 3...8, using: &g)).map { _ in
            let b = Double.random(in: -100...100, using: &g) * .pi / 180, d = Double.random(in: 4...25, using: &g)
            return B.Car(center: SIMD3(Float(sin(b) * d), 0, Float(-cos(b) * d)), heading: Float.random(in: 0..<(.pi), using: &g),
                         label: Double.random(in: 0..<1, using: &g) < 0.15 ? "truck" : "car")
        }
    }

    /// Curb layout: standing at the curb facing the street; near-side cars parallel parked at z -2.2 (random gaps),
    /// far-side cars at z -13.
    static func curbLayout(_ g: inout S.SplitMix) -> [B.Car] {
        var cs: [B.Car] = []
        var x = Double.random(in: -30 ... -24, using: &g)
        while x < 30 {
            if abs(x) > 3.5 || Double.random(in: 0..<1, using: &g) < 0.3 { cs.append(B.Car(center: SIMD3(Float(x), 0, -2.2), heading: 0)) }
            x += Double.random(in: 5.2...8, using: &g)
        }
        x = Double.random(in: -30 ... -24, using: &g)
        while x < 30 {
            if Double.random(in: 0..<1, using: &g) < 0.7 {
                cs.append(B.Car(center: SIMD3(Float(x), 0, -13), heading: 0, label: Double.random(in: 0..<1, using: &g) < 0.2 ? "truck" : "car"))
            }
            x += Double.random(in: 5.2...8, using: &g)
        }
        return cs
    }

    /// Standing, scanning the street +-60 deg at 0.33 Hz with head roll +-4 deg at 1 Hz (25 deg/s peak): 200 runs.
    func testStandingScanAmongParkedCars() {
        for (name, layout, limit) in [("curb layout", Self.curbLayout as (inout S.SplitMix) -> [B.Car], 2),
                                      ("random layouts", Self.randomLayout, 5)] {
            for (drop, jit) in [(0.0, 1.0), (0.2, 2.0)] {
                var runsWithAlert = 0
                for s in 0..<200 {
                    var g = S.SplitMix(state: UInt64(s) &* 31 &+ 5)
                    let cars = layout(&g)
                    let ph = Double.random(in: 0..<(2 * .pi), using: &g)
                    var rng = S.SplitMix(state: UInt64(s) &* 7919 &+ 17)
                    if Self.alerts(secs: 8, drop: drop, jitterPx: jit, silhouette: true, rng: &rng, cars: { _ in cars.map { ($0, true) } },
                                   cam: { t in B.head(SIMD3(0, 1.6, 0), yaw: Float(60 * sin(2 * .pi * 0.33 * t + ph)), pitch: -5,
                                                      roll: Float(4 * sin(2 * .pi * 1.0 * t))) }) > 0 { runsWithAlert += 1 }
                }
                print(String(format: "MONTECARLO standing scan +-60@0.33, roll +-4@1 Hz, %@, drop %.0f%%, %.0f px: %d/200 runs false-alert",
                             name, drop * 100, jit, runsWithAlert))
                XCTAssertLessThanOrEqual(runsWithAlert, limit, "\(name), drop \(drop)")
            }
        }
    }

    /// Two-car traps (audit-r6 two): car A seen for 1 s then gone, car B at a nearby bearing appears later; and a
    /// parked A plus a car driving along the road near A's bearing. Standing, head fixed: nothing may be reported
    /// (not even as passing) - a re-match onto another car must not read as growth.
    func testTwoCarRematchReportsNothing() {
        func polar(_ bDeg: Float, _ d: Float, heading: Float = .pi / 2) -> B.Car {
            B.Car(center: SIMD3(sin(bDeg * .pi / 180) * d, 0, -cos(bDeg * .pi / 180) * d), heading: heading)
        }
        let cam: (Double) -> simd_float4x4 = { _ in B.head(SIMD3(0, 1.6, 0), yaw: 10, pitch: -5) }
        var failures: [String] = [], cases = 0
        for heading: Float in [.pi / 2, 0] {
            for (bA, dA, bB, dB) in [(Float(0), Float(20), Float(15), Float(12)), (0, 20, 20, 12), (0, 15, 12, 10), (5, 25, 20, 14), (0, 12, 15, 8)] {
                for tB in [2.0, 2.4, 2.8] {
                    var rng = S.SplitMix(state: 99)
                    let a = polar(bA, dA, heading: heading), b = polar(bB, dB, heading: heading)
                    let n = Self.alerts(secs: 6, drop: 0, jitterPx: 1, silhouette: false, rng: &rng,
                                        cars: { t in [(a, t <= 1.0), (b, t >= tB)] }, cam: cam, anyOutput: true)
                    cases += 1
                    if n > 0 { failures.append(String(format: "A %.0f/%.0f B %.0f/%.0f from %.1f heading %.1f: %d", bA, dA, bB, dB, tB, heading, n)) }
                }
            }
        }
        for (dA, lane) in [(Float(15), Float(-12)), (12, -10), (20, -12)] {
            for tB in [2.0, 2.4] {
                var rng = S.SplitMix(state: 99)
                let a = polar(0, dA, heading: 0)
                let n = Self.alerts(secs: 5, drop: 0, jitterPx: 1, silhouette: false, rng: &rng, cars: { t in
                    [(a, t <= 1.0), (B.Car(center: SIMD3(-8 + 8 * Float(t - tB), 0, lane), heading: 0), t >= tB)]
                }, cam: cam, anyOutput: true)
                cases += 1
                if n > 0 { failures.append(String(format: "parked A %.0f m + mover lane %.0f from %.1f: %d", dA, lane, tB, n)) }
            }
        }
        print("SCENARIOS two-car re-match: \(cases - failures.count)/\(cases) report nothing" + (failures.isEmpty ? "" : " :: " + failures.joined(separator: " | ")))
        XCTAssertTrue(failures.isEmpty)
    }
}
