import simd

// Path guard: pure geometry over one depth frame (PLAN.md section 7, "Path guard").
// Mirrors analysis/pathguard.py (validated on real LiDAR recordings) rule for rule; keep them in sync.
// No ARKit in here, so it runs in simulator unit tests on synthetic depth.
// All thresholds come from Tuning.swift.

enum HazardKind: CaseIterable {
    case dropOff, headHeight, ground
    /// Crossing assist: a car or any object closing fast (ClosingDetector / VehicleDetector), never PathGuard.
    case closing
}

/// One depth frame, already copied out of ARKit.
struct DepthFrame {
    /// Metres along the camera's viewing axis, row-major, width * height. 0 = no return.
    var depth: [Float]
    /// ARConfidenceLevel raw values (0 low, 1 medium, 2 high), same layout as depth.
    var confidence: [UInt8]
    var width: Int
    var height: Int
    /// Pinhole intrinsics scaled to the depth resolution (ARKit layout: columns [fx 0 0] [0 fy 0] [cx cy 1]).
    var intrinsics: simd_float3x3
    /// Camera-to-world, ARKit convention: camera x right, y up, looking down -z.
    var cameraTransform: simd_float4x4
    /// World y of the ground under the user.
    var floorY: Float
    /// True while floorY is only the camera-height estimate (no ARKit floor plane): the drop-pixel
    /// rule is skipped then, so a wrong wearer height cannot fake a drop-off. Missing-floor still runs.
    var floorIsEstimate = false
}

struct Detection {
    var kind: HazardKind
    /// World point: the nearest point of the obstacle, or the nearest missing ground point of a drop-off.
    var point: SIMD3<Float>
    /// Metres ahead along the walking direction.
    var ahead: Float
    /// Metres to the right of the walking line (negative = left).
    var lateral: Float
    var pointCount: Int
    /// Set for .closing only; then `ahead` is the object's horizontal distance (range), not the along-lane part.
    var closing: Closing? = nil
    /// A drop-off spoken right after a closing phrase: just "Drop-off ahead.", no tone (it follows at once, as
    /// the combined phrase's second half would).
    var followOn = false
    /// The drop-off already got its haptic while the closing words played (AlertPolicy.dropOffToCue): its
    /// follow-on plays the drop-off tone first (right after the closing words) and no second haptic.
    var preCued = false

    struct Closing: Equatable {
        var speed: Float
        var ttc: Float
        /// "Car", "Person", ... or nil for an unrecognized object.
        var label: String?
        /// Detector track id: the alert identity.
        var trackId: Int = 0
        /// Predicted miss distance, metres.
        var missM: Float = 0
        /// A vehicle predicted to pass beside, kept only because the walker is at a curb: sorts after drop-offs.
        var passing = false
        /// Set by AlertPolicy when a drop-off is urgent too: the phrase is "<closing>. Drop-off ahead." and the
        /// drop-off (at this point) counts as announced with it.
        var dropOffPoint: SIMD3<Float>? = nil
        var dropOffAhead: Float = 0
    }
}

enum FloorSource {
    case planeUnder, planeNearest, estimate

    /// Only a plane under the walker is trusted for the drop-pixel rule and the 0.1 m ground band. The nearest
    /// plane may be the street below a curb or a sidewalk above it, so it gets the estimated-floor rules.
    var usesEstimateRules: Bool { self != .planeUnder }
}

/// A horizontal ARKit plane in world terms: centre x,z, extent rotated by `yaw` about +y
/// (local x axis = (cos yaw, 0, -sin yaw)), `width` along local x, `depth` along local z.
struct FloorPlane {
    var y: Float
    var isFloor: Bool
    var centerX: Float = 0, centerZ: Float = 0
    var yaw: Float = 0
    var width: Float = 0, depth: Float = 0

    func contains(x: Float, z: Float, margin: Float = Tuning.floorPlaneMarginM) -> Bool {
        let dx = x - centerX, dz = z - centerZ
        let lx = dx * cos(yaw) - dz * sin(yaw)
        let lz = dx * sin(yaw) + dz * cos(yaw)
        return abs(lx) <= width / 2 + margin && abs(lz) <= depth / 2 + margin
    }
}

