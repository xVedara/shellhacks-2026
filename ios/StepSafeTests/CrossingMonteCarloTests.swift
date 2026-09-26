import XCTest
import simd

/// Random-phase Monte Carlo for the YOLO vehicle path (ported from audit-s3e mc/mc3/wp): gait roll, yaw sway and
/// box jitter start at random phases every run, drawn from fixed seeds, so the rates are reproducible.
final class CrossingMonteCarloTests: XCTestCase {
    typealias B = CrossingScenarioBoxPolicyTests
    typealias S = CrossingScenarioTests

    /// First non-passing alert in a run: the TRUE time to contact then, or nil.
    /// `atCurb`: passing alerts count too (SensorSession reports every closing object at a curb).
    static func firstAlertTTC(secs: Double, jitterPx: Double, rng: inout S.SplitMix, cars: (Double) -> [B.Car],
                              cam: (Double) -> simd_float4x4, truth: (Double) -> Double, atCurb: Bool = false) -> Double? {
        var tracker = BoxTracker()
        var lastCam: (t: Double, p: SIMD3<Float>)?
        var t = 0.0
        while t <= secs + 1e-9 {
            let cm = cam(t)
            let boxes = cars(t).compactMap { B.yoloBox($0, cam: cm, jitterPx: jitterPx, rng: &rng) }
            let p = SIMD3(cm.columns.3.x, cm.columns.3.y, cm.columns.3.z)
            var vel = SIMD2<Float>.zero
            if let l = lastCam, t > l.t { vel = SIMD2(p.x - l.p.x, p.z - l.p.z) / Float(t - l.t) }
            lastCam = (t, p)
            _ = tracker.update(boxes, time: t, camera: B.info(cm))
            let look = -B.rot(cm).columns.2
            if tracker.assess(time: t, walker: SIMD2(p.x, p.z), walkerVelocity: vel, forward: simd_normalize(SIMD2(look.x, look.z)))
                .contains(where: { !$0.passing || atCurb }) { return truth(t) }
            t += 0.2
        }
        return nil
    }

    struct Row { var ttcs: [Double]; var n: Int { ttcs.count }
        func pct(_ f: (Double) -> Bool) -> Double { 100 * Double(ttcs.filter(f).count) / Double(n) }
        var median: Double { ttcs.sorted()[n / 2] } // -1 = never alerted
    }

    /// Head-on car (lateral 0.5 m), true TTC 4.5 s at t = 0; walker walking or standing; random phases.
    static func headOnRow(speed: Float, walk: Float, roll: Float, yaw: Float, sway: Float, jitter: Double, runs: Int, seed: UInt64) -> Row {
        var rng = S.SplitMix(state: seed)
        var out: [Double] = []
        for _ in 0..<runs {
            let ph = Double.random(in: 0..<(2 * .pi), using: &rng)
            let closing = speed + walk, d0 = closing * 4.5
            out.append(firstAlertTTC(secs: 4.2, jitterPx: jitter, rng: &rng,
                cars: { t in [B.Car(center: SIMD3(0.5, 0, -(d0 - speed * Float(t)) - 2.25), heading: .pi / 2)] },
                cam: { t in
                    let bob = walk > 0 ? 0.03 * Float(sin(2 * .pi * 1.8 * t + ph)) : 0
                    return B.head(SIMD3(sway * Float(sin(2 * .pi * 0.9 * t + ph)), 1.6 + bob, -walk * Float(t)),
                                  yaw: yaw * Float(sin(2 * .pi * 0.4 * t + ph)), pitch: -10,
                                  roll: roll * Float(sin(2 * .pi * 0.9 * t + ph + 0.7)))
                },
                truth: { t in (Double(d0) - Double(closing) * t) / Double(closing) }) ?? -1)
        }
        return Row(ttcs: out)
    }

    func testHeadOnCarUnderGaitRollAlwaysAlerts() {
        // Item 1: walker 1.3 m/s, +-3 / +-4 deg gait roll, 1 px jitter: every run alerts with TTC >= 1.5 s.
        for roll: Float in [3, 4] {
            let r = Self.headOnRow(speed: 12, walk: 1.3, roll: roll, yaw: 0, sway: 0.02, jitter: 1, runs: 60, seed: UInt64(300 + roll))
            print(String(format: "MONTECARLO head-on 12 m/s, walk 1.3, roll +-%.0f, 1 px: >=1.5 s %.0f%%, median %.2f s", roll, r.pct { $0 >= 1.5 }, r.median))
            XCTAssertEqual(r.pct { $0 >= 1.5 }, 100, "roll +-\(roll)")
        }
    }

