import CoreGraphics
import Foundation
import simd

/// IoU tracker for YOLO boxes plus closing math from box growth (PLAN.md section 7: "box growth rate beyond"
/// LiDAR range). Pure, so it is unit-tested.
/// Head rotation is compensated by working in WORLD directions: every box becomes an azimuth/elevation
/// rectangle and an angular height (the angle between its top and bottom rays), both unchanged by turning the
/// head. Matching is IoU on those rectangles; growth is d(ln angular height)/dt, so a static object sliding to
/// the frame edge (where its pixel height grows by 1/cos) does not look like it is closing.
struct BoxTracker {
    struct Box {
        var label: String
        /// Normalized, upright portrait image, origin top-left.
        var rect: CGRect
        var confidence: Float
    }

    /// The camera at this frame: sensor (landscape) intrinsics and size, camera-to-world rotation.
    struct Camera {
        var fx: Float, fy: Float, cx: Float, cy: Float
        var width: Float, height: Float
        var rotation: simd_float3x3
        /// Camera position (world): tracks keep world positions for the miss distance.
        var position: SIMD3<Float> = .zero
    }

    struct Track {
        var id: Int
        var label: String
        var group: String
        /// World azimuth/elevation rectangle, degrees (azimuth unwrapped around `azimuth`).
        var bearing: CGRect
        var azimuth: Double
        /// World direction of the box centre.
        var direction: SIMD3<Float>
        var samples: [(t: Double, ang: Double)]
        var lastSeen: Double
        /// World xz of the object (direction x distance from class height), per sample.
        var positions: [(t: Double, pos: SIMD2<Float>)] = []
        /// Consecutive frames with miss >= closingMissM + margin (ClosingDetector.missDecision).
        var passCount = 0
        /// Physical height prior (m), frozen from the class of the first detection (label flips never rescale).
        var heightM: Double = 1.5
    }

    static let minIoU: CGFloat = 0.3
    /// Growth window: long enough to span two head sweeps (a car in view once a second).
    static let window: Double = 2.0
    /// Tracks survive head sweeps: up to this long unseen (a +-60 deg sweep at 0.33 Hz is out of view ~1.5 s),
    /// re-matched by world bearing.
    static let dropAfter: Double = 2.0

    private(set) var tracks: [Track] = []
    private var nextId = 1
    private var lastCamera: (t: Double, p: SIMD3<Float>)?
    /// Smoothed camera speed (m/s): walking vs standing.
    private var walkerSpeed: Float = 0
    /// Head yaw / roll rates at YOLO frames (look and hold).
    private var head = HeadMotion()
    /// Standing: start of the current still-head window (nil while the head moves or when walking).
    private(set) var stillSince: Double?
    private(set) var isWalking = false
    /// Roll at the last roll step, and when it happened: after the head's roll moves more than
    /// rollStepDeg from the anchor, growth must be re-established (5 samples over >= 0.8 s) before alerting.
    private var rollAnchor: Double?
    private(set) var rollStepAt = -Double.infinity
    static let rollStepDeg = 8.0 // gait roll (+-4 deg, 8 peak to peak) must not count as a step
    /// Minimum significance of the growth slope (slope / its standard error) before a vehicle may alert.
    static let minGrowthT = 3.0
    /// Walking: at least this many growth samples over this long before a vehicle may alert.
    static let walkingMinSamples = 5
    static let walkingMinSpan = 1.0
    /// Walking: the growth slope less this many standard errors must still leave an own approach >= 1.5 m/s.
    static let pessimisticSE = 2.5
    /// Walking: growth samples are skipped while the head rolls faster than this (deg/s).
    /// Gait roll (+-3 deg at 0.9 Hz = 17 deg/s peak) stays under this; the per-frame un-roll does the work.
    static let maxRollRateWalkingDegPerSec = 25.0
    /// A track re-found by bearing alone after longer than this unseen becomes a new track (fresh id).
    static let refindGapSeconds = 0.3
    /// Standing: an alert needs this long of still-head growth samples in the current still window...
    static let stillMinSeconds = 0.6
    /// ...or, for a close car growing fast (growth T >= 2 x minGrowthT within vehicleFastRangeM), this long: a car
    /// crossing 2 m in front is in view ~0.8 s and recedes before 0.6 s of samples exist (night fly-by 03-39-39Z).
    static let stillFastMinSeconds = 0.4
    static let fastMinGrowthT = 2 * minGrowthT
    /// Walking: no growth samples while the head turns faster than this (deg/s).
    static let maxYawRateWalkingDegPerSec = 30.0

