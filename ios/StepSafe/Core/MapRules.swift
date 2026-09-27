import CoreGraphics
import CryptoKit
import Foundation
import simd

// Pure rules for naming, heads-up, passive votes and spoken server audio. No ARKit, no networking.

enum MapTuning {
    /// Skip POST /hazards when an active pin with the same heightBand is this close (the server's merge radius).
    static let knownPinRadiusM = 10.0
    static let pollSeconds: Double = 10
    static let pollRadiusM = 60.0
    /// Map pins are all fixed objects (the "moving" category means movable, like a bin or parked car). Live cars
    /// come from crossing assist, not heads-up, so this range never delays a closing-vehicle alert. 12 m = 39 ft:
    /// a few steps' warning without naming things 100 ft away (Ara, device test 2026-09-26).
    static let headsUpRadiusM = 12.0
    /// A pin is "ahead" when its bearing is within this of the walking direction.
    static let headsUpConeDeg = 40.0
    /// Within this of straight ahead the side is spoken as "ahead".
    static let headsUpAheadDeg = 10.0
    static let headsUpRepeatSeconds: Double = 5 * 60
    // Passive downvote (PassiveVoter)
    static let passiveApproachStartM = 8.0
    /// An approach must be first seen at least this far out (1 s ticks at walking speed skip ~1.5 m).
    static let passiveApproachStartMinM = 6.5
    static let passiveApproachResetM = 10.0
    static let passiveVoteEndM = 2.0
    static let passiveLateralSlackM = 0.3
    static let passiveMaxAccuracyM = 5.0
    static let passiveMaxFixAgeS = 3.0
    static let passiveSightingSeconds: Double = 60
    static let passiveSeenRadiusM = 10.0
    static let passiveMaxOutputAgeS = 0.3
    static let passiveMinSamples = 4
    static let passiveMinApproachSeconds: Double = 2
    static let passiveMaxJumpM = 2.0
    /// GPS jitter allowed before a distance sample counts as moving away (non-monotonic).
    static let passiveMonotonicSlackM = 0.05
    // Reports
    /// Only a still hazard is reported: its world point stays within stillRadiusM (horizontal) of where it
    /// settled for stillSeconds of fresh frames. A walking person (1.2 m/s) leaves 0.75 m in 0.63 s.
    /// Same radius as a report identity: the nearest point of a real obstacle jumps over 0.3 m between frames.
    static let stillRadiusM = Tuning.sameHazardRadius
    static let stillSeconds: Double = 1.0
    static let reportRetries = 2
    static let reportCooldownSeconds: Double = 60
    /// Privacy: the final crop is at most this share of the image width and of its height.
    static let cropMaxShare: CGFloat = 0.45
    static let scoutRadiusM = 200.0
    /// Crop padding on every side, as a share of the box's width/height.
    static let cropPadding: CGFloat = 0.2
    static let cropLongSide: CGFloat = 320
    static let cropJPEGQuality: CGFloat = 0.7
    /// Scout tap crop: a square this share of the image's short side.
    static let scoutCropShare: CGFloat = 0.35
}

/// A row of GET /hazards/near. Optional fields tolerate older servers.
struct NearHazard: Codable, Identifiable, Equatable {
    var id: String
    var type: String
    var category: String
    var lat: Double
    var lng: Double
    var heightBand: String
    var confidence: Double
    var status: String?
    var label: String?
    var sample: Bool?
    var distanceM: Double?
    /// ISO 8601; nil from older servers.
    var lastSeen: String?

    var fix: Geo.Fix { Geo.Fix(lat: lat, lng: lng) }
    var isActive: Bool { (status ?? "active") == "active" }
    var spokenName: String { Spoken.capitalized(label ?? type) }
    /// False while the pin still has the server's generic label (the renamer has not named it yet).
    var isNamed: Bool { !Spoken.isGeneric(label ?? type) }
}

/// GET /hazards/:id (server/src/app.ts): the summary plus measurements, photo, votes and pending reclassifications.
struct HazardDetail: Decodable, Equatable {
    struct Measurements: Decodable, Equatable { var clearanceM: Double?; var widthM: Double? }

