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
            let was = faulted
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