/// One world-space camera ray per depth pixel (`rotation * dirCam`, PathGuard's formula).
/// Built once per analysis frame and shared with ClosingDetector, which otherwise unprojects the same pixels again.
enum DepthRays {
    /// World ray through the centre of pixel (`u`, `v`). A point at depth `d` is `camera + ray * d`.
    static func direction(u: Int, v: Int, intrinsics k: simd_float3x3, rotation rot: simd_float3x3) -> SIMD3<Float> {
        let fx = k.columns.0.x, fy = k.columns.1.y
        let cx = k.columns.2.x, cy = k.columns.2.y
        return rot * SIMD3((Float(u) + 0.5 - cx) / fx, -(Float(v) + 0.5 - cy) / fy, -1)
    }

    /// Fills `storage` in row-major pixel order. Reuses the buffer when the depth size is unchanged.
    static func fill(_ f: DepthFrame, into storage: inout [SIMD3<Float>]) {
        let n = f.width * f.height
        if storage.count != n { storage = Array(repeating: .zero, count: n) }
        guard n > 0 else { return }
        let rot = f.cameraTransform.rotation3
        let k = f.intrinsics
        var i = 0
        for v in 0..<f.height {
            for u in 0..<f.width {
                storage[i] = direction(u: u, v: v, intrinsics: k, rotation: rot)
                i += 1
            }
        }
    }
}

struct PathGuardResult {
    var detections: [HazardKind: Detection] = [:]
    /// Per-pixel debug labels (see PixelLabel), empty unless requested.
    var labels: [UInt8] = []
}

enum PixelLabel {
    static let none: UInt8 = 0
    static let lane: UInt8 = 1       // valid point inside the lane box, not in a band
    static let obstacle: UInt8 = 2   // ground or head band hit
    static let dropOff: UInt8 = 3    // expected ground in the drop zone came back below or missing
}

enum PathGuard {
    /// `rays`, when it has one entry per pixel, is the frame's `DepthRays` buffer. The direct path (tests, a
    /// short buffer) computes the same rays itself.
    static func analyze(_ f: DepthFrame, wantLabels: Bool = false, rays: [SIMD3<Float>]? = nil) -> PathGuardResult {
        var result = PathGuardResult()
        let count = f.width * f.height
        guard count > 0, f.depth.count == count, f.confidence.count == count else { return result }
        if wantLabels { result.labels = [UInt8](repeating: PixelLabel.none, count: count) }

        let t = f.cameraTransform
        let cam = t.translation
        let rot = t.rotation3
        let sharedRays = rays?.count == count ? rays : nil
        // Walking direction = camera forward flattened onto the horizontal plane.
        let look = -rot.columns.2
        let flat = SIMD2(look.x, look.z)
        guard simd_length(flat) >= 1e-3 else { return result } // looking straight up or down
        let f2 = simd_normalize(flat)
        let fwd = SIMD3(f2.x, 0, f2.y)
        let right = SIMD3(-fwd.z, 0, fwd.x)

        var ground = Accumulator(), head = Accumulator(), drop = Accumulator()
        var expected = 0, drops = 0, missing = 0
        // Estimated floor: raise the ground band's lower edge so a wearer shorter than cameraHeightM
        // does not see the floor itself as an obstacle.
        let groundMin = f.floorIsEstimate ? Tuning.estimatedFloorGroundMinM : Tuning.groundBandMinM

        for v in 0..<f.height {
            for u in 0..<f.width {
                let i = v * f.width + u
                // World ray; a point at depth d is cam + dir * d. Shared with ClosingDetector when `rays` is set.
                let dir = sharedRays?[i] ?? DepthRays.direction(u: u, v: v, intrinsics: f.intrinsics, rotation: rot)
                let d = f.depth[i]
                let valid = d > 0 && d.isFinite && f.confidence[i] >= Tuning.minConfidence
                var h: Float = 0

                // Steps 1, 3, 4: unproject, lane box, height bands.
                if valid {
                    let p = cam + dir * d
                    let rel = p - cam
                    let ahead = simd_dot(rel, fwd), lateral = simd_dot(rel, right)
                    h = p.y - f.floorY
                    if abs(lateral) <= Tuning.laneHalfWidthM,
                       ahead >= Tuning.laneNearM, ahead <= Tuning.laneFarM {
                        var label = PixelLabel.lane
                        if h >= groundMin, h <= Tuning.groundBandMaxM {
                            ground.add(p, ahead, lateral); label = PixelLabel.obstacle
                        } else if h >= Tuning.headBandMinM, h <= Tuning.headBandMaxM {
                            head.add(p, ahead, lateral); label = PixelLabel.obstacle
                        }
                        if wantLabels { result.labels[i] = label }
                    }
                }

                // Step 5: drop-off. Expected floor pixels = rays that would hit the floor plane
                // 1-3 m ahead inside the lane. Drop = measured point more than dropoffDepthM below
                // the floor; missing = no valid depth. Anything else (floor, occluder) only counts
                // toward `expected`.
                guard dir.y < 0 else { continue }
                let tHit = (f.floorY - cam.y) / dir.y
                guard tHit > 0 else { continue }
                let e = cam + dir * tHit
                let eRel = e - cam
                let eAhead = simd_dot(eRel, fwd), eLateral = simd_dot(eRel, right)
                guard abs(eLateral) <= Tuning.laneHalfWidthM,
                      eAhead >= Tuning.dropoffNearM, eAhead <= Tuning.dropoffFarM else { continue }
                expected += 1
                let isMissing = !valid, isDrop = valid && h < -Tuning.dropoffDepthM
                if isMissing { missing += 1 }
                if isDrop { drops += 1 }
                if isMissing || isDrop {
                    drop.add(e, eAhead, eLateral)
                    if wantLabels { result.labels[i] = PixelLabel.dropOff }
                }
            }
        }

        if ground.count >= Tuning.minPointsGround {
            result.detections[.ground] = ground.detection(.ground)
        }
        if head.count >= Tuning.minPointsHead {
            result.detections[.headHeight] = head.detection(.headHeight)
        }
        // Floor out of view -> few expected pixels -> no missing-floor drop-off.
        if (!f.floorIsEstimate && drops >= Tuning.minPointsDropoff) ||
            (expected >= Tuning.dropoffMinExpectedPoints &&
             Float(missing) >= Tuning.dropoffMissingFraction * Float(expected)) {
            result.detections[.dropOff] = drop.detection(.dropOff)
        }
        return result
    }