    var id: String
    var type: String
    var category: String
    var lat: Double
    var lng: Double
    var heightBand: String
    var confidence: Double
    var lastSeen: String
    var status: String
    var label: String?
    var sample: Bool?
    var measurements: Measurements?
    /// Base64 JPEG; nil or empty when the pin has no photo (samples).
    var crop: String?
    var spokenLabel_es: String?
    var severity: Double
    var createdAt: String
    var expiresAt: String
    var votes: [HazardVote]
    var pendingReclassifications: [PendingReclass]

    var fix: Geo.Fix { Geo.Fix(lat: lat, lng: lng) }
    var ups: Int { votes.filter { $0.vote == "up" }.count }
    var downs: Int { votes.filter { $0.vote == "down" }.count }
}

struct HazardVote: Decodable, Equatable {
    var deviceId: String
    var vote: String
    var source: String
    var weight: Double
    var at: String
}

struct PendingReclass: Decodable, Equatable {
    var type: String?
    var category: String?
    var heightBand: String?
    var count: Int
}

/// GET /users/:deviceId.
struct UserInfo: Decodable, Equatable {
    var displayName: String
    var karma: Double
}

/// Community tab rules: 1-mile radius and vote gate, imperial distances, clock/compass bearings, SSE lines.
enum Community {
    /// Nearby radius and in-person vote gate: 1 mile (Ara 2026-09-26, demo setting).
    static let radiusM = 1609.0
    static let pollSeconds: Double = 15
    /// A fix counts for voting only when it is this accurate and this fresh.
    static let voteMaxAccuracyM = 100.0
    static let voteMaxFixAgeS = 30.0
    /// Refetch the nearby list after moving this far from where it was last fetched.
    static let refetchMovedM = 200.0
    /// An SSE hazard new to the list is announced only if seen this recently (not an old pin coming into range).
    static let announceMaxAgeS = 120.0

    /// The fix is good enough to vote with: accuracy <= 100 m, at most 30 s old.
    static func fixUsable(accuracyM: Double, ageS: Double) -> Bool {
        accuracyM >= 0 && accuracyM <= voteMaxAccuracyM && ageS <= voteMaxFixAgeS
    }

    /// Votes only in person: a usable GPS fix within 1 mile of the pin.
    static func canVote(from fix: Geo.Fix?, accuracyM: Double, ageS: Double, to pin: Geo.Fix) -> Bool {
        guard let fix, fixUsable(accuracyM: accuracyM, ageS: ageS) else { return false }
        return canVote(distanceM: Geo.distance(fix, pin))
    }
    static func canVote(distanceM: Double) -> Bool { distanceM <= radiusM }

    /// Imperial only: feet under 0.1 mile (to the foot under 50 ft, so clearances stay exact; else to 5 ft),
    /// else "0.3 miles" (one decimal).
    static func distance(_ m: Double, lang: String = "en") -> String {
        let miles = m / 1609.344
        if miles < 0.1 {
            let ft = m * 3.28084
            let feet = ft < 50 ? max(1, Int(ft.rounded())) : Int((ft / 5).rounded()) * 5
            return "\(feet) " + (lang == "es" ? (feet == 1 ? "pie" : "pies") : (feet == 1 ? "foot" : "feet"))
        }
        let s = String(format: "%.1f", miles)
        return "\(s) \(lang == "es" ? (s == "1.0" ? "milla" : "millas") : (s == "1.0" ? "mile" : "miles"))"
    }

    /// Clock hour 1...12 of `bearing` relative to `heading` (12 = straight ahead, 3 = right).
    static func clock(bearing: Double, heading: Double) -> Int {
        let h = Int((Geo.normalize(bearing - heading) / 30).rounded()) % 12
        return h == 0 ? 12 : h
    }

    /// "2 o'clock" with a heading, else the compass point ("northeast").
    static func direction(bearing: Double, heading: Double?, lang: String = "en") -> String {
        if let heading {
            let h = clock(bearing: bearing, heading: heading)
            return lang == "es" ? "a las \(h)" : "\(h) o'clock"
        }
        let en = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
        let es = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"]
        let i = Int((Geo.normalize(bearing) / 45).rounded()) % 8
        return lang == "es" ? es[i] : en[i]
    }

