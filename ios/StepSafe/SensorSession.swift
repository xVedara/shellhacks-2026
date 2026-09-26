import ARKit
import os

/// ARKit world tracking with LiDAR scene depth. The ARSession delegate queue copies depth out of each
/// frame (never retaining the ARFrame); PathGuard runs on a separate serial queue at about
/// Tuning.analysisHz, and frames are skipped while it is busy. Callbacks arrive on background queues.
final class SensorSession: NSObject, ARSessionDelegate {
    struct Output {
        /// Session generation this output was computed in; compare with `generation` and drop stale ones.
        var generation: Int
        var confirmed: [HazardKind: Detection]
        var fps: Double
        var floorSource: FloorSource
        /// Depth thumbnail with lane and hazard pixels tinted; set on every third analysis.
        var thumbnail: CGImage?
        /// World y of the floor PathGuard used (for clearance measurements); nil when not analysing.
        var floorY: Float? = nil
        /// A curb (drop-off within Tuning.curbContextM) was confirmed in the last Tuning.curbHoldSeconds.
        var atCurb = false
        /// ClosingDetector cost for this frame, ms.
        var closingMs: Double = 0
        /// Walker's horizontal speed, m/s (drop-off time to contact).
        var walkerSpeed: Float = 0
    }

    enum Status { case on, back, paused, failed }

    static var isSupported: Bool {
        ARWorldTrackingConfiguration.isSupported && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    }

    /// Every camera frame (60 Hz), with the camera-to-world transform.
    var onPose: ((simd_float4x4) -> Void)?
    /// Every camera frame, synchronously on the ARSession delegate queue. Copy what you need and return
    /// quickly; NEVER retain the frame or its buffers (ARKit stops delivering frames).
    var onFrame: ((ARFrame) -> Void)?
    var onOutput: ((Output) -> Void)?
    /// Said once per transition: on (first time active), paused (not normal within 3 s of start, or later lost for Tuning.trackingPauseSeconds),
    /// back (after an announced pause), failed.
    var onStatus: ((Status) -> Void)?
    /// World tracking was (re)started: earlier world points and announcements no longer mean anything.
    var onReset: (() -> Void)?

    private let log = Logger(subsystem: "net.babigian.stepsafe", category: "sensors")
    /// Shared with Scout's camera preview (ARSCNView.session); the delegate stays this object.
    let session = ARSession()
    private let frameQueue = DispatchQueue(label: "net.babigian.stepsafe.frames", qos: .userInitiated)
    private let analysisQueue = DispatchQueue(label: "net.babigian.stepsafe.analysis", qos: .userInitiated)
    private let generationLock = OSAllocatedUnfairLock(initialState: 0)

    /// Bumped on start, stop, pause (tracking lost / interrupted / failed), resume and reset.
    var generation: Int { generationLock.withLock { $0 } }
    @discardableResult private func bumpGeneration() -> Int { generationLock.withLock { $0 += 1; return $0 } }

    // frameQueue state
    private var busy = false
    private var lastAnalysis: TimeInterval = 0
    private var fps: Double = 0
    private var trackingNormal = false, interrupted = false, failed = false
    private var active = false, everActive = false, saidPaused = false
    private var debounce = TrackingDebounce()
    private var pauseCheckScheduled = false
    /// Bumped on start and stop: ends the pause-check loop of the previous run.
    private var runToken = 0