    /// Standing head posture for look and hold: turned `turnFrom` deg away at t = 0, turning to face -z over 0.5 s,
    /// then held with +-1 deg yaw and roll body sway (0.3 Hz) and 2 cm of position sway, random phase.
    static func holdCam(_ t: Double, ph: Double, turnFrom: Float) -> simd_float4x4 {
        let sway = Float(sin(2 * .pi * 0.3 * t + ph))
        return B.head(SIMD3(0.02 * sway, 1.6, 0), yaw: turnFrom * Float(max(0, 1 - t / 0.5)) + sway,
                      pitch: -10, roll: Float(sin(2 * .pi * 0.3 * t + ph + 1.3)))
    }

    /// Standing, look and hold (round 8): head-on car at `speed` (0.5 m lateral), true TTC 4.5 s at t = 0, walker
    /// turning toward it from +-60 deg, then holding with +-1 deg sway.
    static func holdRow(speed: Float, jitter: Double, runs: Int, seed: UInt64) -> Row {
        var rng = S.SplitMix(state: seed)
        var out: [Double] = []
        for _ in 0..<runs {
            let ph = Double.random(in: 0..<(2 * .pi), using: &rng)
            let from: Float = Bool.random(using: &rng) ? 60 : -60
            let d0 = speed * 4.5
            out.append(firstAlertTTC(secs: 4.2, jitterPx: jitter, rng: &rng,
                cars: { t in [B.Car(center: SIMD3(0.5, 0, -(d0 - speed * Float(t)) - 2.25), heading: .pi / 2)] },
                cam: { t in holdCam(t, ph: ph, turnFrom: from) }, truth: { t in 4.5 - t }) ?? -1)
        }
        return Row(ttcs: out)
    }

    func testStandingLookAndHoldHeadOnCar() {
        // Round 8: head-on 12 m/s, standing, turned toward the car and holding with +-1 deg sway: every run alerts
        // with true TTC >= 2.0 s.
        for jit in [1.0, 2.0] {
            let r = Self.holdRow(speed: 12, jitter: jit, runs: 60, seed: 800 + UInt64(jit))
            print(String(format: "MONTECARLO head-on 12 m/s, standing, turn then hold +-1 deg sway, %.0f px: >=2.0 s %.0f%%, median %.2f s",
                         jit, r.pct { $0 >= 2.0 }, r.median))
            XCTAssertEqual(r.pct { $0 >= 2.0 }, 100, "jitter \(jit)")
        }
    }

    func testCarFromLeftLookLeftHoldAtCurb() {
        // Round 8: car from the left at 12 m/s in the near lane (z -3), walker standing at the curb facing the street,
        // turns to look down the road (-80 deg over 0.5 s, from a random time in 1.1-1.8 s), holds 1 s with +-1 deg sway, turns
        // back. >= 90% of runs alert while the head is held, with true TTC >= 1.5 s (TTC = time until the car reaches x 0).
        // The hold must begin at true TTC >= ~2.3 s (0.6 s of still samples + 0.2 s rate smoothing + a 5 Hz frame) and
        // must still be on once the TTC drops under Tuning.ttcSeconds (3 s): a hold that ends earlier sees a car too far
        // away to alert on, which is correct. Misses (~7%): 1 px jitter on only 4 still samples at ~26 m underestimates
        // the closing speed (TTC estimate 3.0-3.2 s, just over the 3 s gate); without jitter every such hold alerts.
        var rng = S.SplitMix(state: 850)
        var ok = 0, ttcs: [Double] = []
        let runs = 60
        for _ in 0..<runs {
            let ph = Double.random(in: 0..<(2 * .pi), using: &rng)
            let start = Double.random(in: 1.1...1.8, using: &rng)
            var alertAt = -1.0
            let ttc = Self.firstAlertTTC(secs: 4.5, jitterPx: 1, rng: &rng,
                cars: { t in [B.Car(center: SIMD3(-60 + 12 * Float(t), 0, -3), heading: 0)] },
                cam: { t in
                    let u = t < start + 1.5 ? min(max((t - start) / 0.5, 0), 1) : max(0, 1 - (t - start - 1.5) / 0.5)
                    let sway = Float(sin(2 * .pi * 0.3 * t + ph))
                    return B.head(SIMD3(0, 1.6, 0), yaw: Float(-80 * u) + sway, pitch: -5, roll: Float(sin(2 * .pi * 0.3 * t + ph + 1.3)))
                }, truth: { t in alertAt = t; return 5 - t }, atCurb: true) ?? -1
            ttcs.append(ttc)
            if ttc >= 1.5, alertAt >= start + 0.5 - 1e-9, alertAt <= start + 1.5 + 1e-9 { ok += 1 }
        }
        let r = Row(ttcs: ttcs)
        print(String(format: "MONTECARLO car from left, look left + hold 1 s at the curb: %d/%d alert while held with TTC >= 1.5 s, median %.2f s",
                     ok, runs, r.median))
        XCTAssertGreaterThanOrEqual(ok, runs * 9 / 10)
    }