    /// Camera roll relative to gravity, degrees in (-90, 90]: the angle between the portrait image's vertical
    /// axis (sensor x) and world up projected into the image plane.
    static func roll(_ c: Camera) -> Double { roll(c.rotation) }
    static func roll(_ rotation: simd_float3x3) -> Double {
        let up = rotation.transpose * SIMD3<Float>(0, 1, 0) // world up in camera coordinates
        var r = Double(atan2(up.y, -up.x)) * 180 / .pi
        if r > 90 { r -= 180 } else if r <= -90 { r += 180 }
        return r
    }

    /// Height of the object in a rolled image: an axis-aligned box of a rectangle rolled by r has
    /// H = h cos r + w |sin r|, W = w cos r + h |sin r|; solved for h (pixels), as a share of H.
    static func unrolledHeightShare(widthPx: Double, heightPx: Double, rollDeg: Double) -> Double {
        let r = abs(rollDeg) * .pi / 180
        guard r > 0.01, heightPx > 0 else { return 1 }
        let h = (heightPx * cos(r) - widthPx * sin(r)) / cos(2 * r)
        return min(1, max(0.3, h / heightPx))
    }

    static func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let i = a.intersection(b)
        guard !i.isNull, i.width > 0, i.height > 0 else { return 0 }
        let inter = i.width * i.height
        return inter / (a.width * a.height + b.width * b.height - inter)
    }

    /// Vehicle classes are confused with each other frame to frame (car/truck/bus...): match them as one group.
    static func group(_ label: String) -> String {
        ["car", "truck", "bus", "motorcycle", "bicycle"].contains(label) ? "vehicle" : label
    }

    /// A box touching the top or bottom border is clipped: its height is not the object's. Side clipping keeps
    /// the height (a car entering from the side is still measured).
    static func isClipped(_ r: CGRect) -> Bool { r.minY < 0.01 || r.maxY > 0.99 }

    /// World direction of a normalized portrait point (orientation .right: xs = yp * W, ys = (1 - xp) * H).
    static func direction(_ p: CGPoint, _ c: Camera) -> SIMD3<Float> {
        let xs = Float(p.y) * c.width, ys = (1 - Float(p.x)) * c.height
        return simd_normalize(c.rotation * SIMD3((xs - c.cx) / c.fx, -(ys - c.cy) / c.fy, -1))
    }

    static func azimuth(_ d: SIMD3<Float>) -> Double { Double(atan2(d.x, -d.z)) * 180 / .pi }
    static func elevation(_ d: SIMD3<Float>) -> Double { Double(atan2(d.y, (d.x * d.x + d.z * d.z).squareRoot())) * 180 / .pi }

    static func unwrap(_ a: Double, around c: Double) -> Double {
        var d = a - c
        while d > 180 { d -= 360 }
        while d < -180 { d += 360 }
        return c + d
    }

    /// Greedy matching, best IoU first, same group only. Clipped boxes are ignored. Returns tracks seen now.
    mutating func update(_ boxes: [Box], time: Double, camera: Camera) -> [Track] {
        tracks.removeAll { time - $0.lastSeen > Self.dropAfter }
        let rollDeg = Self.roll(camera)
        // Walking or standing, from the camera track (ARKit position between YOLO frames).
        if let last = lastCamera, time > last.t {
            let v = SIMD2(camera.position.x - last.p.x, camera.position.z - last.p.z) / Float(time - last.t)
            walkerSpeed = walkerSpeed * 0.5 + 0.5 * simd_length(v)
        }
        lastCamera = (time, camera.position)
        let walking = walkerSpeed > 0.3
        isWalking = walking
        head.update(time: time, rotation: camera.rotation)
        let rollRate = head.rollRate, yawRate = head.yawRate
        // "Look and hold". Standing: box growth is trusted ONLY while the head is still (yaw < 12 deg/s, roll <
        // 5 deg/s); a new still window restarts growth for every track, and while the head moves there is no
        // growth and no alert (monocular box growth under head motion is not trustworthy). Walking keeps the
        // world-track path, skipping samples while the head rolls (> 25 deg/s) or turns (> 30 deg/s).
        let still = head.still
        let acceptSamples: Bool
        if walking {
            acceptSamples = rollRate <= Self.maxRollRateWalkingDegPerSec && yawRate <= Self.maxYawRateWalkingDegPerSec
            stillSince = nil
        } else {
            if still && stillSince == nil {
                stillSince = time
                for i in tracks.indices { tracks[i].samples = []; tracks[i].positions = [] }
            } else if !still {
                stillSince = nil
            }
            acceptSamples = still
        }
        let rolling = !acceptSamples
        if let anchor = rollAnchor {
            if abs(rollDeg - anchor) > Self.rollStepDeg { rollStepAt = time; rollAnchor = rollDeg }
        } else {
            rollAnchor = rollDeg
        }
        struct Obs { var box: Box; var center: SIMD3<Float>; var az: Double; var rect: CGRect; var ang: Double; var sideClipped: Bool }
        let obs: [Obs] = boxes.filter { !Self.isClipped($0.rect) }.map { b in
            let r = b.rect
            let center = Self.direction(CGPoint(x: r.midX, y: r.midY), camera)
            let az = Self.azimuth(center)
            let corners = [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY),
                           CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY)].map { Self.direction($0, camera) }
            let azs = corners.map { Self.unwrap(Self.azimuth($0), around: az) }, els = corners.map(Self.elevation)
            let rect = CGRect(x: azs.min()!, y: els.min()!, width: azs.max()! - azs.min()!, height: els.max()! - els.min()!)
            let top = Self.direction(CGPoint(x: r.midX, y: r.minY), camera)
            let bottom = Self.direction(CGPoint(x: r.midX, y: r.maxY), camera)
            // Angular height with the head's roll removed (a rolled box's height includes part of its width).
            let share = Self.unrolledHeightShare(widthPx: Double(r.width) * Double(camera.height),
                                                 heightPx: Double(r.height) * Double(camera.width), rollDeg: rollDeg)
            let ang = Double(acos(max(-1, min(1, simd_dot(top, bottom))))) * share
            // A box cut by the left/right border still measures height (growth), but its centre is not the
            // object's: it does not feed the world positions behind the miss distance.
            return Obs(box: b, center: center, az: az, rect: rect, ang: ang, sideClipped: r.minX < 0.01 || r.maxX > 0.99)
        }
        var pairs: [(ti: Int, oi: Int, iou: CGFloat)] = []
        for (ti, t) in tracks.enumerated() {
            for (oi, o) in obs.enumerated() where Self.group(o.box.label) == t.group {
                var r = o.rect
                r.origin.x = Self.unwrap(r.midX, around: t.bearing.midX) - r.width / 2 // same azimuth branch
                var v = Self.iou(t.bearing, r)
                if let la = t.samples.last?.ang, la > 0 { // growth-compensated overlap: the old box scaled by the size change
                    let k = CGFloat(min(2, max(0.7, o.ang / la)))
                    let b = t.bearing
                    v = max(v, Self.iou(CGRect(x: b.midX - b.width * k / 2, y: b.midY - b.height * k / 2,
                                               width: b.width * k, height: b.height * k), r))
                }
                if v >= Self.minIoU { pairs.append((ti, oi, v)) }
            }
        }
        // Tracks with no IoU match (after a sweep gap, or cut by the side border) may still match by world
        // bearing: centre within half the box size plus 10 deg/s x the gap, and a plausible size change (0.7-2x).
        // Ranked below every IoU match, nearest bearing first (not oldest track first).
        for (ti, t) in tracks.enumerated() where !pairs.contains(where: { $0.ti == ti }) {
            for (oi, o) in obs.enumerated() where Self.group(o.box.label) == t.group {
                let daz = abs(Self.unwrap(o.az, around: t.azimuth) - t.azimuth)
                let del = abs(Double(o.rect.midY - t.bearing.midY))
                let gate = 0.5 * Double(max(o.rect.width, o.rect.height, t.bearing.width, t.bearing.height)) + 10 * (time - t.lastSeen)
                let ratio = o.ang / max(t.samples.last?.ang ?? o.ang, 1e-9)
                let dist = (daz * daz + del * del).squareRoot()
                if dist < gate && ratio > 0.7 && ratio < 2 { pairs.append((ti, oi, CGFloat(0.01 / (1 + dist)))) }
            }
        }
        var usedT = Set<Int>(), usedO = Set<Int>(), seen: [Int] = [], retired = Set<Int>()
        for p in pairs.sorted(by: { $0.iou > $1.iou }) where !usedT.contains(p.ti) && !usedO.contains(p.oi) {
            usedT.insert(p.ti)
            if p.iou < Self.minIoU && time - tracks[p.ti].lastSeen > Self.refindGapSeconds {
                // Re-found by bearing alone (no box overlap) after a gap: it may be another car at a similar
                // bearing. It gets a FRESH track id (so its ping, announcement and pending state start over) and
                // no growth history; the old track retires.
                retired.insert(tracks[p.ti].id)
                continue
            }
            usedO.insert(p.oi)
            let o = obs[p.oi]
            tracks[p.ti].label = o.box.label
            tracks[p.ti].bearing = o.rect
            tracks[p.ti].azimuth = o.az
            tracks[p.ti].direction = o.center
            tracks[p.ti].lastSeen = time
            if acceptSamples { // head motion: box heights not trusted, no growth sample
                tracks[p.ti].samples.append((time, o.ang))
                if !o.sideClipped {
                    tracks[p.ti].positions.append((time, Self.position(o.center, ang: o.ang, heightM: tracks[p.ti].heightM, camera)))
                }
            }
            tracks[p.ti].samples.removeAll { time - $0.t > Self.window }
            tracks[p.ti].positions.removeAll { time - $0.t > Self.window }
            seen.append(p.ti)
        }
        for (oi, o) in obs.enumerated() where !usedO.contains(oi) {
            let h = Self.classHeightM[o.box.label] ?? 1.5
            tracks.append(Track(id: nextId, label: o.box.label, group: Self.group(o.box.label), bearing: o.rect,
                                azimuth: o.az, direction: o.center, samples: rolling ? [] : [(time, o.ang)], lastSeen: time,
                                positions: o.sideClipped || rolling ? [] : [(time, Self.position(o.center, ang: o.ang, heightM: h, camera))],
                                heightM: h))
            nextId += 1
            seen.append(tracks.count - 1)
        }
        let seenIds = Set(seen.map { tracks[$0].id })
        tracks.removeAll { retired.contains($0.id) }
        return tracks.filter { seenIds.contains($0.id) }
    }

    mutating func reset() {
        tracks = []; head = HeadMotion(); rollAnchor = nil; rollStepAt = -.infinity; lastCamera = nil; walkerSpeed = 0
        stillSince = nil; isWalking = false
    }

    /// Significance of the growth: least-squares slope of ln(angular height) over time divided by its standard
    /// error. A car driving at the walker grows clearly; jittery or partly clipped boxes (a head sweep, a roll)
    /// give a slope within their noise. (R^2 >= 0.8 was too strict for fast cars with jittery boxes.)
    static func growthT(_ samples: [(t: Double, ang: Double)]) -> Double {
        guard let (slope, se) = growthSlope(samples) else { return 0 }
        return se > 1e-9 ? slope / se : (slope > 0 ? .infinity : 0)
    }

    /// Least-squares slope of ln(angular height) over time and its standard error.
    static func growthSlope(_ samples: [(t: Double, ang: Double)]) -> (slope: Double, se: Double)? {
        guard samples.count >= 3, let t0 = samples.first?.t else { return nil }
        let xs = samples.map { $0.t - t0 }, ys = samples.map { log(max($0.ang, 1e-9)) }
        let n = Double(xs.count), mx = xs.reduce(0, +) / n, my = ys.reduce(0, +) / n
        let sxx = zip(xs, xs).map { ($0 - mx) * ($1 - mx) }.reduce(0, +)
        guard sxx > 0 else { return nil }
        let slope = zip(xs, ys).map { ($0 - mx) * ($1 - my) }.reduce(0, +) / sxx
        var ssr = 0.0
        for (x, y) in zip(xs, ys) { let e: Double = y - (my + slope * (x - mx)); ssr += e * e }
        return (slope, (ssr / max(n - 2, 1) / sxx).squareRoot())
    }

    /// d(ln x)/dt by least squares over the window (1/s; > 0 = growing = closing),
    /// or nil with fewer than 3 samples or under 0.4 s of history.
    static func growthRate(_ samples: [(t: Double, ang: Double)]) -> Double? {
        guard samples.count >= 3, let t0 = samples.first?.t, let t1 = samples.last?.t, t1 - t0 >= 0.4 else { return nil }
        let xs = samples.map { $0.t - t0 }, ys = samples.map { log(max($0.ang, 1e-9)) }
        let n = Double(xs.count), mx = xs.reduce(0, +) / n, my = ys.reduce(0, +) / n
        let sxx = zip(xs, xs).map { ($0 - mx) * ($1 - mx) }.reduce(0, +)
        guard sxx > 0 else { return nil }
        return zip(xs, ys).map { ($0 - mx) * ($1 - my) }.reduce(0, +) / sxx
    }

    /// Typical real height of each class, metres (distance = height / angular height).
    static let classHeightM: [String: Double] = ["car": 1.5, "truck": 3.0, "bus": 3.0, "motorcycle": 1.2,
                                                 "bicycle": 1.1, "person": 1.7]

    /// Spoken name for a YOLO class.
    static func spokenLabel(_ cls: String) -> String {
        switch cls {
        case "car", "truck", "bus": return "Car"
        default: return cls.prefix(1).uppercased() + cls.dropFirst()
        }
    }

    /// Distance, the object's OWN closing speed (walker's speed toward it subtracted: the own-motion gate) and
    /// time to contact from the RELATIVE closing speed (zMid x growth rate, walker included).
    static func closing(_ track: Track, egoTowardMps: Double) -> (distance: Double, speed: Double, ttc: Double)? {
        let hM = track.heightM
        guard classHeightM[track.label] != nil, let rate = growthRate(track.samples),
              let ang = track.samples.last?.ang, ang > 0 else { return nil }
        let z = hM / (2 * tan(ang / 2))
        // The least-squares slope is the rate at the window's middle: pair it with the distance there.
        let meanLog = track.samples.map { log(max($0.ang, 1e-9)) }.reduce(0, +) / Double(track.samples.count)
        let zMid = hM / (2 * tan(exp(meanLog) / 2))
        let relative = zMid * rate
        guard relative > 0 else { return nil }
        return (z, relative - egoTowardMps, z / relative)
    }

    static func position(_ dir: SIMD3<Float>, ang: Double, heightM: Double, _ c: Camera) -> SIMD2<Float> {
        let z = Float(heightM / (2 * tan(max(ang, 1e-6) / 2)))
        let p = c.position + dir * z
        return SIMD2(p.x, p.z)
    }

    /// Vehicle alerts for the tracks seen at `time` (VehicleDetector at 5 Hz). A track triggers when its own speed
    /// toward the walker is >= vehicleMinClosingSpeedMps and TTC < ttcSeconds, with significant growth, confirmed
    /// standing by >= 0.6 s of samples in the current still-head window (look and hold; never while the head moves),
    /// walking by the long-look or sweep paths plus the world track. `passing` is set while the predicted miss distance says
    /// it goes by (keep those only at a curb). Ids are offset by 1_000_000 (depth ids stay below).
    mutating func assess(time: Double, walker: SIMD2<Float>, walkerVelocity: SIMD2<Float>, forward: SIMD2<Float>) -> [ClosingObject] {
        var out: [ClosingObject] = []
        let walking = isWalking || simd_length(walkerVelocity) > 0.3
        for i in tracks.indices where tracks[i].lastSeen == time && tracks[i].group == "vehicle" {
            // Standing: no alert unless the head is still now (look and hold).
            if !walking && stillSince == nil { continue }
            var tr = tracks[i]
            let flat = SIMD2(tr.direction.x, tr.direction.z)
            guard simd_length(flat) > 1e-3 else { continue }
            let ego = Double(simd_dot(walkerVelocity, simd_normalize(flat)))
            // After a roll step (> rollStepDeg from the last anchor), box heights changed with the roll: ONLY the
            // samples after the step count, for the closing rate, its significance and the pessimistic slope, and
            // they must be 5 over >= 0.8 s.
            if rollStepAt > (tr.samples.first?.t ?? rollStepAt) {
                tr.samples = tr.samples.filter { $0.t >= rollStepAt }
                guard tr.samples.count >= 5, let a = tr.samples.first?.t, let b = tr.samples.last?.t, b - a >= 0.8 else { continue }
            }
            guard let c = Self.closing(tr, egoTowardMps: ego),
                  Float(c.speed) >= Tuning.vehicleMinClosingSpeedMps, Float(c.ttc) < Tuning.ttcSeconds else { continue }
            let span = (tr.samples.last?.t ?? 0) - (tr.samples.first?.t ?? 0)
            guard Self.growthT(tr.samples) >= Self.minGrowthT else { continue } // growth not clearly above the noise
            if walking {
                // Walking: >= 5 samples over >= 1 s, or (a car seen once per head sweep) >= 3 samples over >= 1.5 s
                // whose angular height grew every time; the world-track and pessimistic-slope checks below apply.
                let grewEveryTime = zip(tr.samples, tr.samples.dropFirst()).allSatisfy { $1.ang > $0.ang }
                let sweepPath = tr.samples.count >= 3 && span >= 1.5 && grewEveryTime
                let longLook = tr.samples.count >= Self.walkingMinSamples && span >= Self.walkingMinSpan
                guard longLook || sweepPath else { continue }
            } else {
                // Standing: >= stillMinSeconds of still-head samples, all in the current still window (samples are
                // cleared when a window starts), whose growth passed the significance test above; a close car
                // growing fast needs only stillFastMinSeconds.
                let fast = span >= Self.stillFastMinSeconds - 1e-6 && Self.growthT(tr.samples) >= Self.fastMinGrowthT
                    && Float(c.distance) < Tuning.vehicleFastRangeM && fastGuards(tr, distance: c.distance, ego: ego, forward: forward)
                guard tr.samples.count >= 3, span >= Self.stillMinSeconds - 1e-6 || fast else { continue }
            }
            // Position: the last unclipped estimate, else (still entering from the side) direction x distance.
            let pos = tr.positions.last?.pos ?? walker + simd_normalize(flat) * Float(c.distance)
            let p = pos - walker
            var miss = Float(0)
            if let v = Self.velocity(tr.positions) {
                miss = ClosingDetector.miss(p, v - walkerVelocity)
                // While the walker moves, box growth mixes the walker's own approach with perspective (a parked
                // car's side comes into view): the world track must agree that the object itself approaches.
                let dist = simd_length(p)
                if walking, dist > 0.1, simd_dot(v, -p / dist) < Tuning.vehicleMinClosingSpeedMps { continue }
            } else if walking {
                continue // walking: no world track yet to confirm the growth
            }
            if walking, let (slope, se) = Self.growthSlope(tr.samples) { // nil under 3 samples
                // Walking: even the pessimistic growth (slope - 2.5 SE) must leave an approach of the object's own.
                // The slope is the window's middle rate: pair it with zMid as closing() does (the last sample's
                // distance under-reads a close, fast-growing car by 30-60%: a head-on car in a parking aisle).
                let meanLog = tr.samples.map { log(max($0.ang, 1e-9)) }.reduce(0, +) / Double(tr.samples.count)
                let z = tr.heightM / (2 * tan(exp(meanLog) / 2))
                if z * (slope - Self.pessimisticSE * se) - ego < Double(Tuning.vehicleMinClosingSpeedMps) { continue }
            }
            var decision = ClosingDetector.missDecision(miss: miss, ttc: Float(c.ttc), passCount: &tracks[i].passCount)
            // Head-on: the car's box spans the walker's heading within vehicleInPathRangeM. The miss from the box
            // centre drifts outward as a turning car's side comes into view (Tesla, 18-16-49Z f725-736: miss 1.8-3.3 m,
            // body 0.1-0.9 m off the path). The box span widened by vehicleInPathMarginM still covers the heading.
            // Such a car counts with or without a curb.
            let heading = simd_length(walkerVelocity) > 0.3 ? walkerVelocity : forward
            if decision != .alert, Self.inPath(tr.bearing, range: simd_length(p), heading: heading) { decision = .alert }
            out.append(ClosingObject(point: SIMD3(pos.x, 0.75, pos.y), range: simd_length(p), ahead: simd_dot(p, forward),
                                     lateral: simd_dot(p, SIMD2(-forward.y, forward.x)), speed: Float(c.speed),
                                     ttc: Float(c.ttc), missM: miss, label: Self.spokenLabel(tr.label),
                                     trackId: 1_000_000 + tr.id, passing: decision != .alert))
        }
        return out
    }

    /// The heading (world xz) lies inside the world azimuth span `bearing` widened by vehicleInPathMarginM at `range`,
    /// and range < vehicleInPathRangeM.
    static func inPath(_ bearing: CGRect, range: Float, heading: SIMD2<Float>,
                       marginM: Float = Tuning.vehicleInPathMarginM) -> Bool {
        guard range < Tuning.vehicleInPathRangeM, simd_length(heading) > 1e-3 else { return false }
        let h = unwrap(Double(atan2(heading.x, -heading.y)) * 180 / .pi, around: Double(bearing.midX))
        let margin = Double(atan2(marginM, max(range, 0.1))) * 180 / .pi
        return h >= Double(bearing.minX) - margin && h <= Double(bearing.maxX) + margin
    }

    /// Extra checks for the standing fast path (3 samples, 1 degree of freedom, so growth T alone is weak):
    /// - head pitch still (< HeadMotion.stillRollDegPerSec): look-and-hold tests yaw and roll only, and a nod grows
    ///   a box whose bottom the image edge cuts off (a parked car under ~2 m);
    /// - the pessimistic slope (slope - pessimisticSE x SE, at zMid) still leaves an own approach >= 1.5 m/s;
    /// - the box itself spans the look direction (inPath, no margin): a side-clipped car has no world position, hence
    ///   no miss, and a car in the near lane beside the walker must not pass as one crossing in front.
    func fastGuards(_ tr: Track, distance: Double, ego: Double, forward: SIMD2<Float>) -> Bool {
        guard head.pitchRate < HeadMotion.stillRollDegPerSec, let (slope, se) = Self.growthSlope(tr.samples),
              !tr.samples.isEmpty else { return false }
        let meanLog = tr.samples.map { log(max($0.ang, 1e-9)) }.reduce(0, +) / Double(tr.samples.count)
        let zMid = tr.heightM / (2 * tan(exp(meanLog) / 2))
        guard zMid * (slope - Self.pessimisticSE * se) - ego >= Double(Tuning.vehicleMinClosingSpeedMps) else { return false }
        return Self.inPath(tr.bearing, range: Float(distance), heading: forward, marginM: 0)
    }

    /// Least-squares world velocity over at least 3 positions spanning 0.4 s.
    static func velocity(_ s: [(t: Double, pos: SIMD2<Float>)]) -> SIMD2<Float>? {
        guard s.count >= 3, let t0 = s.first?.t, let t1 = s.last?.t, t1 - t0 >= 0.4 else { return nil }
        let n = Float(s.count), ts = s.map { Float($0.t - t0) }, mt = ts.reduce(0, +) / n
        let mp = s.map(\.pos).reduce(.zero, +) / n
        var sxx: Float = 0, sxp = SIMD2<Float>.zero
        for (i, e) in s.enumerated() { let d = ts[i] - mt; sxx += d * d; sxp += d * (e.pos - mp) }
        return sxx > 0 ? sxp / sxx : nil
    }
}