    /// Server confidence is a vote score (below -2 the pin is removed), not a percentage: "3", "1.5".
    static func confidence(_ c: Double) -> String {
        c == c.rounded() ? String(Int(c)) : String(format: "%.1f", c)
    }

    /// One VoiceOver line per row: "Sample. Low branch, 40 feet, 2 o'clock, confidence 3".
    static func rowLabel(name: String, sample: Bool, confidence c: Double, walker: Geo.Fix?, pin: Geo.Fix,
                         distanceM: Double?, heading: Double?, lang: String = "en") -> String {
        var parts = [name]
        if let d = walker.map({ Geo.distance($0, pin) }) ?? distanceM { parts.append(distance(d, lang: lang)) }
        if let walker { parts.append(direction(bearing: Geo.bearing(from: walker, to: pin), heading: heading, lang: lang)) }
        parts.append((lang == "es" ? "confianza " : "confidence ") + confidence(c))
        return (sample ? (lang == "es" ? "Muestra. " : "Sample. ") : "") + parts.joined(separator: ", ")
    }

    /// Announce a hazard that just appeared in the list only when it was seen in the last 2 minutes.
    static func isFresh(lastSeen: String?, now: Date = Date()) -> Bool {
        guard let seen = lastSeen.flatMap(date) else { return false }
        return now.timeIntervalSince(seen) <= announceMaxAgeS
    }

    static func date(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    /// A GET /events message, or `.open` once the stream answered 200.
    enum Event: Equatable { case open, upsert(NearHazard), remove(String) }

    /// Line-by-line SSE reader for `event: hazard` messages. Dispatches on the data line itself, because
    /// URLSession's AsyncLineSequence drops the blank line that ends an SSE message.
    /// ponytail: one data line per message (the server never splits them); join lines if that changes.
    struct SSEParser {
        private var event = ""

        mutating func feed(_ line: String) -> Event? {
            if line.isEmpty { event = ""; return nil }
            if line.hasPrefix(":") { return nil } // comment / ping
            let (field, value) = Self.split(line)
            switch field {
            case "event": event = value; return nil
            case "data":
                defer { event = "" }
                guard event == "hazard" || event.isEmpty, let data = value.data(using: .utf8) else { return nil }
                return Self.decode(data)
            default: return nil // id, retry
            }
        }

        private static func split(_ line: String) -> (String, String) {
            guard let i = line.firstIndex(of: ":") else { return (line, "") }
            var v = line[line.index(after: i)...]
            if v.first == " " { v = v.dropFirst() }
            return (String(line[..<i]), String(v))
        }

        private struct Wire: Decodable { var op: String; var hazard: NearHazard?; var id: String? }

        private static func decode(_ data: Data) -> Event? {
            guard let w = try? JSONDecoder().decode(Wire.self, from: data) else { return nil }
            switch (w.op, w.hazard, w.id) {
            case ("upsert", let h?, _): return .upsert(h)
            case ("remove", _, let id?): return .remove(id)
            default: return nil
            }
        }
    }
}

/// A row of GET /taxonomy: the only hazard types the server accepts (reclassify sends the id).
struct HazardTypeEntry: Codable, Identifiable, Equatable {
    var id: String
    var en: String
    var es: String
    var category: String
    var defaultHeightBand: String

    func name(lang: String) -> String { lang == "es" ? es : en }
}

enum Taxonomy {
    /// Display name of a pin: the taxonomy name of its type when known (Spanish when lang is "es"), else its
    /// spoken label, else the raw type with dashes as spaces (legacy free-text types, or no taxonomy yet).
    static func displayName(type: String, label: String?, in entries: [HazardTypeEntry]?, lang: String) -> String {
        if let e = entries?.first(where: { $0.id == type }) { return Spoken.capitalized(e.name(lang: lang)) }
        return Spoken.capitalized(label ?? type.replacingOccurrences(of: "-", with: " "))
    }