    func testFastCarWithJitterAlertsEarlyEnough() {
        // 20 m/s car, 3 px jitter: median first alert TTC >= 2.0 s, <= 10% of runs under 1.0 s. Walking 1.3 m/s with
        // +-2 deg gait roll; standing (look and hold, round 8): turned toward the car and holding with +-1 deg sway.
        for walk: Float in [0, 1.3] {
            let r = walk > 0 ? Self.headOnRow(speed: 20, walk: walk, roll: 2, yaw: 0, sway: 0.02, jitter: 3, runs: 60, seed: UInt64(400 + walk * 10))
                             : Self.holdRow(speed: 20, jitter: 3, runs: 60, seed: 400)
            let under1 = r.pct { $0 < 1.0 } // includes never (-1)
            print(String(format: "MONTECARLO head-on 20 m/s, %@, 3 px: median %.2f s, under 1.0 s %.0f%%, >=2.0 s %.0f%%",
                         walk > 0 ? "walk 1.3, roll +-2" : "standing, turn then hold +-1 deg sway", r.median, under1, r.pct { $0 >= 2.0 }))
            XCTAssertGreaterThanOrEqual(r.median, 2.0, "walk \(walk)")
            XCTAssertLessThanOrEqual(under1, 10, "walk \(walk)")
        }
    }

    func testWalkPastParkedCarsRarelyFalseAlerts() {
        // Item 4: walking 1.3 m/s past parked cars, +-2 deg roll, +-30 deg yaw, 100 random-phase runs: <= 5%.
        var parked: [B.Car] = []
        for i in 0..<4 {
            parked.append(B.Car(center: SIMD3(-6 - Float(i) * 5.5, 0, -2.2), heading: 0))
            parked.append(B.Car(center: SIMD3(6 + Float(i) * 5.5, 0, -2.2), heading: 0))
        }
        parked.append(B.Car(center: SIMD3(-3, 0, -12), heading: 0.3))
        var side: [B.Car] = []
        for i in 0..<6 { side.append(B.Car(center: SIMD3(2.2, 0, -8 - Float(i) * 5.5), heading: .pi / 2)) }
        for jit in [0.0, 1.0, 3.0] {
            var rng = S.SplitMix(state: 500 + UInt64(jit))
            var hits = 0
            for _ in 0..<100 {
                let ph = Double.random(in: 0..<(2 * .pi), using: &rng)
                if Self.firstAlertTTC(secs: 8, jitterPx: jit, rng: &rng, cars: { _ in side + parked }, cam: { t in
                    B.head(SIMD3(0.02 * Float(sin(2 * .pi * 0.9 * t + ph)), 1.6 + 0.03 * Float(sin(2 * .pi * 1.8 * t)), -1.3 * Float(t)),
                           yaw: 30 * Float(sin(2 * .pi * 0.4 * t + ph)), pitch: -8, roll: 2 * Float(sin(2 * .pi * 0.9 * t + ph)))
                }, truth: { $0 }) != nil { hits += 1 }
            }
            print(String(format: "MONTECARLO walk-past parked, roll +-2, yaw +-30, %.0f px: %d%% runs false-alert", jit, hits))
            XCTAssertLessThanOrEqual(hits, 6, "jitter \(jit)")
        }
    }

    func testParkedRollRigStaysSilentUnderRandomPhases() {
        // Standing, head sweeping +-60 deg while rolling (ramp 2.5 deg/s, or a 12 deg step): 60 runs each, 0 alerts.
        var parked: [B.Car] = []
        for i in 0..<4 {
            parked.append(B.Car(center: SIMD3(-6 - Float(i) * 5.5, 0, -2.2), heading: 0))
            parked.append(B.Car(center: SIMD3(6 + Float(i) * 5.5, 0, -2.2), heading: 0))
        }
        parked.append(B.Car(center: SIMD3(-3, 0, -12), heading: 0.3))
        for (name, roll) in [("ramp 2.5 deg/s", { (t: Double) in Float(-7.5 + 2.5 * t) }),
                             ("step 12 deg", { (t: Double) in Float(min(max((t - 2) * 12, 0), 12)) })] {
            for jit in [1.0, 3.0] {
                var rng = S.SplitMix(state: 600 + UInt64(jit))
                var hits = 0
                for _ in 0..<60 {
                    let ph = Double.random(in: 0..<(2 * .pi), using: &rng)
                    if Self.firstAlertTTC(secs: 6, jitterPx: jit, rng: &rng, cars: { _ in parked }, cam: { t in
                        B.head(SIMD3(0, 1.6, 0), yaw: Float(60 * sin(2 * .pi * 0.33 * t + ph)), pitch: -5, roll: roll(t))
                    }, truth: { $0 }) != nil { hits += 1 }
                }
                print("MONTECARLO parked, sweep +-60 + roll \(name), \(Int(jit)) px: \(hits)/60 runs alert")
                XCTAssertEqual(hits, 0, "\(name), jitter \(jit)")
            }
        }
    }