/// Head yaw and roll rates (deg/s) from the ARKit camera rotation, measured over >= window (0.2 s) of samples.
/// "Look and hold": the head counts as still under 12 deg/s yaw and 5 deg/s roll. Shared by BoxTracker (standing
/// box growth) and SensorSession (the "Hold still to check traffic." hint).
struct HeadMotion {
    static let window = 0.2
    static let stillYawDegPerSec = 12.0
    static let stillRollDegPerSec = 5.0
    private var history: [(t: Double, yaw: Double, roll: Double, pitch: Double)] = []
    private(set) var yawRate = 0.0
    private(set) var rollRate = 0.0
    /// Nod rate (deg/s). Not part of `still` (look-and-hold); BoxTracker's standing fast path requires it.
    private(set) var pitchRate = 0.0
    var still: Bool { yawRate < Self.stillYawDegPerSec && rollRate < Self.stillRollDegPerSec }

    mutating func update(time: Double, rotation: simd_float3x3) {
        let fwd = -rotation.columns.2
        let yaw = Double(atan2(fwd.x, -fwd.z)) * 180 / .pi, roll = BoxTracker.roll(rotation)
        let pitch = Double(atan2(fwd.y, (fwd.x * fwd.x + fwd.z * fwd.z).squareRoot())) * 180 / .pi
        history.removeAll { $0.t >= time }
        while history.count > 1, history[1].t <= time - Self.window { history.removeFirst() }
        if let ref = history.first {
            rollRate = abs(roll - ref.roll) / (time - ref.t)
            pitchRate = abs(pitch - ref.pitch) / (time - ref.t)
            yawRate = abs(BoxTracker.unwrap(yaw, around: ref.yaw) - ref.yaw) / (time - ref.t)
        } else {
            rollRate = 0; yawRate = 0; pitchRate = 0
        }
        history.append((time, yaw, roll, pitch))
    }
}
