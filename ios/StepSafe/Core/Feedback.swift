/// Non-speech feedback rules for the walker: remote-command mapping, haptic patterns per hazard kind, and the
/// "StepSafe is not working" fault cue. Pure, unit-tested (FeedbackTests); AlertManager plays the results.

/// AirPods / headset commands. One command, one meaning: play/pause never mutes (a second press used to toggle
/// mute right after "what's ahead" had spoken). Mute is next-track (the AirPods double-press) or the screen.
enum RemoteCommand { case togglePlayPause, play, pause, nextTrack }

enum RemoteAction: Equatable { case whatsAhead, toggleMute, ignore }

enum RemoteControls {
    /// iOS sends play/pause when an AirPod goes in or comes out: ignored this long after a route change.
    static let routeChangeIgnoreSeconds: Double = 1.5

    static func action(_ command: RemoteCommand, sinceRouteChange: Double) -> RemoteAction {
        switch command {
        case .togglePlayPause: return .whatsAhead
        case .play, .pause: return sinceRouteChange < routeChangeIgnoreSeconds ? .ignore : .whatsAhead
        case .nextTrack: return .toggleMute
        }
    }
}

/// One Core Haptics event: transient tap when `duration` is nil, else a continuous buzz.
struct HapticEvent: Equatable {
    var time: Double
    var intensity: Float
    var sharpness: Float
    var duration: Double? = nil
}

/// Hazard haptic grammar. Every priority-1 pattern (closing objects, drop-offs within 2 m) plays at full intensity;
/// patterns differ by rhythm and sharpness, never by being weaker. The caller fires them whatever the mute or audio
/// state (AlertManager: closing ping, P1 announce, audio-down fallback).
enum HapticGrammar {
    enum Kind: Equatable { case closing, dropOff, headHeight, ground, fault }

    static func kind(_ k: HazardKind) -> Kind {
        switch k {
        case .closing: return .closing
        case .dropOff: return .dropOff
        case .headHeight: return .headHeight
        case .ground: return .ground
        }
    }

    /// `urgent` = priority 1: every event at intensity 1.
    static func events(_ kind: Kind, urgent: Bool) -> [HapticEvent] {
        let base: [HapticEvent]
        switch kind {
        case .closing: // rising: four taps, closer together and sharper each time
            base = zip([0, 0.12, 0.21, 0.27], [0.4, 0.6, 0.8, 1.0]).map { HapticEvent(time: $0, intensity: 1, sharpness: $1) }
        case .dropOff: // strong triplet (the original P1 pattern)
            base = (0..<3).map { HapticEvent(time: Double($0) * 0.1, intensity: 1, sharpness: 1) }
        case .headHeight: // double tap, wide gap
            base = [0, 0.18].map { HapticEvent(time: $0, intensity: 0.8, sharpness: 0.7) }
        case .ground: // one soft tap
            base = [HapticEvent(time: 0, intensity: 0.5, sharpness: 0.3)]
        case .fault: // two long dull buzzes: nothing like a hazard tap
            base = [0, 0.8].map { HapticEvent(time: $0, intensity: 1, sharpness: 0.1, duration: 0.5) }
        }
        return urgent ? base.map { var e = $0; e.intensity = 1; return e } : base
    }
}

/// "StepSafe is not working" cue for one fault source (audio down, tracking lost). While scanning and down for
/// `grace` seconds: a cue, repeated every `repeatSeconds` until it is back; then one `.recovered`. A down spell
/// shorter than `grace` gives nothing. Stopping resets it silently.
struct FaultCue {
    enum Event: Equatable { case cue, recovered }

    let grace: Double
    let repeatSeconds: Double
    private var downSince: Double?
    private var lastCue: Double?
    /// A cue fired in this down spell (so recovery is announced).
    private(set) var faulted = false

    init(grace: Double, repeatSeconds: Double = 30) {
        self.grace = grace
        self.repeatSeconds = repeatSeconds
    }