    /// English server label -> the taxonomy's Spanish name, when one entry's English name matches.
    /// Unknown labels, and English phones, come back unchanged.
    static func localize(_ label: String, lang: String, in entries: [HazardTypeEntry]?) -> String {
        guard lang == "es", let e = entries?.first(where: {
            $0.en.compare(label, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
        }) else { return label }
        return e.es
    }

    /// Entries whose shown name (or id) contains `query`, ignoring case and accents; all for an empty query.
    static func search(_ entries: [HazardTypeEntry], _ query: String, lang: String) -> [HazardTypeEntry] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return entries }
        return entries.filter {
            $0.name(lang: lang).range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
                || $0.id.range(of: q, options: .caseInsensitive) != nil
        }
    }
}

extension HazardKind {
    /// Server heightBand.
    var band: String {
        switch self {
        case .ground: return "ground"
        case .headHeight: return "head"
        case .dropOff: return "dropoff"
        case .closing: return "ground" // never sent: ServerLink passes only map hazards on
        }
    }
}

/// Report each confirmed hazard once. Identity is AlertPolicy's: same kind within Tuning.sameHazardRadius
/// of the point where it was FIRST reported (never updated). Cleared on AR reset.
/// An identity is in flight while its POST (and up to 2 retries) runs, reported after success, and given up
/// for MapTuning.reportCooldownSeconds after the retries fail (then a new confirmation may try again).
struct ReportGate {
    enum State: Equatable { case inFlight, reported, gaveUp(until: Double) }
    private var entries: [(kind: HazardKind, point: SIMD3<Float>, state: State)] = []

    private func index(_ d: Detection) -> Int? {
        entries.firstIndex { $0.kind == d.kind && simd_distance($0.point, d.point) <= Tuning.sameHazardRadius }
    }

    func state(_ d: Detection) -> State? { index(d).map { entries[$0].state } }

    func isNew(_ d: Detection, now: Double) -> Bool {
        guard let i = index(d) else { return true }
        if case let .gaveUp(until) = entries[i].state { return now >= until }
        return false
    }

    /// A POST for this identity starts.
    mutating func mark(_ d: Detection) {
        if let i = index(d) { entries[i].state = .inFlight } else { entries.append((d.kind, d.point, .inFlight)) }
    }

    /// Drop the identity entirely (report abandoned, not failed).
    mutating func forget(_ d: Detection) { if let i = index(d) { entries.remove(at: i) } }

    mutating func succeeded(_ d: Detection) { if let i = index(d) { entries[i].state = .reported } }
    mutating func failed(_ d: Detection, now: Double) {
        if let i = index(d) { entries[i].state = .gaveUp(until: now + MapTuning.reportCooldownSeconds) }
    }
    mutating func reset() { entries = [] }

    /// Seconds to wait before retry number `failures` (1-based), or nil to stop. Only transport errors
    /// (status nil), 429 and 5xx are retried, at most twice: 2 s, then 4 s.
    static func retryDelay(failures: Int, status: Int?) -> Double? {
        let retryable = status == nil || status == 429 || (500...599).contains(status!)
        return retryable && failures <= MapTuning.reportRetries ? pow(2, Double(failures)) : nil
    }

    /// An active, non-sample pin the server would merge this report into anyway.
    static func knownPin(band: String, at fix: Geo.Fix, in pins: [NearHazard]) -> NearHazard? {
        pins.filter { $0.isActive && $0.sample != true && $0.heightBand == band
            && Geo.distance($0.fix, fix) <= MapTuning.knownPinRadiusM }
            .min { Geo.distance($0.fix, fix) < Geo.distance($1.fix, fix) }
    }

    enum Next: Equatable { case known(NearHazard), post, wait }

    /// HazardNamer's choice for a new confirmed hazard at `fix`: the map already has it (speak its name), POST it,
    /// or wait because it has not stood still long enough (moving things are never POSTed).
    static func next(_ d: Detection, fix: Geo.Fix, pins: [NearHazard], still: Set<HazardKind>) -> Next {
        if let pin = knownPin(band: d.kind.band, at: fix, in: pins) { return .known(pin) }
        return still.contains(d.kind) ? .post : .wait
    }