    /// Walker walking and scanning the street (+-60 deg at 0.33 / 0.5 Hz, roll +-3, 1.5 px jitter) while a car comes
    /// head-on (0.5 m miss, meeting at t = 4.5 s) at 8 or 12 m/s (audit-r5 sw rig, phi 0). Round 8: walking, growth
    /// samples are skipped while the head turns faster than 30 deg/s; this scan crosses the car at 108-188 deg/s, so
    /// the YOLO path never alerts (round 7: 33-60% of runs alerted with TTC >= 2 s). The depth path is unaffected.
    func testScanningWalkerHeadOnCar() {
        for vw: Float in [1.0, 1.3] {
            for vc: Float in [8, 12] {
                for hz in [0.33, 0.5] {
                    var rng = S.SplitMix(state: 700 + UInt64(vw * 10) * 100 + UInt64(vc) * 10 + UInt64(hz * 10))
                    var ttcs: [Double] = []
                    for _ in 0..<60 {
                        let ph = Double.random(in: 0..<(2 * .pi), using: &rng)
                        let T: Float = 4.5
                        let meet = SIMD3<Float>(0, 0, -vw * T)
                        let v = SIMD3<Float>(0, 0, 1) * vc
                        let side = SIMD3<Float>(-1, 0, 0)
                        let start = meet - v * T + side * 0.5 - SIMD3(0, 0, 1) * 2.25
                        ttcs.append(Self.firstAlertTTC(secs: 4.4, jitterPx: 1.5, rng: &rng,
                            cars: { t in [B.Car(center: start + v * Float(t), heading: .pi / 2)] },
                            cam: { t in B.head(SIMD3(0.02 * Float(sin(2 * .pi * 0.9 * t + ph)), 1.6 + 0.03 * Float(sin(2 * .pi * 1.8 * t + ph)), -vw * Float(t)),
                                               yaw: 60 * Float(sin(2 * .pi * hz * t + ph)), pitch: -10,
                                               roll: 3 * Float(sin(2 * .pi * 0.9 * t + ph + 0.7))) },
                            truth: { t in 4.5 - t }) ?? -1)
                    }
                    let r = Row(ttcs: ttcs)
                    print(String(format: "MONTECARLO scanning walker %.1f m/s, car %.0f m/s head-on, sweep +-60 @%.2f: >=2.0 s %.0f%%, >=1.0 s %.0f%%, never %.0f%%",
                                 vw, vc, hz, r.pct { $0 >= 2.0 }, r.pct { $0 >= 1.0 }, r.pct { $0 < 0 }))
                    XCTAssertEqual(r.pct { $0 >= 0 }, 0, "walk \(vw), car \(vc), \(hz) Hz: box growth under a fast head turn")
                }
            }
        }
    }

    /// After a roll step, only the post-step samples count: a parked car whose box height jumps with a 12 deg head
    /// tilt (the un-roll is imperfect for real boxes) and is steady before and after must not look like it closes.
    func testRollStepUsesOnlyPostStepSamples() {
        var tracker = BoxTracker()
        var alerts = 0
        for i in 0...10 {
            let t = Double(i) * 0.2
            let roll: Float = t < 0.7 ? 0 : 12
            let cam = B.head(SIMD3(0, 1.6, 0), yaw: 0, pitch: 0, roll: roll)
            let h: CGFloat = t < 0.7 ? 0.050 : 0.090 // steady, a jump at the tilt, steady again
            let box = BoxTracker.Box(label: "car", rect: CGRect(x: 0.4995, y: 0.5 - h / 2, width: 0.001, height: h), confidence: 0.9)
            _ = tracker.update([box], time: t, camera: B.info(cam))
            alerts += tracker.assess(time: t, walker: .zero, walkerVelocity: .zero, forward: SIMD2(0, -1)).filter { !$0.passing }.count
        }
        XCTAssertEqual(alerts, 0)
    }
}
