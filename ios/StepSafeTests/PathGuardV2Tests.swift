import XCTest
import simd

/// PathGuard v2 field switches (Tuning.edgeDedupeOn, dropoff010On): threshold and the 0.10 m golden.
/// Same synthetic camera and scenes as PathGuardTests.
extension PathGuardTests {
    /// Runs `body` with the switches set, then restores the defaults (keys removed).
    func withSwitches(dedupe: Bool = true, d010: Bool = true, _ body: () throws -> Void) rethrows {
        let d = UserDefaults.standard
        d.set(dedupe, forKey: Tuning.edgeDedupeKey); d.set(d010, forKey: Tuning.dropoff010Key)
        defer { [Tuning.edgeDedupeKey, Tuning.dropoff010Key].forEach(d.removeObject) }
        try body()
    }

    func testDefaultsAreTheRecommendedCombo() {
        withSwitches {} // leaves the keys unset
        XCTAssertTrue(Tuning.edgeDedupeOn && Tuning.dropoff010On)
        XCTAssertEqual(Tuning.dropoffDepthM, 0.10)
    }

    func testThresholdSwitch() throws {
        // An 11 cm step 2.2 m ahead: a drop-off at 0.10 m, flat ground at 0.12 m.
        let f = render(step(2.2, 0.11))
        try withSwitches(d010: true) {
            XCTAssertEqual(try XCTUnwrap(PathGuard.analyze(f).detections[.dropOff]).ahead, 2.2, accuracy: 0.1)
        }
        withSwitches(d010: false) {
            XCTAssertEqual(Tuning.dropoffDepthM, 0.12)
            XCTAssertNil(PathGuard.analyze(f).detections[.dropOff])
        }
    }

    // MARK: 0.10 m golden

    /// Drop-off detection on every label scene at the 0.10 m threshold (pointCount, ahead, lateral, slope),
    /// captured on exp/pathguard-v2: detection at 0.10 must not drift.
    static let dropOff010: [String: (Int, Float, Float, Bool)?] = [
        "blurred 0.13 at 1.9": (2462, 1.9338995, -0.34017617, false),
        "blurred 0.13 at 2.2": (1450, 2.2492154, -0.34515136, false),
        "blurred 0.13 at 2.4": (964, 2.4504137, -0.34279072, false),
        "drop beside the lane": (152, 2.4032702, -0.33746216, false),
        "drop over the left third": (979, 1.8086053, -0.34443334, false),
        "edge dropout 3 px: 0.13 at 2.2": (1794, 2.1292858, -0.34255204, false),
        "edge dropout 3 px: 0.15 at 2.5": (1016, 2.4266577, -0.3401056, false),
        "edge dropout 3 px: 0.2 at 2.8": (462, 2.7103763, -0.34298393, false),
        "edge dropout 6 px: 0.13 at 1.8": (3452, 1.7087809, -0.34020844, false),
        "edge dropout 8 px: 0.3 at 2.4": (1562, 2.2080774, -0.3401369, false),
        "flat": nil,
        "missing floor": (4612, 1.509185, -0.3476537, false),
        "no-depth patch before a 0.12 ramp": (1340, 1.2945757, -0.09567432, false),
        "ramp 0.083": (1394, 2.270243, -0.34771448, true),
        "ramp 0.12": (2526, 1.9175245, -0.34904313, true),
        "ramp 0.25": (4612, 1.509185, -0.3476537, false),
        "step 0.13 at 2.0": (2214, 2.0016036, -0.34932923, false),
        "step 0.15 at 1.8": (2980, 1.8086053, -0.34443334, false),
        "step 0.15 at 2.5": (808, 2.5239875, -0.33733782, false),
        "step 1.0 at 1.5": (4612, 1.509185, -0.3476537, false),
        "step 2.0 at 1.5": (4612, 1.509185, -0.3476537, false),
        "step 2.0 at 2.5": (808, 2.5239875, -0.33733782, false),
        "straddling hole 1.6-2.6": (719, 1.6044381, 0.04361839, false),
        "straddling hole 1.8-2.4": (410, 1.8086053, 0.04769077, false),
    ]

    func testLabelScenesAt010Golden() throws {
        try withSwitches(d010: true) {
            let scenes = labelScenes()
            XCTAssertEqual(scenes.count, Self.dropOff010.count)
            for (name, f) in scenes {
                let d = PathGuard.analyze(f).detections[.dropOff]
                guard let g = try XCTUnwrap(Self.dropOff010[name], name) else { XCTAssertNil(d, name); continue }
                let now = try XCTUnwrap(d, name)
                XCTAssertEqual(now.pointCount, g.0, name)
                XCTAssertEqual(now.ahead, g.1, accuracy: 1e-5, name)
                XCTAssertEqual(now.lateral, g.2, accuracy: 1e-5, name)
                XCTAssertEqual(now.slope, g.3, name)
            }
        }
    }
}
