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
        /// Consecutive frames that met the trigger (speed, TTC).
        var hits = 0
        /// Consecutive frames with miss >= closingMissM + margin (ClosingDetector.missDecision).
        var passCount = 0
        /// Physical height prior (m), frozen from the class of the first detection (label flips never rescale).
        var heightM: Double = 1.5
    }

    static let minIoU: CGFloat = 0.3
    /// Growth window: long enough to span two head sweeps (a car in view once a second).
    static let window: Double = 2.0
    /// Tracks survive head sweeps: up to this long unseen, re-matched by world bearing.
    static let dropAfter: Double = 1.2

    private(set) var tracks: [Track] = []
    private var nextId = 1
    /// Camera roll about the view axis relative to gravity (deg) at the previous update, for the roll rate.
    private var lastRoll: (t: Double, deg: Double)?
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
    /// Growth samples are skipped (and confirmations reset) while the head rolls faster than this (deg/s).
    static let maxRollRateDegPerSec = 15.0 // the per-frame un-roll does most of the work; gait roll stays under this

    /// Camera roll relative to gravity, degrees in (-90, 90]: the angle between the portrait image's vertical
    /// axis (sensor x) and world up projected into the image plane.
    static func roll(_ c: Camera) -> Double {
        let up = c.rotation.transpose * SIMD3<Float>(0, 1, 0) // world up in camera coordinates
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

    private static func unwrap(_ a: Double, around c: Double) -> Double {
        var d = a - c
        while d > 180 { d -= 360 }
        while d < -180 { d += 360 }
        return c + d
    }

    /// Greedy matching, best IoU first, same group only. Clipped boxes are ignored. Returns tracks seen now.
    mutating func update(_ boxes: [Box], time: Double, camera: Camera) -> [Track] {
        tracks.removeAll { time - $0.lastSeen > Self.dropAfter }
        let rollDeg = Self.roll(camera)
        var rolling = false
        if let last = lastRoll, time > last.t {
            rolling = abs(rollDeg - last.deg) / (time - last.t) > Self.maxRollRateDegPerSec
        }
        lastRoll = (time, rollDeg)
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
                let v = Self.iou(t.bearing, r)
                if v >= Self.minIoU { pairs.append((ti, oi, v)) }
            }
        }
        // Tracks with no IoU match (after a sweep gap, or cut by the side border) may still match by world
        // bearing: centre within half the box size plus 10 deg/s x the gap, and a plausible size change (0.7-2x).
        for (ti, t) in tracks.enumerated() where !pairs.contains(where: { $0.ti == ti }) {
            for (oi, o) in obs.enumerated() where Self.group(o.box.label) == t.group {
                let daz = abs(Self.unwrap(o.az, around: t.azimuth) - t.azimuth)
                let del = abs(Double(o.rect.midY - t.bearing.midY))
                let gate = 0.5 * Double(max(o.rect.width, o.rect.height, t.bearing.width, t.bearing.height)) + 10 * (time - t.lastSeen)
                let ratio = o.ang / max(t.samples.last?.ang ?? o.ang, 1e-9)
                if (daz * daz + del * del).squareRoot() < gate && ratio > 0.7 && ratio < 2 { pairs.append((ti, oi, 0.01)) }
            }
        }
        var usedT = Set<Int>(), usedO = Set<Int>(), seen: [Int] = []
        for p in pairs.sorted(by: { $0.iou > $1.iou }) where !usedT.contains(p.ti) && !usedO.contains(p.oi) {
            usedT.insert(p.ti); usedO.insert(p.oi)
            let o = obs[p.oi]
            tracks[p.ti].label = o.box.label
            tracks[p.ti].bearing = o.rect
            tracks[p.ti].azimuth = o.az
            tracks[p.ti].direction = o.center
            tracks[p.ti].lastSeen = time
            if !rolling { // while the head rolls, box heights are not trusted: no growth sample, no confirmation
                tracks[p.ti].samples.append((time, o.ang))
                if !o.sideClipped {
                    tracks[p.ti].positions.append((time, Self.position(o.center, ang: o.ang, heightM: tracks[p.ti].heightM, camera)))
                }
            } else {
                tracks[p.ti].hits = 0
            }
            tracks[p.ti].samples.removeAll { time - $0.t > Self.window }
            tracks[p.ti].positions.removeAll { time - $0.t > Self.window }
            seen.append(p.ti)
        }
        // "Consecutive" hits mean consecutive observed frames: any frame a track is not seen resets them.
        for i in tracks.indices where !usedT.contains(i) { tracks[i].hits = 0 }
        for (oi, o) in obs.enumerated() where !usedO.contains(oi) {
            let h = Self.classHeightM[o.box.label] ?? 1.5
            tracks.append(Track(id: nextId, label: o.box.label, group: Self.group(o.box.label), bearing: o.rect,
                                azimuth: o.az, direction: o.center, samples: rolling ? [] : [(time, o.ang)], lastSeen: time,
                                positions: o.sideClipped || rolling ? [] : [(time, Self.position(o.center, ang: o.ang, heightM: h, camera))],
                                heightM: h))
            nextId += 1
            seen.append(tracks.count - 1)
        }
        return seen.map { tracks[$0] }
    }

    mutating func reset() { tracks = []; lastRoll = nil; rollAnchor = nil; rollStepAt = -.infinity }

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
    /// toward the walker is >= vehicleMinClosingSpeedMps and TTC < ttcSeconds, confirmed by >= 5 samples over
    /// >= 0.8 s or by two consecutive triggering frames. `passing` is set while the predicted miss distance says
    /// it goes by (keep those only at a curb). Ids are offset by 1_000_000 (depth ids stay below).
    mutating func assess(time: Double, walker: SIMD2<Float>, walkerVelocity: SIMD2<Float>, forward: SIMD2<Float>) -> [ClosingObject] {
        var out: [ClosingObject] = []
        for i in tracks.indices where tracks[i].lastSeen == time && tracks[i].group == "vehicle" {
            let tr = tracks[i]
            let flat = SIMD2(tr.direction.x, tr.direction.z)
            guard simd_length(flat) > 1e-3 else { continue }
            let ego = Double(simd_dot(walkerVelocity, simd_normalize(flat)))
            guard let c = Self.closing(tr, egoTowardMps: ego),
                  Float(c.speed) >= Tuning.vehicleMinClosingSpeedMps, Float(c.ttc) < Tuning.ttcSeconds else {
                tracks[i].hits = 0
                continue
            }
            tracks[i].hits += 1
            let span = (tr.samples.last?.t ?? 0) - (tr.samples.first?.t ?? 0)
            // Confirmed by >= 5 samples over >= 0.8 s, two consecutive triggering frames, or (a car seen once per
            // head sweep) >= 3 samples over >= 1.5 s whose angular height grew every time.
            // After a roll step (> 5 deg from the last anchor), box heights changed with the roll: require fresh
            // growth, 5 samples over >= 0.8 s, all taken after the step.
            let afterStep = tr.samples.filter { $0.t >= rollStepAt }
            if rollStepAt > (tr.samples.first?.t ?? rollStepAt) {
                guard afterStep.count >= 5, let a = afterStep.first?.t, let b = afterStep.last?.t, b - a >= 0.8 else { continue }
            }
            guard Self.growthT(tr.samples) >= Self.minGrowthT else { continue } // growth not clearly above the noise
            let grewEveryTime = zip(tr.samples, tr.samples.dropFirst()).allSatisfy { $1.ang > $0.ang }
            let walking = simd_length(walkerVelocity) > 0.3
            // Walking: the walker's own approach makes every parked car grow, so the quick confirmations (two hits,
            // or a few sweep samples) are off; the growth needs a longer look.
            if walking && (tr.samples.count < Self.walkingMinSamples || span < Self.walkingMinSpan) { continue }
            guard (tr.samples.count >= 5 && span >= 0.8) || tracks[i].hits >= 2
                    || (tr.samples.count >= 3 && span >= 1.5 && grewEveryTime) else { continue }
            // Position: the last unclipped estimate, else (still entering from the side) direction x distance.
            let pos = tr.positions.last?.pos ?? walker + simd_normalize(flat) * Float(c.distance)
            let p = pos - walker
            var miss = Float(0)
            if let v = Self.velocity(tr.positions) {
                miss = ClosingDetector.miss(p, v - walkerVelocity)
                // While the walker moves, box growth mixes the walker's own approach with perspective (a parked
                // car's side comes into view): the world track must agree that the object itself approaches.
                let dist = simd_length(p)
                if simd_length(walkerVelocity) > 0.3, dist > 0.1,
                   simd_dot(v, -p / dist) < Tuning.vehicleMinClosingSpeedMps { continue }
            } else if simd_length(walkerVelocity) > 0.3 {
                continue // walking: no world track yet to confirm the growth
            }
            if simd_length(walkerVelocity) > 0.3, let (slope, se) = Self.growthSlope(tr.samples), let ang = tr.samples.last?.ang {
                // Walking: even the pessimistic growth (slope - 2 SE) must leave an approach of the object's own.
                let z = tr.heightM / (2 * tan(ang / 2))
                if z * (slope - Self.pessimisticSE * se) - ego < Double(Tuning.vehicleMinClosingSpeedMps) { continue }
            }
            let decision = ClosingDetector.missDecision(miss: miss, ttc: Float(c.ttc), passCount: &tracks[i].passCount)
            out.append(ClosingObject(point: SIMD3(pos.x, 0.75, pos.y), range: simd_length(p), ahead: simd_dot(p, forward),
                                     lateral: simd_dot(p, SIMD2(-forward.y, forward.x)), speed: Float(c.speed),
                                     ttc: Float(c.ttc), missM: miss, label: Self.spokenLabel(tr.label),
                                     trackId: 1_000_000 + tr.id, passing: decision != .alert))
        }
        return out
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
