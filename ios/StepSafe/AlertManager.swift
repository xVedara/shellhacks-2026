import AVFoundation
import CoreHaptics
import MediaPlayer
import os
import simd
import UIKit

/// Plays what AlertPolicy decides: one prioritized sound or phrase at a time (PLAN.md section 7).
/// Spatial tones go through one AVAudioEngine + AVAudioEnvironmentNode (HRTF), placed at the
/// hazard's world point, with the listener following the ARKit camera (head mount: phone pose = head pose).
/// Public methods are called on the main thread, except setListenerPose (any thread). Every audio-node
/// mutation and all speech run on one serial `audioQueue`. Remote-command handlers arrive on an
/// arbitrary queue and hop to main before touching policy or SwiftUI callbacks.
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
    /// Server-voiced phrases (TTSPlayer clips), not spatialized.
    private let clipPlayer = AVAudioPlayerNode()
    /// Format TTSPlayer converts clips to.
    static let clipFormat = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)! // mono, so it spatializes
    private var tones: [Tone: AVAudioPCMBuffer] = [:]
    private lazy var silence = Self.silentBuffer(format)
    private let speech = AVSpeechSynthesizer()
    /// Bundled StepSafe-voice clips for the fixed phrases; speech when a clip is missing.
    private let phrases = PhrasePlayer()
    private var haptics: CHHapticEngine?

    /// Something to say that must not cut off a priority 1 or 2 alert; it waits for it instead.
    private enum Notice {
        case say(String), whatsAhead
        /// A spoken label or heads-up: server clip, or speech when nil. Plays as serverPhrasePriority.
        /// `onDrop` runs when this never starts (muted, audio down, or the queue expired).
        /// What's-ahead clears the queue but does not call this: the heads-up claim stays.
        case server(String, clip: AVAudioPCMBuffer?, onDrop: (() -> Void)?)

        var isServer: Bool { if case .server = self { return true } else { return false } }
        var onDrop: (() -> Void)? {
            if case let .server(_, _, onDrop) = self { return onDrop }
            return nil
        }
    }

    // Main-thread state
    private var policy = AlertPolicy()
    private var latest: [HazardKind: Detection] = [:]
    /// What is playing: its priority, and the hazard if it is an alert (un-marked if cut off).
    private var current: (priority: Int, hazard: Detection?, startedAt: Double, ttc: Float)?
    private var busyUntil: Double = 0
    private var pending = NoticeQueue<Notice>()
    private var lastRouteChange: Double = -.infinity
    private var lastAudioRetry: Double = -.infinity
    private var lastHapticOnly: Double = -.infinity
    /// Last priority-1 haptic: the fault buzz never lands on top of one.
    private var lastUrgentHaptic: Double = -.infinity
    /// Fault cues (FaultCue): audio down, AR tracking lost. Only while scanning.
    private var audioFault = FaultCue(grace: Tuning.faultAudioGraceSeconds, repeatSeconds: Tuning.faultRepeatSeconds)
    private var trackingFault = FaultCue(grace: Tuning.faultTrackingGraceSeconds, repeatSeconds: Tuning.faultRepeatSeconds)
    /// Path guard paused or failed (pathGuardStatus).
    private var trackingDown = false
    /// A fault cue waiting for a priority-1 alert (and its haptic) to finish.
    private var faultDue: String?
    private var tick: Timer?
    /// Engine running and not interrupted: only then does an alert count as announced.
    private var audioReady = false { didSet { if audioReady != oldValue { onAudioState?(audioReady) } } }
    private(set) var isScanning = false
    /// Path guard saw a curb (drop-off) ahead recently; set with every analysis output (what's-ahead advice).
    var atCurb = false
    var onMuteChange: ((Bool) -> Void)?
    /// false = "Audio failed" (shown on screen) while scanning.
    var onAudioState: ((Bool) -> Void)?

    init() {
        for tone in Tone.allCases { tones[tone] = Self.synthesize(tone, format) }
        engine.attach(environment)
        engine.attach(tonePlayer)
        engine.attach(silencePlayer)
        engine.attach(clipPlayer)
        engine.connect(tonePlayer, to: environment, format: format)
        engine.connect(environment, to: engine.mainMixerNode, format: nil)
        engine.connect(silencePlayer, to: engine.mainMixerNode, format: format)
        engine.connect(clipPlayer, to: engine.mainMixerNode, format: Self.clipFormat)
        tonePlayer.renderingAlgorithm = .HRTFHQ
        environment.distanceAttenuationParameters.referenceDistance = 1
        environment.distanceAttenuationParameters.rolloffFactor = 0.3 // 5 m away must still be clearly audible

        haptics = try? CHHapticEngine()
        // Haptics only: the engine does not depend on the audio session, so P1 haptics survive audio interruptions.
        haptics?.playsHapticsOnly = true
        haptics?.resetHandler = { [weak self] in try? self?.haptics?.start() }
        haptics?.stoppedHandler = { [weak self] reason in
            self?.audioLog.info("haptic engine stopped (\(reason.rawValue)), restarting")
            try? self?.haptics?.start()
        }
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
        center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.audioLog.info("media services reset")
            self?.cutOff()
            self?.audioReady = false // the tick retries once a second
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
        phrases.waitUntilReady() // every urgent clip decoded before scanning goes active (well under 1 s)
        pinged = []
        holdStillHint = HoldStillHint()
        isScanning = true
        policy.clearHistory()
        latest = [:]
        pending.removeAll()
        audioFault = FaultCue(grace: Tuning.faultAudioGraceSeconds, repeatSeconds: Tuning.faultRepeatSeconds)
        trackingFault = FaultCue(grace: Tuning.faultTrackingGraceSeconds, repeatSeconds: Tuning.faultRepeatSeconds)
        trackingDown = false
        faultDue = nil
        lastAudioRetry = now
        audioReady = startAudio()
        tick = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.onTick() }
    }

    /// Housekeeping while scanning: audio retry (at most once a second), fault cue, mute expiry, queued notices.
    private func onTick() {
        if audioReady && (!engine.isRunning || AVAudioSession.sharedInstance().currentRoute.outputs.isEmpty) {
            audioLog.error("engine stopped or no output route")
            cutOff()
            audioReady = false
        }
        if !audioReady && now - lastAudioRetry >= 1 { recoverAudio() }
        checkFaults()
        if policy.muteExpired(now: now) {
            onMuteChange?(false)
            notice(.say(Notices.alertsOn))
        }
        drainNotices()
    }

    /// Non-visual "StepSafe is not working": the fault buzz plus a VoiceOver announcement, repeated while it lasts;
    /// "Audio back" once audio returns. Never in place of, or on top of, a priority-1 alert or its haptic.
    private func checkFaults() {
        let es = TTSChoice.lang() == "es"
        switch audioFault.update(down: !audioReady, scanning: isScanning, now: now) {
        case .cue: faultDue = es ? "Audio de StepSafe detenido" : "StepSafe audio stopped"
        case .recovered: notice(.say(Notices.audioBack))
        case nil: break
        }
        if trackingFault.update(down: trackingDown, scanning: isScanning, now: now) == .cue, faultDue == nil {
            faultDue = es ? "Guía de camino en pausa" : Notices.pathGuardPaused
        }
        guard let text = faultDue, playingPriority != 1, now - lastUrgentHaptic >= 1 else { return }
        faultDue = nil
        playHaptic(.fault, urgent: false)
        UIAccessibility.post(notification: .announcement, argument: text) // spoken only when VoiceOver is on
    }

    /// Deactivates the session so other audio apps can resume.
    func stopScanning() {
        isScanning = false
        tick?.invalidate()
        tick = nil
        audioReady = false
        latest = [:]
        pending.removeAll()
        current = nil
        audioQueue.sync {
            speech.stopSpeaking(at: .immediate)
            silencePlayer.stop()
            tonePlayer.stop()
            clipPlayer.stop()
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
        pinged = []
        dropToneAfterWords = nil
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

    /// After an interruption or route change: restart, then let the policy decide. The alert that was cut off
    /// was un-marked (cutOff), so it is due again; hazards never announced while audio was down are due too;
    /// everything already announced keeps its repeat rules.
    private func recoverAudio() {
        guard isScanning else { return }
        lastAudioRetry = now
        audioReady = startAudio()
        guard audioReady, let d = policy.decide(latest, now: now, playing: playing, walkerSpeed: walkerSpeed) else { return }
        announce(d)
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

    /// Remote-command handlers are not on main. Already-on-main calls run inline; otherwise the work is
    /// serialized with analysis updates and SwiftUI.
    private func onMain(_ body: @escaping (AlertManager) -> Void) {
        if Thread.isMainThread {
            body(self)
        } else {
            DispatchQueue.main.async { [weak self] in
                if let self { body(self) }
            }
        }
    }

    /// What is playing, for the hazard cut-off rules (AlertPolicy.mayStart).
    private var playing: AlertPolicy.Playing? {
        guard let p = playingPriority else { return nil }
        return AlertPolicy.Playing(priority: p, hazard: current?.hazard, endsAt: max(busyUntil, now + 0.3),
                                   startedAt: current?.startedAt ?? now, ttcAtStart: current?.ttc ?? .infinity)
    }

    /// Walker speed from the last analysis output (drop-off time to contact).
    var walkerSpeed: Float = 0
    /// Head held still at the last analysis output (HeadMotion).
    var headStill = true
    /// "Hold still to check traffic.", once per scanning session.
    private var holdStillHint = HoldStillHint()
    /// Closing objects (track ids) that already got their immediate tone and haptic.
    private var pinged: Set<Int> = []
    /// A due priority-1 drop-off waiting behind closing words: its tone at the drop-off and the haptic now, mixed
    /// over the words (AlertPolicy.dropOffToCue); its words follow.
    private func cueBlockedDropOff(_ confirmed: [HazardKind: Detection]) {
        if let (point, at) = dropToneAfterWords, now >= at + 0.25, playingPriority == nil {
            dropToneAfterWords = nil // no follow-on started: the tone alone once nothing is speaking
            playDropOffTone(at: point)
        }
        guard let d = policy.dropOffToCue(confirmed, playing: playing, now: now) else { return }
        playHaptic(.dropOff, urgent: true) // now, over the closing words; the tone waits for them to end (no tone over words)
        dropToneAfterWords = (d.point, busyUntil)
    }

    /// The drop-off tone waiting for the closing words to end, and when they end.
    private var dropToneAfterWords: (SIMD3<Float>, Double)?

    private func playDropOffTone(at point: SIMD3<Float>) {
        guard audioReady, let buffer = tones[.dropOff] else { return }
        audioQueue.async { [self] in
            tonePlayer.position = AVAudio3DPoint(x: point.x, y: point.y, z: point.z)
            tonePlayer.scheduleBuffer(buffer, at: nil, options: .interrupts)
            tonePlayer.play()
        }
    }

    /// Each NEW closing object gets the spatial crossing tone and the haptic at once, even while another clip
    /// plays (the tone mixes over speech; nothing is cut off). Its spoken alert follows the policy.
    /// Several new tracks in one frame: least urgent tone first, so the soonest contact is the one left playing.
    private func pingNewClosing(_ tracks: [Detection]) {
        let fresh = AlertPolicy.unpingedClosings(tracks, pinged: pinged).sorted { a, b in
            let ka = (a.closing?.passing == true ? 1 : 0, a.closing?.ttc ?? .infinity)
            let kb = (b.closing?.passing == true ? 1 : 0, b.closing?.ttc ?? .infinity)
            return ka > kb
        }
        for c in fresh {
            if let id = c.closing?.trackId { pinged.insert(id) }
            playHaptic(.closing, urgent: true)
            guard audioReady, let buffer = tones[.crossing], let copy = Self.copy(buffer) else { continue }
            let point = c.point
            audioQueue.async { [self, copy] in
                tonePlayer.position = AVAudio3DPoint(x: point.x, y: point.y, z: point.z)
                tonePlayer.scheduleBuffer(copy, at: nil, options: .interrupts)
                tonePlayer.play()
            }
        }
    }

    /// A second schedule of the same buffer while it is playing is not safe. The crossing tone is one short beep.
    private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let out = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength),
              let src = buffer.floatChannelData?[0], let dst = out.floatChannelData?[0] else { return nil }
        out.frameLength = buffer.frameLength
        memcpy(dst, src, Int(buffer.frameLength) * MemoryLayout<Float>.size)
        return out
    }

    /// Feed the confirmed hazards after every analysis frame.
    /// `closings` is every closing object this frame. Empty falls back to the single `confirmed[.closing]` slot.
    func update(_ confirmed: [HazardKind: Detection], closings: [Detection] = []) {
        latest = confirmed
        let tracks = closings.isEmpty ? (confirmed[.closing].map { [$0] } ?? []) : closings
        pingNewClosing(tracks)
        cueBlockedDropOff(confirmed)
        if let d = policy.decide(confirmed, now: now, playing: playing, walkerSpeed: walkerSpeed) {
            announce(d)
        }
        if holdStillHint.update(now: now, atCurb: atCurb, walkerSpeed: walkerSpeed, headStill: headStill) {
            notice(.say(Notices.holdStill))
        }
        drainNotices()
    }

    /// Every announced alert gets its kind's haptic (HapticGrammar); priority 1 at full strength.
    private func announce(_ d: Detection) {
        let urgent = AlertPolicy.neverMuted(d)
        let haptic = HapticGrammar.kind(d.kind)
        // A pre-cued follow-on plays the drop-off tone first (right after the closing words) and no second haptic.
        let tone: Tone? = d.followOn && !d.preCued ? nil : Self.tone(for: d.kind)
        if d.preCued { dropToneAfterWords = nil }
        if play(tone: tone, at: d.point, phrase: AlertPolicy.phrase(d), priority: AlertPolicy.priority(d), hazard: d) {
            policy.markAnnounced(d, now: now)
            if !d.preCued { playHaptic(haptic, urgent: urgent) }
        } else if now - lastHapticOnly >= 2 {
            // Audio down: not marked, so it replays after recovery; the haptic still warns meanwhile.
            lastHapticOnly = now
            playHaptic(haptic, urgent: urgent)
        }
    }

    /// Cuts off whatever is playing (un-marking a cut-off alert). Returns false, playing nothing, if audio is down.
    @discardableResult
    private func play(tone: Tone?, at point: SIMD3<Float>?, phrase: String, priority: Int, hazard: Detection? = nil) -> Bool {
        guard audioReady else { return false }
        var victim: Detection?
        if playingPriority != nil {
            victim = current?.hazard
            cutOff()
        }
        var delay: Double = 0
        let buffer = tone.flatMap { tones[$0] }
        if let buffer { delay = Double(buffer.frameLength) / format.sampleRate }
        // Same phrase, same priority and cut-off rules: the bundled clip (after the tone) or speech.
        let clip = phrases.buffer(for: phrase, leadIn: delay)
        busyUntil = now + (clip.map { Double($0.frameLength) / $0.format.sampleRate + 0.1 }
            ?? delay + 0.3) // speech: covers the gap before the synthesizer reports speaking
        // One-way pre-emption: what this cuts off may not cut it back while it plays.
        if let victim, let hazard { policy.noteCutOff(victim: victim, by: hazard, until: busyUntil) }
        current = (priority, hazard, now, hazard.map { AlertPolicy.ttc($0, walkerSpeed: walkerSpeed) } ?? .infinity)
        audioQueue.async { [self] in
            speech.stopSpeaking(at: .immediate)
            tonePlayer.stop()
            clipPlayer.stop()
            if let buffer, let point {
                tonePlayer.position = AVAudio3DPoint(x: point.x, y: point.y, z: point.z)
                tonePlayer.scheduleBuffer(buffer, at: nil, options: .interrupts)
            }
            tonePlayer.play()
            if let clip {
                clipPlayer.scheduleBuffer(clip, at: nil, options: .interrupts)
                clipPlayer.play()
                return
            }
            let utterance = AVSpeechUtterance(string: phrase)
            utterance.preUtteranceDelay = delay
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.1
            speech.speak(utterance)
        }
        return true
    }

    /// Notices go through NoticeQueue: they never cut off an alert or each other (a status notice may cut
    /// off a server phrase), status first, stale server phrases dropped. Hazard alerts still cut them off.
    /// Stopped: nothing drains the queue and nothing urgent can play, so they play at once.
    private func notice(_ n: Notice) {
        guard isScanning else { return perform(n) }
        pending.push(n, server: n.isServer, now: now)
        drainNotices()
    }

    private func drainNotices() {
        var dropped: [Notice] = []
        let next = pending.pop(playing: playingPriority, now: now, dropped: &dropped)
        for n in dropped { n.onDrop?() }
        if let next { perform(next) }
    }

    private func perform(_ n: Notice) {
        switch n {
        case let .say(phrase): speakNow(phrase)
        case .whatsAhead:
            let phrase = AlertPolicy.whatsAheadPhrase(latest, atCurb: atCurb)
            let d = AlertPolicy.whatsAheadHazard(latest)
            if play(tone: d.map { Self.tone(for: $0.kind) }, at: d?.point, phrase: phrase,
                    priority: AlertPolicy.whatsAheadPriority(d), hazard: d) {
                if let d { policy.markAnnounced(d, now: now) } // said: no replay right after (cut off: un-marked)
            } else {
                speakNow(phrase)
            }
        case let .server(text, clip, onDrop):
            let priority = AlertPolicy.serverPhrasePriority // any hazard alert may cut it off
            guard !policy.isMuted(now: now) else { onDrop?(); return } // mute silences priority 2 and lower
            guard let clip, audioReady else {
                if !play(tone: nil, at: nil, phrase: text, priority: priority) { onDrop?() } // speech fallback; nothing if audio is down
                return
            }
            if playingPriority != nil { cutOff() }
            busyUntil = now + Double(clip.frameLength) / clip.format.sampleRate + 0.1
            current = (priority, nil, now, .infinity)
            audioQueue.async { [self] in
                speech.stopSpeaking(at: .immediate)
                tonePlayer.stop()
                clipPlayer.stop()
                clipPlayer.scheduleBuffer(clip, at: nil, options: .interrupts)
                clipPlayer.play()
            }
        }
    }

    /// A server label or map heads-up (PLAN priority 3/4), only while scanning. Queued like any notice
    /// (never cuts anything off) and plays as serverPhrasePriority, so any hazard alert cuts it off.
    /// `onDrop` runs when the phrase never starts (muted, audio down, or the queue expired).
    func sayServer(_ text: String, clip: AVAudioPCMBuffer?, onDrop: (() -> Void)? = nil) {
        guard isScanning, !policy.isMuted(now: now) else { onDrop?(); return }
        notice(.server(text, clip: clip, onDrop: onDrop))
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
        trackingDown = status == .paused || status == .failed
        switch status {
        case .on: notice(.say(Notices.pathGuardOn))
        case .back: notice(.say(Notices.pathGuardBack))
        case .paused: notice(.say(Notices.pathGuardPaused))
        case .failed: notice(.say(Notices.pathGuardFailed))
        }
    }

    private static func tone(for kind: HazardKind) -> Tone {
        switch kind {
        case .dropOff: return .dropOff
        case .headHeight: return .headHeight
        case .ground: return .ground
        case .closing: return .crossing // spatialized at the object
        }
    }

    /// Independent of mute and audio: the haptic engine is haptics-only (init).
    private func playHaptic(_ kind: HapticGrammar.Kind, urgent: Bool) {
        if urgent { lastUrgentHaptic = now }
        guard let haptics else { return }
        try? haptics.start() // no-op if running; restarts it if the system stopped it
        let events = HapticGrammar.events(kind, urgent: urgent).map { e in
            let parameters = [CHHapticEventParameter(parameterID: .hapticIntensity, value: e.intensity),
                              CHHapticEventParameter(parameterID: .hapticSharpness, value: e.sharpness)]
            return e.duration.map { CHHapticEvent(eventType: .hapticContinuous, parameters: parameters, relativeTime: e.time, duration: $0) }
                ?? CHHapticEvent(eventType: .hapticTransient, parameters: parameters, relativeTime: e.time)
        }
        try? haptics.makePlayer(with: CHHapticPattern(events: events, parameters: [])).start(atTime: 0)
    }

    // MARK: Controls (AirPods and on-screen buttons)

    /// Clears queued sounds and just tells what's ahead: cuts off anything playing below priority 1, drops queued
    /// notices and server phrases (a pending closing phrase stays: AlertPolicy.pending), then answers. During a
    /// priority-1 alert the answer waits for it.
    func whatsAhead() {
        guard isScanning else { return notice(.say(Notices.stopped)) }
        if AlertPolicy.whatsAheadCutsOff(playingPriority) { cutOff() }
        // Throw the cleared notices away. Calling onDrop here released the heads-up claim, MapSync
        // re-claimed the same pin, and the heads-up played straight after this answer.
        pending.replaceAll(with: .whatsAhead, now: now)
        drainNotices()
    }

    var isMuted: Bool { policy.isMuted(now: now) }

    /// Mute silences routine alerts (priority 2 and lower) for Tuning.muteDuration; priority 1 (closing objects,
    /// drop-offs within 2 m) still plays, and the notice says so.
    func toggleMute() {
        let mute = !isMuted
        policy.setMuted(mute, now: now)
        onMuteChange?(mute)
        notice(.say(mute ? Notices.muted : Notices.alertsOn))
    }

    /// A headset command (RemoteControls): play/pause = what's ahead, never mute; next track = mute toggle.
    func handle(_ command: RemoteCommand) {
        let action = RemoteControls.action(command, sinceRouteChange: now - lastRouteChange)
        log.info("remote command \(String(describing: command), privacy: .public) -> \(String(describing: action), privacy: .public)")
        switch action {
        case .whatsAhead: whatsAhead()
        case .toggleMute: toggleMute()
        case .ignore: break // play/pause right after an AirPod went in or came out
        }
    }

    private func registerRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()
        let commands: [(MPRemoteCommand, RemoteCommand)] = [(cc.togglePlayPauseCommand, .togglePlayPause), (cc.playCommand, .play),
                                                            (cc.pauseCommand, .pause), (cc.nextTrackCommand, .nextTrack)]
        for (command, name) in commands {
            command.isEnabled = true
            command.addTarget { [weak self] _ in
                self?.onMain { $0.handle(name) }
                return .success
            }
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
            case .crossing: return (700, 1600, 1, 0.15, 0, 0.9) // short: speech starts 150 ms after
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
