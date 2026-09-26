import ARKit
import CoreML
import VideoToolbox
import Vision
import os

/// Vehicles beyond LiDAR range (crossing assist, PLAN.md section 7): YOLO11n (Ultralytics, AGPL-3.0, see
/// ios/CREDITS.md) through Vision at about Tuning.vehicleHz on its own queue. The ARSession delegate queue only
/// copies the camera pixels (FrameCrop.copyRegion) and pose; the ARFrame is never kept. An IoU tracker turns box
/// growth into closing speed (BoxTracker.closing), with the walker's own motion subtracted.
final class VehicleDetector {
    private struct Input {
        var pixels: CVPixelBuffer
        var time: Double
        var transform: simd_float4x4
        var intrinsics: simd_float3x3
        var size: CGSize
    }

    private let log = Logger(subsystem: "net.babigian.stepsafe", category: "vehicles")
    private let queue = DispatchQueue(label: "net.babigian.stepsafe.vehicles", qos: .utility) // never competes with path guard
    private let request: VNCoreMLRequest
    private static let classes: Set<String> = ["car", "truck", "bus", "motorcycle", "bicycle", "person"]

    // delegate-queue state
    private var lastSubmit = -Double.infinity
    private let busy = OSAllocatedUnfairLock(initialState: false)
    // queue state
    private var tracker = BoxTracker()
    private var lastCam: (t: Double, pos: SIMD3<Float>)?
    private let latest = OSAllocatedUnfairLock<(time: Double, objects: [ClosingObject])>(initialState: (-.infinity, []))
    private let generation = OSAllocatedUnfairLock(initialState: 0)
    /// Last inference time, ms (debug panel).
    private(set) var inferenceMs: Double = 0

    /// nil if the bundled model cannot be loaded (then crossing assist is depth-only).
    init?() {
        guard let url = Bundle.main.url(forResource: "yolo11n", withExtension: "mlmodelc"),
              let ml = try? MLModel(contentsOf: url, configuration: MLModelConfiguration()),
              let vn = try? VNCoreMLModel(for: ml) else { return nil }
        vn.featureProvider = Thresholds()
        request = VNCoreMLRequest(model: vn)
        request.imageCropAndScaleOption = .scaleFill // keep the whole field of view
        // The first inference loads the model onto the Neural Engine (5.5 s on a Mac): do it now, marked busy,
        // so the first real frame is not late.
        busy.withLock { $0 = true }
        queue.async { [request, busy] in
            var blank: CVPixelBuffer?
            CVPixelBufferCreate(nil, 64, 48, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, nil, &blank)
            if let blank { try? VNImageRequestHandler(cvPixelBuffer: blank, orientation: .right).perform([request]) }
            busy.withLock { $0 = false }
        }
    }

    func reset() {
        generation.withLock { $0 += 1 }
        latest.withLock { $0 = (-.infinity, []) }
        queue.async { self.tracker.reset(); self.lastCam = nil }
    }

    /// ARSession delegate queue. Copies the pixels at most Tuning.vehicleHz, and only while idle.
    func submit(_ frame: ARFrame) {
        guard frame.timestamp - lastSubmit >= 1 / Tuning.vehicleHz, !busy.withLock({ $0 }) else { return }
        let size = frame.camera.imageResolution
        guard let pixels = downsample(frame.capturedImage) else { return } // 640 px long side, hardware scaler
        lastSubmit = frame.timestamp
        busy.withLock { $0 = true }
        let input = Input(pixels: pixels, time: frame.timestamp, transform: frame.camera.transform,
                          intrinsics: frame.camera.intrinsics, size: size)
        let gen = generation.withLock { $0 }
        queue.async {
            defer { self.busy.withLock { $0 = false } }
            let objects = self.detect(input)
            guard self.generation.withLock({ $0 }) == gen else { return }
            self.latest.withLock { $0 = (input.time, objects) }
        }
    }

    private var scaler: VTPixelTransferSession?
    /// Reused scaled buffer. `submit` only runs while the previous inference is idle, and `detect` does not
    /// keep the buffer, so the next frame cannot overwrite pixels still being read.
    private var scaled: CVPixelBuffer?