    mutating func update(down: Bool, scanning: Bool, now: Double) -> Event? {
        guard scanning else { self = FaultCue(grace: grace, repeatSeconds: repeatSeconds); return nil }
        guard down else {
            // Latched: an outage past the grace that ends before any cue fired (recovered between ticks, or
            // on the tick that would have cued) is still announced as recovered.
            let was = faulted || downSince.map { now - $0 >= grace } == true
            self = FaultCue(grace: grace, repeatSeconds: repeatSeconds)
            return was ? .recovered : nil
        }
        let since = downSince ?? now
        downSince = since
        guard now - since >= grace, lastCue.map({ now - $0 >= repeatSeconds }) ?? true else { return nil }
        lastCue = now
        faulted = true
        return .cue
    }
}

/// Audio down: an alert is never marked announced, so decide() offers it again every frame. One haptic per hazard
/// identity per `interval`. Identities are independent: a routine haptic never swallows an urgent one, and two
/// different urgent hazards both get theirs.
struct HapticLimiter {
    let interval: Double
    private var last: [String: Double] = [:]

    init(interval: Double = 2) { self.interval = interval }

    /// Closing objects by track id; drop-offs and head-height hazards by priority and their AlertPolicy episode
    /// (one edge followed while walking is one key per priority); anything without an episode by kind, priority and
    /// world point on a 0.5 m grid. So a routine (P2) buzz never delays the P1 buzz of the same edge once it crosses
    /// 2 m, two different drop-offs within 2 s both buzz, and the same persistent hazard is still limited.
    /// ponytail: a point sliding along a grid line can land in a new cell every ~0.5 m (more buzzes while walking
    /// with audio down); key ground by an identity if it ever gets one.
    static func key(_ d: Detection, episode: Int? = nil) -> String {
        if d.kind == .closing { return "closing-\(d.closing.map { String($0.trackId) } ?? "?")" }
        if let episode { return "\(d.kind)-\(AlertPolicy.priority(d))-episode-\(episode)" }
        let cell = (d.point / 0.5).rounded(.toNearestOrAwayFromZero)
        return "\(d.kind)-\(AlertPolicy.priority(d))-\(Int(cell.x)),\(Int(cell.y)),\(Int(cell.z))"
    }

    /// `episode`: AlertPolicy.episodeKey(d) (nil for ground and closing objects, or with episodes off).
    mutating func allow(_ d: Detection, episode: Int? = nil, now: Double) -> Bool {
        let k = Self.key(d, episode: episode)
        if let t = last[k], now - t < interval { return false }
        last[k] = now
        return true
    }
}

/// Whether "what's ahead" from an App Shortcut can answer from live data. Otherwise Siri says why, never
/// "Nothing detected ahead" (which would claim a check that did not happen).
enum WhatsAheadAvailability: Equatable {
    case stopped, paused, audioDown, ready

    /// The last analysis output must be at most this old.
    static let maxFrameAgeSeconds = 1.0

    /// `foreground`: the app is not in the background (the sensor session runs only in the foreground). Not
    /// "active": the Siri overlay makes a foreground app inactive while ARKit keeps running.
    /// `audioReady`: our own audio can play the answer; if not, nothing would be heard, so Siri says so instead.
    static func of(scanning: Bool, trackingDown: Bool, frameAge: Double?, foreground: Bool, audioReady: Bool) -> Self {
        guard scanning else { return .stopped }
        guard foreground else { return .paused }
        guard !trackingDown, let age = frameAge, age <= maxFrameAgeSeconds else { return .paused }
        return audioReady ? .ready : .audioDown
    }

    /// Siri dialog text when not ready (on-screen/Siri speech, not a bundled clip). Ready: nil, and Siri says
    /// nothing; the answer plays only through StepSafe's own interruptible audio (AlertManager.whatsAhead).
    func dialog(lang: String) -> String? {
        let es = lang == "es"
        switch self {
        case .stopped: return es ? "StepSafe está detenido y no revisa el camino." : "StepSafe is stopped and not checking the path."
        case .paused: return es ? "StepSafe está en pausa y no revisa el camino." : "StepSafe is paused and not checking the path."
        case .audioDown: return es ? "Audio de StepSafe detenido" : "StepSafe audio stopped"
        case .ready: return nil
        }
    }
}