    /// The server answered. Not pinned (a person or dog, empty id) is not "reported": only the cooldown, so a real
    /// hazard at that spot can still be reported later, and a person standing there is not re-sent every frame.
    mutating func answered(_ d: Detection, pinned: Bool, now: Double) {
        if pinned { succeeded(d) } else { failed(d, now: now) }
    }
}

/// Moving things are not map pins (Ara 2026-09-26: "make sure people and vehicles that are moving do not get
/// added to the database"). One anchor per kind: the point where the confirmed detection settled and the frame
/// time it settled at. Moving past stillRadiusM re-anchors, and a kind that stops being confirmed drops its
/// anchor, so a passer-by leaves no trail of half-still identities. Times are Detection.seenAt: a point
/// HazardTracker holds through a dropout (repeated seenAt) never counts, and the first fresh frame after one
/// re-anchors, so a dropout cannot bridge the time from a moving point to a still one.
struct StillnessGate {
    private struct Anchor { var point: SIMD3<Float>; var since: Double; var last: Double; var stale = false }
    private var anchors: [HazardKind: Anchor] = [:]

    /// Feed every analysis output's confirmed map hazards; returns the kinds that have stayed put long enough.
    mutating func update(_ confirmed: [HazardKind: Detection]) -> Set<HazardKind> {
        anchors = anchors.filter { confirmed[$0.key] != nil }
        var still: Set<HazardKind> = []
        for (kind, d) in confirmed {
            guard var a = anchors[kind] else {
                anchors[kind] = Anchor(point: d.point, since: d.seenAt, last: d.seenAt)
                continue
            }
            if d.seenAt <= a.last { // held through a dropout
                anchors[kind]?.stale = true
                continue
            }
            let moved = simd_distance(SIMD2(a.point.x, a.point.z), SIMD2(d.point.x, d.point.z)) > MapTuning.stillRadiusM
            if moved || a.stale {
                anchors[kind] = Anchor(point: d.point, since: d.seenAt, last: d.seenAt)
                continue
            }
            a.last = d.seenAt
            anchors[kind] = a
            if d.seenAt - a.since >= MapTuning.stillSeconds { still.insert(kind) }
        }
        return still
    }

    mutating func reset() { anchors = [:] }
}

/// Heads-up announcements (priority 4), once per pin per 5 minutes.
struct HeadsUpState {
    struct Due: Equatable {
        var pin: NearHazard
        var distanceM: Double
        var relativeDeg: Double
    }

    private(set) var announced: [String: Double] = [:]

    /// Pins within headsUpRadiusM and inside the cone, nearest first (no repeat filter).
    static func ahead(_ pins: [NearHazard], walker: Geo.Fix, heading: Double) -> [Due] {
        pins.filter(\.isActive).compactMap { pin in
            let dist = Geo.distance(walker, pin.fix)
            let rel = Geo.relative(Geo.bearing(from: walker, to: pin.fix), to: heading)
            guard dist <= MapTuning.headsUpRadiusM, abs(rel) <= MapTuning.headsUpConeDeg else { return nil }
            return Due(pin: pin, distanceM: dist, relativeDeg: rel)
        }
        .sorted { $0.distanceM < $1.distanceM }
    }

    /// The nearest pin ahead not announced in the last 5 minutes; marks it announced.
    mutating func next(_ pins: [NearHazard], walker: Geo.Fix, heading: Double, now: Double) -> Due? {
        guard let due = Self.ahead(pins, walker: walker, heading: heading).first(where: {
            announced[$0.pin.id].map { now - $0 >= MapTuning.headsUpRepeatSeconds } ?? true
        }) else { return nil }
        announced[due.pin.id] = now
        return due
    }

    /// The pin was selected but never played (muted, audio down, or the queue expired).
    /// What's-ahead does not release the claim. It can be said on a later tick instead of staying silent for five minutes.
    mutating func release(_ id: String) { announced[id] = nil }

    mutating func reset() { announced = [:] }
}