    private struct Accumulator {
        var count = 0
        var nearest = SIMD3<Float>(repeating: 0)
        var nearestAhead = Float.greatestFiniteMagnitude
        var nearestLateral: Float = 0

        mutating func add(_ p: SIMD3<Float>, _ ahead: Float, _ lateral: Float) {
            count += 1
            if ahead < nearestAhead { nearestAhead = ahead; nearest = p; nearestLateral = lateral }
        }

        func detection(_ kind: HazardKind) -> Detection {
            Detection(kind: kind, point: nearest, ahead: nearestAhead, lateral: nearestLateral, pointCount: count)
        }
    }

    /// Step 2 (pathguard.py pick_floor): among ARKit floor-classified planes at least
    /// floorMinBelowCameraM below the camera,
    ///   1. the highest one whose extent contains the camera's x,z: the one under the walker. Exact extents first;
    ///      only if none contains it, extents plus floorPlaneMarginM (so a sidewalk 0.29 m behind a walker who
    ///      stepped down onto the street never wins over the street plane they stand on);
    ///   2. else the one nearest camera y - cameraHeightM;
    ///   3. else camera y - cameraHeightM (an estimate).
    static func floor(planes: [FloorPlane], camera: SIMD3<Float>) -> (y: Float, source: FloorSource) {
        let below = planes.filter { $0.isFloor && $0.y < camera.y - Tuning.floorMinBelowCameraM }
        let exact = below.filter { $0.contains(x: camera.x, z: camera.z, margin: 0) }.map(\.y).max()
        if let under = exact ?? below.filter({ $0.contains(x: camera.x, z: camera.z) }).map(\.y).max() {
            return (under, .planeUnder)
        }
        let guess = camera.y - Tuning.cameraHeightM
        if let nearest = below.min(by: { abs($0.y - guess) < abs($1.y - guess) }) {
            return (nearest.y, .planeNearest)
        }
        return (guess, .estimate)
    }
}

/// Step 6: a hazard is confirmed once it has been in every analysis frame for Tuning.confirmSeconds,
/// and cleared once it has been absent for Tuning.clearSeconds. Timestamps are ARFrame seconds.
struct HazardTracker {
    private var firstHit: [HazardKind: Double] = [:]
    private var lastHit: [HazardKind: Double] = [:]
    private(set) var confirmed: [HazardKind: Detection] = [:]

    mutating func update(_ detections: [HazardKind: Detection], time: Double) -> [HazardKind: Detection] {
        for kind in HazardKind.allCases {
            if let d = detections[kind] {
                let start = firstHit[kind] ?? time
                firstHit[kind] = start
                lastHit[kind] = time
                if confirmed[kind] != nil || time - start >= Tuning.confirmSeconds { confirmed[kind] = d }
            } else {
                firstHit[kind] = nil
                if let last = lastHit[kind], time - last >= Tuning.clearSeconds { confirmed[kind] = nil }
            }
        }
        return confirmed
    }
}