    // analysisQueue state
    private var tracker = HazardTracker()
    private var closingDetector = ClosingDetector()
    private var lastCurb = -Double.infinity
    private var analysisCount = 0
    /// Vehicle closing objects from YOLO (nil if the model failed to load). Fed from the delegate queue.
    private let vehicleBox = OSAllocatedUnfairLock<VehicleDetector?>(initialState: nil)
    var vehicles: VehicleDetector? { vehicleBox.withLock { $0 } }


    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = frameQueue
        // Loading and compiling the Core ML model takes seconds: never on the main thread.
        DispatchQueue.global(qos: .utility).async {
            let detector = VehicleDetector()
            self.vehicleBox.withLock { $0 = detector }
        }
    }

    /// `resumed`: restarting after an interruption, so coming back to normal tracking says "back".
    func start(resumed: Bool = false) {
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics = [.sceneDepth] // raw depth: the thresholds were tuned on raw depth
        config.planeDetection = [.horizontal]
        config.worldAlignment = .gravityAndHeading
        // Default video format is the wide camera. Field test: ARKit offers no ultra wide format with scene depth.
        let gen = bumpGeneration()
        frameQueue.async {
            self.busy = false; self.lastAnalysis = 0; self.fps = 0
            self.trackingNormal = false; self.interrupted = false; self.failed = false
            self.active = false
            self.debounce.reset()
            self.runToken += 1
            // Resuming after an interruption keeps what was said: an interruption before the first active
            // state must still say "on" (not "back") later, and a "paused" already said is not repeated.
            if !resumed { self.everActive = false; self.saidPaused = false }
        }
        analysisQueue.async { self.tracker = HazardTracker(); self.closingDetector.reset(); self.lastCurb = -.infinity }
        vehicles?.reset()
        onReset?()
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        frameQueue.asyncAfter(deadline: .now() + 3) {
            // Not tracking normally 3 s after start: tell the walker.
            guard self.generation == gen, !self.active, !self.failed, !self.saidPaused else { return }
            self.saidPaused = true
            self.onStatus?(.paused)
        }
    }

    func stop() {
        bumpGeneration()
        frameQueue.async { self.runToken += 1; self.debounce.reset() }
        session.pause()
    }

    // MARK: Session state (all on frameQueue)

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        if case .normal = camera.trackingState { trackingNormal = true } else { trackingNormal = false }
        log.info("tracking state \(String(describing: camera.trackingState), privacy: .public)")
        updateActive()
    }

    func sessionWasInterrupted(_ session: ARSession) {
        log.info("session interrupted")
        interrupted = true
        updateActive()
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        log.info("session interruption ended, resetting tracking")
        start(resumed: true) // world points from before the interruption are not trustworthy
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        log.error("session failed: \(error.localizedDescription, privacy: .public)")
        failed = true
        updateActive()
        onStatus?(.failed)
    }

    private func updateActive() {
        let now = trackingNormal && !interrupted && !failed
        guard now != active else { return }
        active = now
        bumpGeneration() // in-flight analysis from before this change is dropped
        busy = false
        if now {
            // Every return to normal tracking: world points may have jumped, so forget announcements and restart
            // the confirm filters. Only the speech is debounced ("back" follows an announced "paused").
            analysisQueue.async { self.tracker = HazardTracker(); self.closingDetector.reset() }
            onReset?()
            if !everActive { onStatus?(.on) } else if saidPaused { onStatus?(.back) }
            everActive = true
            saidPaused = false
            checkPause()
        } else {
            // Stale hazards must not linger while nothing is being measured: analysis stops at once.
            analysisQueue.async { self.tracker = HazardTracker(); self.closingDetector.reset() }
            vehicles?.reset()
            onOutput?(Output(generation: generation, confirmed: [:], fps: 0, floorSource: .estimate, thumbnail: nil))
            checkPause()
        }
    }

    /// Runs the pause debounce now and every 0.1 s while an episode is open (frameQueue).
    private func checkPause() {
        if debounce.step(active: active, now: ProcessInfo.processInfo.systemUptime), !failed, !saidPaused {
            saidPaused = true
            onStatus?(.paused)
        }
        guard debounce.episodeOpen, !pauseCheckScheduled else { return }
        pauseCheckScheduled = true
        let token = runToken
        frameQueue.asyncAfter(deadline: .now() + 0.1) {
            self.pauseCheckScheduled = false
            // Started or stopped since: this loop belongs to the old run; continue only for an episode of the
            // new run (stop resets the debounce, so nothing is said after Stop).
            guard self.runToken == token || self.debounce.episodeOpen else { return }
            self.checkPause()
        }
    }

    // MARK: Frames

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let transform = frame.camera.transform
        onPose?(transform)
        onFrame?(frame)
        // After the depth copy below (defer): depth is admitted and copied first; the vehicle input is a
        // downscaled copy at Tuning.vehicleHz, and the frame is never kept.
        defer { if active { vehicles?.submit(frame) } }

        let dt = frame.timestamp - lastAnalysis
        guard active, !busy, dt >= 1 / Tuning.analysisHz,
              let depth = frame.sceneDepth, let confidenceMap = depth.confidenceMap else { return }
        if lastAnalysis > 0 { fps = fps == 0 ? 1 / dt : fps * 0.9 + 0.1 / dt }
        lastAnalysis = frame.timestamp

        // Copy everything we need; the ARFrame is not captured past this point.
        let (depthValues, w, h) = Self.copy(depth.depthMap, as: Float.self)
        let (confidence, _, _) = Self.copy(confidenceMap, as: UInt8.self)
        let planes = frame.anchors.compactMap { $0 as? ARPlaneAnchor }
            .filter { $0.alignment == .horizontal }
            .map(Self.floorPlane)
        let cam = SIMD3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        let floor = PathGuard.floor(planes: planes, camera: cam)
        var k = frame.camera.intrinsics
        let sx = Float(w) / Float(frame.camera.imageResolution.width)
        let sy = Float(h) / Float(frame.camera.imageResolution.height)
        k.columns.0.x *= sx; k.columns.2.x *= sx
        k.columns.1.y *= sy; k.columns.2.y *= sy
        let input = DepthFrame(depth: depthValues, confidence: confidence, width: w, height: h,
                               intrinsics: k, cameraTransform: transform, floorY: floor.y,
                               floorIsEstimate: floor.source.usesEstimateRules)
        let time = frame.timestamp, fps = fps, gen = generation

        busy = true
        analysisQueue.async {
            defer { self.frameQueue.async { if self.generation == gen { self.busy = false } } }
            guard self.generation == gen else { return }
            self.analysisCount += 1
            let wantThumbnail = self.analysisCount % 3 == 0
            let result = PathGuard.analyze(input, wantLabels: wantThumbnail)
            var confirmed = self.tracker.update(result.detections, time: time)
            // Crossing assist: any object closing fast (depth) or a vehicle closing (YOLO). Not debounced by the
            // tracker: the detector already needs a steady 0.3 s window, and a closing object is priority 1.
            if let drop = confirmed[.dropOff], drop.ahead <= Tuning.curbContextM { self.lastCurb = time }
            let atCurb = time - self.lastCurb <= Tuning.curbHoldSeconds
            let start = DispatchTime.now().uptimeNanoseconds
            var closing = self.closingDetector.update(input, time: time)
            let closingMs = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
            // Vehicles predicted to pass beside count only at a curb, and only with TTC < 3 s (already gated).
            closing += (self.vehicles?.closing(now: time) ?? []).filter { !$0.passing || atCurb }
            if let c = closing.min(by: { ($0.passing ? 1 : 0, $0.ttc) < ($1.passing ? 1 : 0, $1.ttc) }) {
                confirmed[.closing] = Detection(kind: .closing, point: c.point, ahead: c.range, lateral: c.lateral,
                                                pointCount: 0, closing: .init(speed: c.speed, ttc: c.ttc, label: c.label,
                                                                              trackId: c.trackId, missM: c.missM,
                                                                              passing: c.passing))
            }
            let walkerSpeed = self.closingDetector.walkerSpeed
            guard self.generation == gen else { return }
            self.onOutput?(Output(generation: gen, confirmed: confirmed, fps: fps, floorSource: floor.source,
                                  thumbnail: wantThumbnail ? Self.thumbnail(input, result.labels) : nil,
                                  floorY: floor.y, atCurb: atCurb, closingMs: closingMs, walkerSpeed: walkerSpeed))
        }
    }

    /// ARKit plane -> world-space centre, extent and yaw for PathGuard.floor.
    private static func floorPlane(_ a: ARPlaneAnchor) -> FloorPlane {
        let t = a.transform
        let c = t * SIMD4(a.center, 1)
        let anchorYaw = atan2(-t.columns.0.z, t.columns.0.x)
        return FloorPlane(y: t.columns.3.y, isFloor: a.classification == .floor, centerX: c.x, centerZ: c.z,
                          yaw: anchorYaw + a.planeExtent.rotationOnYAxis,
                          width: a.planeExtent.width, depth: a.planeExtent.height)
    }

    private static func copy<T>(_ buffer: CVPixelBuffer, as: T.Type) -> ([T], Int, Int) {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let rowBytes = CVPixelBufferGetBytesPerRow(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return ([], 0, 0) }
        let out = [T](unsafeUninitializedCapacity: w * h) { dst, n in
            for row in 0..<h {
                memcpy(dst.baseAddress! + row * w, base + row * rowBytes, w * MemoryLayout<T>.stride)
            }
            n = w * h
        }
        return (out, w, h)
    }

    /// Grey = depth (near is bright), blue = lane box, orange = hazard pixels.
    private static func thumbnail(_ f: DepthFrame, _ labels: [UInt8]) -> CGImage? {
        var rgba = [UInt8](repeating: 255, count: f.width * f.height * 4)
        for i in 0..<(f.width * f.height) {
            let d = f.depth[i]
            let grey = UInt8(d > 0 ? 30 + 200 * max(0, min(1, 1 - d / 5)) : 0)
            var c = (grey, grey, grey)
            switch labels.isEmpty ? PixelLabel.none : labels[i] {
            case PixelLabel.lane: c = (grey / 3, UInt8(min(255, Int(grey / 2) + 64)), 245)
            case PixelLabel.obstacle, PixelLabel.dropOff: c = (255, 121, 0)
            default: break
            }
            (rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) = c
        }
        guard let provider = CGDataProvider(data: Data(rgba) as CFData) else { return nil }
        return CGImage(width: f.width, height: f.height, bitsPerComponent: 8, bitsPerPixel: 32,
                       bytesPerRow: f.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }
}
