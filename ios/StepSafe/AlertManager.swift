import AVFoundation
import CoreHaptics
import MediaPlayer
import os
import simd

/// Plays what AlertPolicy decides: one prioritized sound or phrase at a time (PLAN.md section 7).
/// Spatial tones go through one AVAudioEngine + AVAudioEnvironmentNode (HRTF), placed at the
/// hazard's world point, with the listener following the ARKit camera (head mount: phone pose = head pose).
/// Public methods are called on the main thread, except setListenerPose (any thread). Every audio-node
/// mutation and all speech run on one serial `audioQueue`.
final class AlertManager {
    enum Tone: CaseIterable {
        case dropOff, headHeight, ground
        case crossing // reserved for crossing assist; nothing triggers it yet
    }

    private let log = Logger(subsystem: "net.babigian.stepsafe", category: "remote")
    private let audioLog = Logger(subsystem: "net.babigian.stepsafe", category: "audio")

    private let audioQueue = DispatchQueue(label: "net.babigian.stepsafe.audio", qos: .userInteractive)
    private let engine = AVAudioEngine()
    private let environment = AVAudioEnvironmentNode()
    private let tonePlayer = AVAudioPlayerNode()
    private let silencePlayer = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)! // mono, so it spatializes
    private var tones: [Tone: AVAudioPCMBuffer] = [:]
    private lazy var silence = Self.silentBuffer(format)
    private let speech = AVSpeechSynthesizer()
    private var haptics: CHHapticEngine?

    /// Something to say that must not cut off a priority 1 or 2 alert; it waits for it instead.
    private enum Notice { case say(String), whatsAhead }

    // Main-thread state
    private var policy = AlertPolicy()
    private var latest: [HazardKind: Detection] = [:]
    /// What is playing: its priority, and the hazard if it is an alert (un-marked if cut off).
    private var current: (priority: Int, hazard: Detection?)?
    private var busyUntil: Double = 0
    private var pending: [Notice] = []
    private var lastPress: Double = -.infinity
    private var lastRouteChange: Double = -.infinity
    private var lastAudioRetry: Double = -.infinity
    private var lastHapticOnly: Double = -.infinity
    private var tick: Timer?
    /// Engine running and not interrupted: only then does an alert count as announced.
    private var audioReady = false { didSet { if audioReady != oldValue { onAudioState?(audioReady) } } }
    private(set) var isScanning = false
    var onMuteChange: ((Bool) -> Void)?
    /// false = "Audio failed" (shown on screen) while scanning.
    var onAudioState: ((Bool) -> Void)?

    init() {
        for tone in Tone.allCases { tones[tone] = Self.synthesize(tone, format) }
        engine.attach(environment)
        engine.attach(tonePlayer)
        engine.attach(silencePlayer)
        engine.connect(tonePlayer, to: environment, format: format)
        engine.connect(environment, to: engine.mainMixerNode, format: nil)
        engine.connect(silencePlayer, to: engine.mainMixerNode, format: format)
        tonePlayer.renderingAlgorithm = .HRTFHQ
        environment.distanceAttenuationParameters.referenceDistance = 1
        environment.distanceAttenuationParameters.rolloffFactor = 0.3 // 5 m away must still be clearly audible

        haptics = try? CHHapticEngine()
        haptics?.resetHandler = { [weak self] in try? self?.haptics?.start() }
        try? haptics?.start()

        let center = NotificationCenter.default
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let self else { return }
            let type = (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
            self.audioLog.info("interruption \(type == .began ? "began" : "ended", privacy: .public)")
            if type == .began {
                self.cutOff()
                self.audioReady = false
            } else {
                self.recoverAudio()
            }
        }
        center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            self?.audioLog.info("engine configuration change (route)")
            self?.cutOff()
            self?.recoverAudio() // AirPods connected or disconnected; the engine stopped
        }
        center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] n in
            guard let self,
                  let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
                  reason == .newDeviceAvailable || reason == .oldDeviceUnavailable else { return }
            self.lastRouteChange = self.now // an AirPod went in or came out; iOS may send play/pause for it
        }
        registerRemoteCommands()
    }

    // MARK: Scanning lifecycle

    /// Activates the session and plays looped silence so the app is the Now Playing app and receives
    /// AirPods presses. Deliberately NOT .mixWithOthers: a mixable session never becomes Now Playing.
    func startScanning() {
        isScanning = true
        policy.clearHistory()
        latest = [:]
        pending = []
        lastAudioRetry = now
        audioReady = startAudio()
        tick = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.onTick() }
    }

    /// Housekeeping while scanning: audio retry (at most once a second), mute expiry, queued notices.
    private func onTick() {
        if !audioReady && now - lastAudioRetry >= 1 { recoverAudio() }
        if policy.muteExpired(now: now) {
            onMuteChange?(false)
            notice(.say("Alerts on"))
        }
        drainNotices()
    }

    /// Deactivates the session so other audio apps can resume.
    func stopScanning() {
        isScanning = false
        tick?.invalidate()
        tick = nil
        audioReady = false
        latest = [:]
        pending = []
        current = nil
        audioQueue.sync {
            speech.stopSpeaking(at: .immediate)
            silencePlayer.stop()
            tonePlayer.stop()
            engine.stop()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                audioLog.error("deactivate failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// AR tracking reset: forget which hazards were announced.
    func clearHistory() {
        policy.clearHistory()
        latest = [:]
    }

    private func startAudio() -> Bool {
        audioQueue.sync {
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .default, options: [])
                try session.setActive(true)
                if !engine.isRunning { try engine.start() }
                // After any (re)start, player nodes may be reset: always reschedule the silence loop.
                silencePlayer.stop()
                silencePlayer.scheduleBuffer(silence, at: nil, options: .loops)
                silencePlayer.play()
                tonePlayer.play()
                MPNowPlayingInfoCenter.default().nowPlayingInfo = [
                    MPMediaItemPropertyTitle: "StepSafe",
                    MPNowPlayingInfoPropertyPlaybackRate: 1.0,
                ]
                audioLog.info("audio running, route: \(session.currentRoute.outputs.map(\.portName).joined(separator: ","), privacy: .public)")
                return true
            } catch {
                audioLog.error("audio start failed: \(error.localizedDescription, privacy: .public)")
                return false
            }
        }
    }

    /// After an interruption or route change: restart, then replay the most urgent current hazard.
    private func recoverAudio() {
        guard isScanning else { return }
        lastAudioRetry = now
        audioReady = startAudio()
        guard audioReady, let d = AlertPolicy.mostUrgent(latest.values) else { return }
        let p = AlertPolicy.priority(d)
        if policy.isMuted(now: now) && p > 1 { return }
        announce(d, priority: p)
    }

    /// Whatever was playing got cut off (interruption, route change): un-mark it so it can replay.
    private func cutOff() {
        if let hazard = current?.hazard { policy.unmark(hazard) }
        current = nil
    }

    func setListenerPose(_ t: simd_float4x4) {
        let forward = -SIMD3(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        // Up = world up made perpendicular to forward (head roll ignored; works for any phone roll on the mount).
        var up = SIMD3<Float>(0, 1, 0) - simd_dot(SIMD3(0, 1, 0), forward) * forward
        up = simd_length(up) > 0.01 ? simd_normalize(up) : SIMD3(0, 0, -1)
        let position = AVAudio3DPoint(x: t.columns.3.x, y: t.columns.3.y, z: t.columns.3.z)
        let orientation = AVAudio3DVectorOrientation(forward: AVAudio3DVector(x: forward.x, y: forward.y, z: forward.z),
                                                     up: AVAudio3DVector(x: up.x, y: up.y, z: up.z))
        audioQueue.async { [environment] in
            environment.listenerPosition = position
            environment.listenerVectorOrientation = orientation
        }
    }

    // MARK: Alerts

    private var now: Double { ProcessInfo.processInfo.systemUptime }
    private var playingPriority: Int? {
        guard speech.isSpeaking || now < busyUntil else { current = nil; return nil }
        return current?.priority
    }

    /// Feed the confirmed hazards after every analysis frame.
    func update(_ confirmed: [HazardKind: Detection]) {
        latest = confirmed
        if let d = policy.next(confirmed, now: now, playing: playingPriority) {
            announce(d, priority: AlertPolicy.priority(d))
        }
        drainNotices()
    }

    private func announce(_ d: Detection, priority: Int) {
        if play(tone: Self.tone(for: d.kind), at: d.point, phrase: AlertPolicy.phrase(d), priority: priority, hazard: d) {
            policy.markAnnounced(d, now: now)
            if priority == 1 { playHaptic() }
        } else if priority == 1, now - lastHapticOnly >= 2 {
            // Audio down: not marked, so it replays after recovery; the haptic still warns meanwhile.
            lastHapticOnly = now
            playHaptic()
        }
    }

    /// Cuts off whatever is playing (un-marking a cut-off alert). Returns false, playing nothing, if audio is down.
    @discardableResult
    private func play(tone: Tone?, at point: SIMD3<Float>?, phrase: String, priority: Int, hazard: Detection? = nil) -> Bool {
        guard audioReady else { return false }
        if playingPriority != nil { cutOff() }
        var delay: Double = 0
        let buffer = tone.flatMap { tones[$0] }
        if let buffer { delay = Double(buffer.frameLength) / format.sampleRate }
        busyUntil = now + delay + 0.3 // covers the gap before the synthesizer reports speaking
        current = (priority, hazard)
        audioQueue.async { [self] in
            speech.stopSpeaking(at: .immediate)
            tonePlayer.stop()
            if let buffer, let point {
                tonePlayer.position = AVAudio3DPoint(x: point.x, y: point.y, z: point.z)
                tonePlayer.scheduleBuffer(buffer, at: nil, options: .interrupts)
            }
            tonePlayer.play()
            let utterance = AVSpeechUtterance(string: phrase)
            utterance.preUtteranceDelay = delay
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.1
            speech.speak(utterance)
        }
        return true
    }

    /// Notices play now unless a priority 1 or 2 alert is playing; then they wait for it.
    private func notice(_ n: Notice) {
        if AlertPolicy.mayStart(AlertPolicy.onRequestPriority, over: playingPriority) {
            perform(n)
        } else {
            pending.append(n)
        }
    }

    private func drainNotices() {
        guard !pending.isEmpty, AlertPolicy.mayStart(AlertPolicy.onRequestPriority, over: playingPriority) else { return }
        perform(pending.removeFirst())
    }

    private func perform(_ n: Notice) {
        switch n {
        case let .say(phrase): speakNow(phrase)
        case .whatsAhead:
            if let d = AlertPolicy.mostUrgent(latest.values) {
                if !play(tone: Self.tone(for: d.kind), at: d.point, phrase: AlertPolicy.phrase(d),
                         priority: AlertPolicy.onRequestPriority) {
                    speakNow(AlertPolicy.phrase(d))
                }
            } else {
                speakNow("Path clear")
            }
        }
    }

    /// Falls back to speech alone when the engine is down or not scanning (audio session inactive).
    private func speakNow(_ phrase: String) {
        if play(tone: nil, at: nil, phrase: phrase, priority: AlertPolicy.onRequestPriority) { return }
        audioQueue.async { [speech] in
            speech.stopSpeaking(at: .immediate)
            speech.speak(AVSpeechUtterance(string: phrase))
        }
    }

    func pathGuardStatus(_ status: SensorSession.Status) {
        switch status {
        case .on: notice(.say("Path guard on"))
        case .back: notice(.say("Path guard back"))
        case .paused: notice(.say("Path guard paused"))
        case .failed: notice(.say("Path guard failed, restart"))
        }
    }

    private static func tone(for kind: HazardKind) -> Tone {
        switch kind {
        case .dropOff: return .dropOff
        case .headHeight: return .headHeight
        case .ground: return .ground
        }
    }

    private func playHaptic() {
        guard let haptics else { return }
        let events = (0..<3).map { i in
            CHHapticEvent(eventType: .hapticTransient, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 1),
            ], relativeTime: Double(i) * 0.1)
        }
        try? haptics.makePlayer(with: CHHapticPattern(events: events, parameters: [])).start(atTime: 0)
    }

    // MARK: Controls (AirPods and on-screen buttons)

    func whatsAhead() {
        notice(isScanning ? .whatsAhead : .say("StepSafe is stopped"))
    }

    var isMuted: Bool { policy.isMuted(now: now) }

    /// Mute silences priority 2 and lower for Tuning.muteDuration; priority 1 still plays.
    func toggleMute() {
        let mute = !isMuted
        policy.setMuted(mute, now: now)
        onMuteChange?(mute)
        notice(.say(mute ? "Muted for 5 minutes" : "Alerts on"))
    }

    /// Play/pause press: first = what's ahead; a second within 2 s = mute toggle.
    func handlePress(source: String) {
        let t = now
        let isDouble = t - lastPress < Tuning.doublePressWindow
        log.info("remote command \(source, privacy: .public) -> \(isDouble ? "mute toggle" : "what's ahead", privacy: .public)")
        if isDouble {
            lastPress = -.infinity
            toggleMute()
        } else {
            lastPress = t
            whatsAhead()
        }
    }

    private func registerRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()
        cc.togglePlayPauseCommand.isEnabled = true
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.handlePress(source: "togglePlayPause")
            return .success
        }
        // play/pause also arrive when an AirPod is taken out or put in: ignore them right after a route change.
        for (command, name) in [(cc.playCommand, "play"), (cc.pauseCommand, "pause")] {
            command.isEnabled = true
            command.addTarget { [weak self] _ in
                guard let self else { return .success }
                if self.now - self.lastRouteChange < 1.5 {
                    self.log.info("remote command \(name, privacy: .public) ignored (route change)")
                } else {
                    self.handlePress(source: name)
                }
                return .success
            }
        }
        // AirPods double-press arrives as next track.
        cc.nextTrackCommand.isEnabled = true
        cc.nextTrackCommand.addTarget { [weak self] _ in
            self?.log.info("remote command nextTrack -> mute toggle")
            self?.toggleMute()
            return .success
        }
    }

    // MARK: Tone synthesis

    /// Distinct pitch and rhythm per tone: drop-off = three fast high beeps, head height = two
    /// medium beeps, ground = one soft low beep, crossing = rising sweep.
    private static func synthesize(_ tone: Tone, _ format: AVAudioFormat) -> AVAudioPCMBuffer {
        let (freq, endFreq, beeps, on, off, amp): (Double, Double, Int, Double, Double, Float) = {
            switch tone {
            case .dropOff: return (1320, 1320, 3, 0.08, 0.06, 0.9)
            case .headHeight: return (880, 880, 2, 0.15, 0.08, 0.8)
            case .ground: return (440, 440, 1, 0.25, 0, 0.6)
            case .crossing: return (700, 1600, 1, 0.35, 0, 0.9)
            }
        }()
        let sr = format.sampleRate
        let total = Int((Double(beeps) * (on + off)) * sr)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(total))!
        buffer.frameLength = AVAudioFrameCount(total)
        let out = buffer.floatChannelData![0]
        let onFrames = Int(on * sr), period = Int((on + off) * sr), fade = Int(0.005 * sr)
        var phase = 0.0
        for i in 0..<total {
            let k = i % period
            guard k < onFrames else { out[i] = 0; continue }
            let f = freq + (endFreq - freq) * Double(k) / Double(onFrames)
            phase += 2 * .pi * f / sr
            let env = Float(min(1, Double(min(k, onFrames - k)) / Double(fade)))
            out[i] = amp * env * Float(sin(phase))
        }
        return buffer
    }

    private static func silentBuffer(_ format: AVAudioFormat) -> AVAudioPCMBuffer {
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(format.sampleRate))!
        buffer.frameLength = buffer.frameCapacity
        memset(buffer.floatChannelData![0], 0, Int(buffer.frameLength) * MemoryLayout<Float>.size)
        return buffer
    }
}
