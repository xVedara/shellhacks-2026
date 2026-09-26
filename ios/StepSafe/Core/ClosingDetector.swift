import simd

/// Something moving toward the walker (crossing assist, PLAN.md section 7). Priority 1 by Ara's rule.
struct ClosingObject: Equatable {
    /// World point to place the crossing tone at.
    var point: SIMD3<Float>
    /// Horizontal distance from the camera to the object's nearest part, metres.
    var range: Float
    /// Along / right of the walking direction (camera forward flattened), metres.
    var ahead: Float
    var lateral: Float
    /// The object's own speed toward the walker (walker motion excluded), m/s.
    var speed: Float
    /// Time to contact from the relative motion (walker included), seconds.
    var ttc: Float
    /// Predicted horizontal miss distance at closest approach, metres (0 = straight at the walker).
    var missM: Float = 0
    /// "Car", "Person", ... from the vehicle detector; nil = unrecognized object (depth).
    var label: String? = nil
    /// Detector track id: the alert identity (depth ids are positive, vehicle ids are offset by 1_000_000).
    var trackId: Int = 0
    /// Predicted to pass beside (miss >= closingMissM + margin held for 4 track frames). Depth never reports
    /// these; vehicles are reported with it set, and kept only at a curb.
    var passing = false
}

/// Any-object closing detector over LiDAR depth. Pure (no ARKit), so it is unit-tested.
///
/// What it detects: objects whose range to the walker shrinks through their OWN motion (a pushed cart, a
/// person or bike coming at the walker, including diagonally). What it does not: a sideways crosser whose range
/// does not drop (no radial motion), and anything outside the LiDAR field (about +-24 degrees in portrait,
/// under 5.5 m). A world-point displacement detector for sideways crossers is out of scope for now.
///
/// 1. Motion, not range change: each frame's points (0.3-2.2 m above the floor) are kept in world space for
///    1.2 s. Around the CURRENT camera, the scene is binned by world azimuth (2 degrees). For every bin, a
///    reference frame that actually covered the bin (0.1-1.2 s old, nearest 0.25 s) predicts the range its
///    points would have from here; closing rate = (predicted - measured) / dt. Walking and head turns move the
///    camera, not the world points, so static things predict themselves, whatever the head yaw.
///    Bins within 2 bins of either frame's field-of-view edge are skipped (partial coverage).
/// 2. Candidate bins are grouped into objects (neighbouring bins, similar range) and tracked in world xz by
///    predicted position; a track survives up to 1.2 s unseen (head sweeps, blank frames) with a gate that
///    grows with its speed times the gap. Occlusion jumps (something stepping into a bin) are rejected by the
///    track itself: its velocity is sideways, not toward the walker.
/// 3. Per track: world velocity (least squares) gives the object's own speed toward the walker; relative to the
///    walker's velocity it gives time to contact and the miss distance. Reported when own speed >=
///    minClosingSpeedMps, TTC < ttcSeconds or range < closeRangeM, and it will plausibly reach the walker:
///    miss < closingMissM + 0.25 m margin. Suppressed as passing only after miss >= that for 4 consecutive track
///    frames; while undecided, only an imminent object (TTC < 1.5 s) is reported.
struct ClosingDetector {
    private struct Frame {
        var t: Double
        var points: [SIMD3<Float>] // height band only
        var seen: [SIMD3<Float>] // every valid return (floor too): field-of-view coverage
    }

    private struct Track {
        var id: Int
        var samples: [(t: Double, pos: SIMD2<Float>)]
        var lastSeen: Double
        var range: Float
        var point: SIMD3<Float>
        /// Consecutive evaluated frames with miss >= closingMissM + margin.
        var passCount = 0
    }

    static let binDeg: Float = 2
    private static let binCount = Int(360 / binDeg)
    private static let rangeStep: Float = 0.05
    private static let rangeBins = Int((Tuning.closingMaxRangeM + 1) / rangeStep) + 1
    /// A bin's range is its k-th nearest point.
    private static let binK = 12
    private static let edgeMarginBins = 2
    /// An object's position is the mean of this many of its nearest points.
    private static let nearPoints = 20

    private var frames: [Frame] = []
    private var cams: [(t: Double, pos: SIMD2<Float>)] = []
    private var tracks: [Track] = []
    private var nextId = 1
    /// Walker's horizontal speed from the camera track, m/s (drop-off time to contact).
    private(set) var walkerSpeed: Float = 0

    mutating func reset() { frames = []; cams = []; tracks = []; walkerSpeed = 0 }