/// Passive walker downvotes (PLAN.md section 4): a pin the walker walked right up to while path guard watched
/// the whole way, and path guard never saw anything of that band near it. ON by default
/// (Tuning.passiveDownvotesEnabled); the server weighs it a fixed 0.6, so one false miss never erases a pin alone.
/// All of these must hold:
/// - at EVERY approach step: GPS accuracy <= 5 m, fix under 3 s old, a live path-guard output under 0.3 s old,
///   floor from the ARKit plane under the walker; one bad step spoils the approach (until 10 m away again);
/// - the approach starts 6.5-8 m out and has >= 4 monotonically decreasing distance samples over >= 2 s,
///   no jump over 2 m between samples;
/// - now within 2 m, ahead, sideways offset dist * sin(rel) within lane half-width + 0.3 m;
/// - no confirmed detection of the pin's band within 10 m of it in the last 60 s (sightings ring; also covers
///   pins that arrive after the detection);
/// - not a sample, not a pin this device reported or merged into, not already voted.
struct PassiveVoter {
    struct Sighting: Equatable { var time: Double; var band: String; var fix: Geo.Fix }

    struct Step {
        var walker: Geo.Fix
        var heading: Double
        var accuracyM: Double
        var fixAgeS: Double
        /// Seconds since the last live path-guard output (nil = none yet).
        var outputAgeS: Double?
        /// Floor came from the ARKit plane under the walker (FloorSource.planeUnder).
        var floorUnder: Bool
        var now: Double

        var healthy: Bool {
            accuracyM <= MapTuning.passiveMaxAccuracyM && fixAgeS < MapTuning.passiveMaxFixAgeS
                && (outputAgeS.map { $0 <= MapTuning.passiveMaxOutputAgeS } ?? false) && floorUnder
        }
    }

    private struct Approach {
        var spoiled: Bool
        var samples: [(t: Double, d: Double)] = []
    }

    var enabled = Tuning.passiveDownvotesEnabled
    /// Ring of confirmed detections: at most one per band per second, kept 60 s (so at most ~180 rows).
    private(set) var sightings: [Sighting] = []
    private var approaches: [String: Approach] = [:]
    private(set) var voted: Set<String> = []
    /// Pins this device reported or merged into (walker or Scout).
    var own: Set<String> = []

    mutating func noteConfirmed(bands: Set<String>, walker: Geo.Fix, now: Double) {
        sightings.removeAll { now - $0.time > MapTuning.passiveSightingSeconds }
        for band in bands where !sightings.contains(where: { $0.band == band && now - $0.time < 1 }) {
            sightings.append(Sighting(time: now, band: band, fix: walker))
        }
    }

    /// One evaluation step (MapSync ticks every second). Returns the pins to downvote now and marks them voted.
    mutating func step(_ pins: [NearHazard], _ s: Step) -> [NearHazard] {
        guard enabled else { return [] }
        var out: [NearHazard] = []
        for pin in pins where pin.isActive && pin.sample != true && !own.contains(pin.id) && !voted.contains(pin.id) {
            let dist = Geo.distance(s.walker, pin.fix)
            if dist > MapTuning.passiveApproachResetM { approaches[pin.id] = nil; continue }
            guard dist <= MapTuning.passiveApproachStartM else { continue }
            var a = approaches[pin.id] ?? Approach(spoiled: dist < MapTuning.passiveApproachStartMinM)
            if !s.healthy { a.spoiled = true }
            if let last = a.samples.last,
               dist > last.d + MapTuning.passiveMonotonicSlackM || abs(dist - last.d) > MapTuning.passiveMaxJumpM {
                a.spoiled = true
            }
            a.samples.append((s.now, dist))
            approaches[pin.id] = a
            guard dist <= MapTuning.passiveVoteEndM, !a.spoiled, a.samples.count >= MapTuning.passiveMinSamples,
                  let first = a.samples.first, s.now - first.t >= MapTuning.passiveMinApproachSeconds else { continue }
            let rel = Geo.relative(Geo.bearing(from: s.walker, to: pin.fix), to: s.heading) * .pi / 180
            guard cos(rel) > 0, abs(dist * sin(rel)) <= Double(Tuning.laneHalfWidthM) + MapTuning.passiveLateralSlackM
            else { continue }
            let seen = sightings.contains {
                $0.band == pin.heightBand && s.now - $0.time <= MapTuning.passiveSightingSeconds
                    && Geo.distance($0.fix, pin.fix) <= MapTuning.passiveSeenRadiusM
            }
            if !seen { out.append(pin) }
        }
        voted.formUnion(out.map(\.id))
        return out
    }