    /// Copy of the camera image scaled to 640 px on the long side (YOLO runs at 640; 1920 px copies cost more).
    private func downsample(_ src: CVPixelBuffer) -> CVPixelBuffer? {
        if scaler == nil { VTPixelTransferSessionCreate(allocator: nil, pixelTransferSessionOut: &scaler) }
        guard let scaler else { return nil }
        let w = CVPixelBufferGetWidth(src), h = CVPixelBufferGetHeight(src)
        let s = 640.0 / Double(max(w, h))
        let dw = Int(Double(w) * s) & ~1, dh = Int(Double(h) * s) & ~1
        let fmt = CVPixelBufferGetPixelFormatType(src)
        if scaled == nil || CVPixelBufferGetWidth(scaled!) != dw || CVPixelBufferGetHeight(scaled!) != dh
            || CVPixelBufferGetPixelFormatType(scaled!) != fmt {
            var out: CVPixelBuffer?
            guard CVPixelBufferCreate(nil, dw, dh, fmt, nil, &out) == kCVReturnSuccess, let dst = out else { return nil }
            scaled = dst
        }
        guard let dst = scaled, VTPixelTransferSessionTransferImage(scaler, from: src, to: dst) == noErr else { return nil }
        return dst
    }

    /// Closing vehicles from the last inference, if it is recent.
    func closing(now: Double) -> [ClosingObject] {
        latest.withLock { now - $0.time <= 0.5 ? $0.objects : [] }
    }

    private func detect(_ input: Input) -> [ClosingObject] {
        let start = DispatchTime.now().uptimeNanoseconds
        // Portrait head mount: the sensor image is landscape, so Vision sees it rotated upright (.right).
        let handler = VNImageRequestHandler(cvPixelBuffer: input.pixels, orientation: .right)
        do { try handler.perform([request]) } catch {
            log.error("yolo failed: \(error.localizedDescription, privacy: .public)")
            return []
        }
        inferenceMs = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
        let boxes: [BoxTracker.Box] = (request.results as? [VNRecognizedObjectObservation] ?? []).compactMap { o in
            guard let top = o.labels.first, Self.classes.contains(top.identifier),
                  top.confidence >= Tuning.vehicleMinConfidence else { return nil }
            let r = o.boundingBox // normalized, origin bottom-left
            return BoxTracker.Box(label: top.identifier, rect: CGRect(x: r.minX, y: 1 - r.maxY, width: r.width, height: r.height),
                                  confidence: top.confidence)
        }
        let t = input.transform
        let rot = t.rotation3
        let k = input.intrinsics
        let cam = t.translation
        let camera = BoxTracker.Camera(fx: k.columns.0.x, fy: k.columns.1.y, cx: k.columns.2.x, cy: k.columns.2.y,
                                       width: Float(input.size.width), height: Float(input.size.height), rotation: rot,
                                       position: cam)
        _ = tracker.update(boxes, time: input.time, camera: camera) // world bearings: head turns cancel out
        var velocity = SIMD2<Float>.zero
        if let last = lastCam, input.time > last.t { velocity = SIMD2(cam.x - last.pos.x, cam.z - last.pos.z) / Float(input.time - last.t) }
        lastCam = (input.time, cam)
        let look = -rot.columns.2
        guard look.x * look.x + look.z * look.z > 1e-4 else { return [] }
        // Candidates, with `passing` set for vehicles predicted to go by; SensorSession keeps those only at a curb.
        return tracker.assess(time: input.time, walker: SIMD2(cam.x, cam.z), walkerVelocity: velocity,
                              forward: simd_normalize(SIMD2(look.x, look.z)))
    }

    /// The exported NMS pipeline takes its thresholds as inputs.
    private final class Thresholds: NSObject, MLFeatureProvider {
        var featureNames: Set<String> { ["iouThreshold", "confidenceThreshold"] }
        func featureValue(for name: String) -> MLFeatureValue? {
            switch name {
            case "iouThreshold": return MLFeatureValue(double: 0.45)
            case "confidenceThreshold": return MLFeatureValue(double: Double(Tuning.vehicleMinConfidence))
            default: return nil
            }
        }
    }
}