    /// Closing objects in this frame, most urgent (lowest time to contact) first.
    mutating func update(_ f: DepthFrame, time: Double) -> [ClosingObject] {
        let t = f.cameraTransform
        let cam = SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let rot = simd_float3x3(SIMD3(t.columns.0.x, t.columns.0.y, t.columns.0.z),
                                SIMD3(t.columns.1.x, t.columns.1.y, t.columns.1.z),
                                SIMD3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
        let look = -rot.columns.2
        guard look.x * look.x + look.z * look.z > 1e-4 else { reset(); return [] }
        let fwd = simd_normalize(SIMD2(look.x, look.z))
        let cam2 = SIMD2(cam.x, cam.z)

        // This frame's points in world space.
        let fx = f.intrinsics.columns.0.x, fy = f.intrinsics.columns.1.y
        let cx = f.intrinsics.columns.2.x, cy = f.intrinsics.columns.2.y
        var points: [SIMD3<Float>] = [], seen: [SIMD3<Float>] = []
        points.reserveCapacity(f.width * f.height / 2)
        seen.reserveCapacity(f.width * f.height / 8)
        for v in 0..<f.height {
            for u in 0..<f.width {
                let i = v * f.width + u
                let d = f.depth[i]
                guard d > 0, d.isFinite, f.confidence[i] >= Tuning.minConfidence else { continue }
                let p = cam + rot * SIMD3((Float(u) + 0.5 - cx) / fx * d, -(Float(v) + 0.5 - cy) / fy * d, -d)
                if (u & 3) == 0 && (v & 3) == 0 { seen.append(p) } // coverage only needs a sparse sample
                let h = p.y - f.floorY
                if h >= Tuning.closingMinHeightM && h <= Tuning.closingMaxHeightM { points.append(p) }
            }
        }
        frames.append(Frame(t: time, points: points, seen: seen))
        frames.removeAll { time - $0.t > Tuning.closingTrackGapSeconds } // references for re-appearing objects
        cams.append((time, cam2))
        cams.removeAll { time - $0.t > 0.8 }

        let clusters = Self.movingClusters(now: frames[frames.count - 1], refs: Array(frames.dropLast()), cam: cam2, time: time)
        associate(clusters, time: time)
        tracks.removeAll { time - $0.lastSeen > Tuning.closingTrackGapSeconds }

        let vCam = Self.velocity(cams) ?? .zero
        walkerSpeed = simd_length(vCam)
        var out: [ClosingObject] = []
        for i in tracks.indices where tracks[i].lastSeen == time {
            let tr = tracks[i]
            // Seen in two consecutive frames now (a single sighting after a gap may be a different object).
            guard tr.samples.count >= 2, tr.samples[tr.samples.count - 1].t - tr.samples[tr.samples.count - 2].t <= 0.2,
                  let v = Self.velocity(tr.samples), let pos = tr.samples.last?.pos else { continue }
            let p = pos - cam2
            let dist = simd_length(p)
            guard dist > 0.1 else { continue }
            let toWalker = -p / dist
            let own = simd_dot(v, toWalker) // the object's own motion toward the walker
            let vr = v - vCam
            let closingRel = simd_dot(vr, toWalker)
            guard own >= Tuning.minClosingSpeedMps, closingRel > 0 else { tracks[i].passCount = 0; continue }
            let ttc = tr.range / closingRel
            let miss = Self.miss(p, vr)
            let decision = Self.missDecision(miss: miss, ttc: ttc, passCount: &tracks[i].passCount)
            guard ttc < Tuning.ttcSeconds || tr.range < Tuning.closeRangeM, decision == .alert else { continue }
            out.append(ClosingObject(point: tr.point, range: tr.range, ahead: simd_dot(p, fwd),
                                     lateral: simd_dot(p, SIMD2(-fwd.y, fwd.x)), speed: own, ttc: ttc, missM: miss,
                                     trackId: tr.id))
        }
        return out.sorted { $0.ttc < $1.ttc }
    }

    // MARK: Miss distance

    enum MissDecision { case alert, wait, passing }

    /// Horizontal miss distance at closest approach for relative position p and relative velocity vr.
    static func miss(_ p: SIMD2<Float>, _ vr: SIMD2<Float>) -> Float {
        let vr2 = simd_length_squared(vr)
        let tca = vr2 > 1e-6 ? max(0, -simd_dot(p, vr) / vr2) : 0
        return simd_length(p + vr * tca)
    }

    /// Alert unless the object is clearly passing beside: miss >= closingMissM + closingMissMarginM held for
    /// closingPassFrames consecutive track frames. Undecided (fewer frames): wait, unless imminent (TTC < 1.5 s).
    /// Once suppressed, a track stays passing until its miss drops below closingMissM itself (hysteresis: a
    /// noisy estimate near the end of a pass does not re-trigger).
    static func missDecision(miss: Float, ttc: Float, passCount: inout Int) -> MissDecision {
        if passCount >= Tuning.closingPassFrames && miss >= Tuning.closingMissM { return .passing }
        guard miss >= Tuning.closingMissM + Tuning.closingMissMarginM else { passCount = 0; return .alert }
        passCount += 1
        if passCount >= Tuning.closingPassFrames { return .passing }
        return ttc < 1.5 ? .alert : .wait
    }

    // MARK: Motion segmentation

    private static func bin(_ p: SIMD3<Float>, from cam: SIMD2<Float>) -> (bin: Int, range: Float)? {
        let dx = p.x - cam.x, dz = p.z - cam.y
        let r = (dx * dx + dz * dz).squareRoot()
        guard r >= 0.3, r < Tuning.closingMaxRangeM + 1 else { return nil }
        var az = atan2(dx, -dz) * 180 / .pi
        if az < 0 { az += 360 }
        return (min(binCount - 1, Int(az / binDeg)), r)
    }

    /// k-th nearest range per bin (nil = too few points), and optionally per-(bin, range bucket) point sums.
    /// Per bin: k-th nearest range and how many points lie within 0.3 m behind it (the near surface), or nil.
    private static func ranges(_ pts: [SIMD3<Float>], cam: SIMD2<Float>) -> [(range: Float, near: Int32)?] {
        var counts = [Int32](repeating: 0, count: binCount * rangeBins)
        for p in pts {
            guard let (b, r) = bin(p, from: cam) else { continue }
            counts[b * rangeBins + min(rangeBins - 1, Int(r / rangeStep))] += 1
        }
        let nearBuckets = Int(0.3 / rangeStep)
        return (0..<binCount).map { b in
            var n: Int32 = 0
            for k in 0..<rangeBins {
                n += counts[b * rangeBins + k]
                if n >= Int32(binK) {
                    var near = n
                    for j in (k + 1)..<min(rangeBins, k + 1 + nearBuckets) { near += counts[b * rangeBins + j] }
                    return ((Float(k) + 0.5) * rangeStep, near)
                }
            }
            return nil
        }
    }

    private static func coverage(_ pts: [SIMD3<Float>], cam: SIMD2<Float>) -> [Bool] {
        var c = [Int](repeating: 0, count: binCount)
        for p in pts { if let (b, _) = bin(p, from: cam) { c[b] += 1 } }
        return c.map { $0 >= 2 }
    }

    private static func movingClusters(now: Frame, refs: [Frame], cam: SIMD2<Float>, time: Double)
        -> [(range: Float, pos: SIMD2<Float>, point: SIMD3<Float>)] {
        let measured = ranges(now.points, cam: cam)
        let covNow = coverage(now.seen, cam: cam)
        func interior(_ cov: [Bool], _ b: Int) -> Bool {
            (-edgeMarginBins...edgeMarginBins).allSatisfy { cov[(b + $0 + binCount) % binCount] }
        }
        // Candidate references: 0.1-1.2 s old, nearest 0.25 s first. Per bin, the first that covered it is used,
        // so a head sweep or a blank frame only shortens or lengthens the baseline instead of losing the bin.
        let usable = refs.filter { time - $0.t >= 0.08 && !$0.seen.isEmpty }
            .sorted { abs(time - $0.t - 0.25) < abs(time - $1.t - 0.25) }
        let predictions = usable.map { (dt: Float(time - $0.t), range: ranges($0.points, cam: cam), cov: coverage($0.seen, cam: cam)) }
        var candidate = [Float?](repeating: nil, count: binCount) // measured range of closing bins
        for b in 0..<binCount {
            guard let mm = measured[b], mm.range < Tuning.closingMaxRangeM, interior(covNow, b),
                  let ref = predictions.first(where: { interior($0.cov, b) }), let pp = ref.range[b] else { continue }
            // The near surface must be seen about as fully in both frames (head pitch and sweeps change what
            // part of an object a bin covers; a half-seen corner is not motion).
            guard pp.near * 2 >= mm.near, mm.near * 2 >= pp.near else { continue }
            let m = mm.range
            let rate = (pp.range - m) / ref.dt // static prediction minus measurement
            if rate >= Tuning.minClosingSpeedMps * 0.5 && rate <= Tuning.closingMaxSpeedMps { candidate[b] = m }
        }
        // Group neighbouring candidate bins (one gap allowed) with similar range.
        var groups: [[Int]] = []
        for b in 0..<binCount {
            guard let r = candidate[b] else { continue }
            if var g = groups.last, let lastBin = g.last, b - lastBin <= 2, let lr = candidate[lastBin], abs(lr - r) < 0.5 {
                g.append(b); groups[groups.count - 1] = g
            } else {
                groups.append([b])
            }
        }
        if groups.count > 1, let first = groups.first, let last = groups.last, first.first == 0,
           last.last == binCount - 1 { // wrap around north
            groups[0] = last + first
            groups.removeLast()
        }
        guard !groups.isEmpty else { return [] }
        // Near-surface points of each group: its bins, within 0.3 m of the bin's measured range. The object is
        // tracked by the mean of its nearest points (its closest part), not the centroid: the visible centroid
        // drifts toward the walker as more of an object's side comes into view, which would fake a collision course.
        var member = [Int](repeating: -1, count: binCount)
        for (gi, g) in groups.enumerated() { for b in g { member[b] = gi } }
        var near = [[(r: Float, p: SIMD3<Float>)]](repeating: [], count: groups.count)
        for p in now.points {
            guard let (b, r) = bin(p, from: cam), member[b] >= 0, let m = candidate[b], r <= m + 0.3 else { continue }
            near[member[b]].append((r, p))
        }
        return (0..<groups.count).compactMap { gi in
            guard near[gi].count >= Tuning.closingMinPoints else { return nil }
            let closest = near[gi].sorted { $0.r < $1.r }.prefix(nearPoints)
            let p = closest.map(\.p).reduce(.zero, +) / Float(closest.count)
            let r = groups[gi].compactMap { candidate[$0] }.min() ?? closest[closest.startIndex].r
            return (r, SIMD2(p.x, p.z), p)
        }
    }

    // MARK: Tracking

    private mutating func associate(_ clusters: [(range: Float, pos: SIMD2<Float>, point: SIMD3<Float>)], time: Double) {
        var used = Set<Int>()
        for c in clusters {
            var best: (i: Int, d: Float)?
            for (i, tr) in tracks.enumerated() where !used.contains(i) {
                guard let last = tr.samples.last else { continue }
                let v = Self.velocity(tr.samples) ?? .zero
                let gap = Float(time - last.t)
                let predicted = last.pos + v * gap
                let d = simd_distance(predicted, c.pos)
                // Spatially plausible: near where the track should be now; the gate grows with speed x gap
                // (an object unseen during a head sweep may have moved; its velocity is uncertain).
                // Consecutive frames: tight (a jump the track's motion does not explain is another object).
                // After a gap (head sweep): wider, growing with speed x gap; without a velocity yet, a walking
                // object (1.8 m/s) may have moved.
                let known = Self.velocity(tr.samples) != nil
                let gate = gap <= 0.25
                    ? 0.3 + (known ? 0.5 * gap : 3.0 * gap)
                    : min(2.5, 0.7 + (known ? 0.5 * simd_length(v) * gap + 0.5 * gap : 1.8 * gap))
                if d < gate && d < (best?.d ?? .greatestFiniteMagnitude) { best = (i, d) }
            }
            if let b = best {
                used.insert(b.i)
                tracks[b.i].samples.append((time, c.pos))
                tracks[b.i].samples.removeAll { time - $0.t > Tuning.closingWindowSeconds }
                tracks[b.i].lastSeen = time
                tracks[b.i].range = c.range
                tracks[b.i].point = c.point
            } else {
                tracks.append(Track(id: nextId, samples: [(time, c.pos)], lastSeen: time, range: c.range, point: c.point))
                used.insert(tracks.count - 1)
                nextId += 1
            }
        }
    }

    /// Least-squares velocity (m/s): at least 4 samples over 0.24 s (4 frames at 12 Hz), 3 over 0.4 s, or 2 over 0.6 s (a track
    /// bridged across a head-sweep gap: few samples, long baseline, so position noise matters little).
    private static func velocity(_ s: [(t: Double, pos: SIMD2<Float>)]) -> SIMD2<Float>? {
        guard let t0 = s.first?.t, let t1 = s.last?.t else { return nil }
        let span = t1 - t0
        guard (s.count >= 4 && span >= 0.24) || (s.count >= 3 && span >= 0.4) || (s.count >= 2 && span >= 0.6) else { return nil }
        let n = Float(s.count)
        let ts = s.map { Float($0.t - t0) }
        let mt = ts.reduce(0, +) / n
        let mp = s.map(\.pos).reduce(.zero, +) / n
        var sxx: Float = 0, sxp = SIMD2<Float>.zero
        for (i, e) in s.enumerated() {
            let dtm = ts[i] - mt
            sxx += dtm * dtm
            sxp += dtm * (e.pos - mp)
        }
        return sxx > 0 ? sxp / sxx : nil
    }
}