    mutating func reset() { sightings = []; approaches = [:]; voted = [] }
}

enum Spoken {
    static func capitalized(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    /// The server's labels for a pin not named yet (a new report is always one; the renamer names it seconds later).
    /// Path guard already said as much, so the phone does not repeat it.
    static func isGeneric(_ label: String) -> Bool {
        ["obstacle", "obstacle at head height", "drop-off", "unknown obstacle"].contains(label.lowercased())
    }

    /// "Trash bin, 6 feet, left": the label in place of AlertPolicy's name; distance and side stay AlertPolicy's.
    /// Spanish uses the same side words as the bundled clips (pies, izquierda, derecha, al frente).
    static func named(_ label: String, _ d: Detection, lang: String = "en") -> String {
        let phrase = AlertPolicy.phrase(d)
        let rest = phrase.firstIndex(of: ",").map { String(phrase[$0...]) } ?? ""
        return capitalized(label) + (lang == "es" ? spanishTail(rest) : rest)
    }

    /// "Scaffolding, 40 feet, right" (PLAN.md section 7, priority 4). Feet rounded to 5.
    /// `taxonomy` + `lang` turn the pin's type id into the phone's language; nil taxonomy keeps the label.
    static func headsUp(_ due: HeadsUpState.Due, lang: String = "en", taxonomy: [HazardTypeEntry]? = nil) -> String {
        // English keeps the pin's own label. Spanish uses the taxonomy name when the type id is known.
        let name = lang == "es"
            ? Taxonomy.displayName(type: due.pin.type, label: due.pin.label, in: taxonomy, lang: "es")
            : due.pin.spokenName
        let feet = max(5, Int((due.distanceM * 3.28084 / 5).rounded()) * 5)
        if lang == "es" {
            let side = abs(due.relativeDeg) <= MapTuning.headsUpAheadDeg ? "al frente" : due.relativeDeg < 0 ? "izquierda" : "derecha"
            return "\(name), \(feet) pies, \(side)"
        }
        let side = abs(due.relativeDeg) <= MapTuning.headsUpAheadDeg ? "ahead" : due.relativeDeg < 0 ? "left" : "right"
        return "\(name), \(feet) feet, \(side)"
    }

    /// ", 9 feet, right" -> ", 9 pies, derecha". Only the distance tail, not the hazard name.
    private static func spanishTail(_ english: String) -> String {
        english
            .replacingOccurrences(of: " feet", with: " pies")
            .replacingOccurrences(of: ", left", with: ", izquierda")
            .replacingOccurrences(of: ", right", with: ", derecha")
            .replacingOccurrences(of: ", ahead", with: ", al frente")
    }
}

/// Crop geometry in image pixels (origin top-left).
enum CropMath {
    /// Bounding box of the projected points, padded by MapTuning.cropPadding of its size on every side, then
    /// capped at MapTuning.cropMaxShare of each image dimension around `center` (the projected hazard point),
    /// then clamped to the image. The cap comes after padding so the crop sent never exceeds 45% (privacy).
    /// nil if nothing of it is on the image.
    static func box(_ points: [CGPoint], center: CGPoint, imageSize: CGSize,
                    padding: CGFloat = MapTuning.cropPadding) -> CGRect? {
        guard let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
              let minY = points.map(\.y).min(), let maxY = points.map(\.y).max() else { return nil }
        let w = maxX - minX, h = maxY - minY
        var r = CGRect(x: minX - w * padding, y: minY - h * padding, width: w * (1 + 2 * padding), height: h * (1 + 2 * padding))
        let capW = imageSize.width * MapTuning.cropMaxShare, capH = imageSize.height * MapTuning.cropMaxShare
        if r.width > capW {
            let x = min(max(center.x - capW / 2, r.minX), r.maxX - capW)
            r = CGRect(x: x, y: r.minY, width: capW, height: r.height)
        }
        if r.height > capH {
            let y = min(max(center.y - capH / 2, r.minY), r.maxY - capH)
            r = CGRect(x: r.minX, y: y, width: r.width, height: capH)
        }
        let clamped = r.intersection(CGRect(origin: .zero, size: imageSize))
        guard !clamped.isNull else { return nil }
        // Round inward so rounding never pushes the crop past the cap.
        let out = CGRect(x: clamped.minX.rounded(.up), y: clamped.minY.rounded(.up),
                         width: (clamped.maxX.rounded(.down) - clamped.minX.rounded(.up)),
                         height: (clamped.maxY.rounded(.down) - clamped.minY.rounded(.up)))
        return out.width < 8 || out.height < 8 ? nil : out
    }

    /// A square of `share` of the image's short side centred on `point`, shifted to stay on the image.
    static func around(_ point: CGPoint, imageSize: CGSize, share: CGFloat = MapTuning.scoutCropShare) -> CGRect {
        let side = (min(imageSize.width, imageSize.height) * share).rounded()
        let x = min(max(0, point.x - side / 2), imageSize.width - side)
        let y = min(max(0, point.y - side / 2), imageSize.height - side)
        return CGRect(x: x.rounded(), y: y.rounded(), width: side, height: side)
    }

    /// Scale factor that makes the long side `longSide` pixels.
    static func scale(for size: CGSize, longSide: CGFloat = MapTuning.cropLongSide) -> CGFloat {
        longSide / max(size.width, size.height, 1)
    }
}

/// World-space box around a hazard's nearest point, to project into the camera image.
enum HazardBox {
    /// ponytail: Detection carries only the nearest point, so the box is a fixed per-band extent around it
    /// (lateral, up/down, 0.6 m deep). Carry the band's min/max points from PathGuard if crops come out loose.
    static func corners(_ d: Detection, cameraTransform t: simd_float4x4) -> [SIMD3<Float>] {
        let look = -SIMD3(t.columns.2.x, 0, t.columns.2.z)
        let fwd = simd_length(look) > 1e-3 ? simd_normalize(look) : SIMD3(0, 0, -1)
        let right = SIMD3(-fwd.z, 0, fwd.x)
        let (half, down, up): (Float, Float, Float) = {
            switch d.kind {
            case .ground, .closing: return (0.4, 0.6, 0.4) // closing objects are never cropped
            case .headHeight: return (0.4, 0.3, 0.4)
            case .dropOff: return (0.6, 0.3, 0.1)
            }
        }()
        var out: [SIMD3<Float>] = []
        for s in [-half, half] {
            for v in [-down, up] {
                for a in [Float(0), 0.6] { out.append(d.point + right * s + SIMD3(0, v, 0) + fwd * a) }
            }
        }
        return out
    }

    /// True if the world point is in front of the camera (ARKit's projectPoint is meaningless behind it).
    static func inFront(_ p: SIMD3<Float>, cameraTransform t: simd_float4x4) -> Bool {
        let local = t.inverse * SIMD4(p, 1)
        return local.z < -0.05
    }
}

/// Server-voiced audio (GET /tts) with AVSpeechSynthesizer fallback.
enum TTSChoice {
    /// After this long without audio, speak with AVSpeechSynthesizer instead.
    static let timeout: Double = 3

    /// "es" when the phone's first language is Spanish, else "en".
    static func lang(_ preferred: [String] = Locale.preferredLanguages) -> String {
        preferred.first?.lowercased().hasPrefix("es") == true ? "es" : "en"
    }

    /// Play the server clip only for a 200 audio response that arrived in time. Anything else (404 before the
    /// route ships, 503 no key, 502 upstream, 429, network error, late) falls back to speech.
    static func useClip(status: Int?, contentType: String?, bytes: Int, elapsed: Double) -> Bool {
        status == 200 && (contentType?.hasPrefix("audio/") ?? false) && bytes > 0 && elapsed <= timeout
    }

    static func cacheKey(text: String, lang: String) -> String {
        SHA256.hash(data: Data("\(lang)|\(text)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
