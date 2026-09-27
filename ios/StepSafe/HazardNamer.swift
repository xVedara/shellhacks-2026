import ARKit
import CoreImage
import UIKit
import os

/// Crops out of ARFrame.capturedImage in two steps: `copyRegion` (plain memcpy into a new buffer, on the
/// queue that owns the frame, so nothing keeps the frame) and `render` (rotate upright, scale, on a utility queue).
enum FrameCrop {
    private static let context = CIContext()

    /// First CIContext render compiles kernels; do it before the first report needs it.
    static func warmUp() {
        DispatchQueue.global(qos: .utility).async {
            let r = CGRect(x: 0, y: 0, width: 2, height: 2)
            _ = context.createCGImage(CIImage(color: .black).cropped(to: r), from: r)
        }
    }

    /// Copies `rect` (image pixels, origin top-left) out of a 4:2:0 bi-planar buffer (ARKit's capturedImage)
    /// into a new buffer. Origin and size are made even (chroma is 2x2 subsampled). memcpy only.
    static func copyRegion(_ src: CVPixelBuffer, rect: CGRect) -> CVPixelBuffer? {
        let fmt = CVPixelBufferGetPixelFormatType(src)
        guard fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
              CVPixelBufferGetPlaneCount(src) == 2 else { return nil }
        let x = max(0, Int(rect.minX)) & ~1, y = max(0, Int(rect.minY)) & ~1
        let w = Int(rect.width) & ~1, h = Int(rect.height) & ~1
        guard w >= 8, h >= 8, x + w <= CVPixelBufferGetWidth(src), y + h <= CVPixelBufferGetHeight(src) else { return nil }
        var out: CVPixelBuffer?
        guard CVPixelBufferCreate(nil, w, h, fmt, nil, &out) == kCVReturnSuccess, let dst = out else { return nil }
        CVPixelBufferLockBaseAddress(src, .readOnly)
        CVPixelBufferLockBaseAddress(dst, [])
        defer {
            CVPixelBufferUnlockBaseAddress(dst, [])
            CVPixelBufferUnlockBaseAddress(src, .readOnly)
        }
        for plane in 0..<2 {
            let div = plane == 0 ? 1 : 2 // chroma rows/columns are halved
            let bytesPerPixel = plane == 0 ? 1 : 2 // Y8, then interleaved CbCr
            guard let s = CVPixelBufferGetBaseAddressOfPlane(src, plane),
                  let d = CVPixelBufferGetBaseAddressOfPlane(dst, plane) else { return nil }
            let sRow = CVPixelBufferGetBytesPerRowOfPlane(src, plane), dRow = CVPixelBufferGetBytesPerRowOfPlane(dst, plane)
            for r in 0..<(h / div) {
                memcpy(d + r * dRow, s + (y / div + r) * sRow + x / div * bytesPerPixel, w / div * bytesPerPixel)
            }
        }
        return dst
    }

    /// Upright for a portrait phone (back camera: 90 degrees clockwise), long side 320 px. Any queue.
    static func render(_ region: CVPixelBuffer) -> CGImage? {
        var image = CIImage(cvPixelBuffer: region).oriented(.right)
        let s = CropMath.scale(for: image.extent.size)
        image = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
        let e = image.extent // round, not .integral: 280 px * (320/280) must stay 320, not 321
        return context.createCGImage(image, from: CGRect(x: e.minX.rounded(), y: e.minY.rounded(),
                                                         width: e.width.rounded(), height: e.height.rounded()))
    }

    static func jpeg(_ image: CGImage) -> Data? {
        UIImage(cgImage: image).jpegData(compressionQuality: MapTuning.cropJPEGQuality)
    }
}

/// Walker mode hazard naming (PLAN.md 3.1 item 3, 7 "Hazard naming and placement"): each confirmed hazard
/// identity is reported once. Safety never waits on it: path guard has already warned with its own phrase;
/// the returned label is spoken later as priority 3, and only when it is a real name (a merge into a named pin).
/// `update`/`reset` on main; `capture` on the ARSession delegate queue.
final class HazardNamer: @unchecked Sendable { // main-confined state; tasks hop back to main
    private struct Request {
        var detection: Detection
        var fix: Geo.Fix
        var heading: Double?
        var clearanceM: Double?
        /// Epoch when the request was queued: checked before the pixel copy and before every POST.
        var epoch: Int
    }

    private let api: APIClient
    private let localizer: Localizer
    private let log = Logger(subsystem: "net.babigian.stepsafe", category: "namer")
    private let encodeQueue = DispatchQueue(label: "net.babigian.stepsafe.namer", qos: .utility)
    private var gate = ReportGate() // main
    private var stillness = StillnessGate() // main
    private var latest: [HazardKind: Detection] = [:] // main
    private var tasks: [UUID: Task<Void, Never>] = [:] // main
    private let pending = OSAllocatedUnfairLock<[Request]>(initialState: [])
    /// Bumped on start, stop and AR reset: captures, encodes and POSTs from an older epoch are dropped.
    private let epoch = OSAllocatedUnfairLock(initialState: 0)
    private let walking = OSAllocatedUnfairLock(initialState: false)
    private var now: Double { ProcessInfo.processInfo.systemUptime }

    /// Last report result for the debug panel (main).
    var onResult: ((String) -> Void)?
    /// Speak a label (server phrase, any hazard alert cuts it off) (main).
    /// `onDrop` runs if the phrase never starts. Naming does not retry the POST for that.
    var speak: ((String, _ onDrop: @escaping () -> Void) -> Void)?
    private var taxonomy: [HazardTypeEntry]?
    private let lang = TTSChoice.lang()
    /// A report succeeded: the pin id this device created or merged into (main).
    var onReported: ((String) -> Void)?

    init(api: APIClient, localizer: Localizer) {
        self.api = api
        self.localizer = localizer
    }

    func start() {
        walking.withLock { $0 = true }
        epoch.withLock { $0 += 1 }
        FrameCrop.warmUp()
        let api = api
        Task {
            let entries = try? await api.getTaxonomy()
            DispatchQueue.main.async { if let entries { self.taxonomy = entries } }
        }
    }

    /// Walking stopped: drop queued captures and cancel in-flight POSTs.
    func stop() {
        walking.withLock { $0 = false }
        epoch.withLock { $0 += 1 }
        pending.withLock { $0 = [] }
        stillness.reset()
        tasks.values.forEach { $0.cancel() }
        tasks = [:]
    }

    /// After every analysis output. `pins` = MapSync's latest /near rows.
    func update(_ confirmed: [HazardKind: Detection], floorY: Float?, pins: [NearHazard]) {
        latest = confirmed
        let still = stillness.update(confirmed)
        for d in confirmed.values where gate.isNew(d, now: now) {
            guard let fix = localizer.locate(d.point) else { continue } // no GPS yet: retry next output
            switch ReportGate.next(d, fix: fix, pins: pins, still: still) {
            case .wait: continue // moving, or not still for long enough yet: no POST
            case let .known(pin):
                gate.mark(d)
                gate.succeeded(d) // the map already has it
                guard pin.isNamed else { // "obstacle" / "drop-off": path guard already said as much
                    onResult?("Known pin, not named yet, not reported")
                    continue
                }
                let name = lang == "es"
                    ? Taxonomy.displayName(type: pin.type, label: pin.label, in: taxonomy, lang: "es")
                    : pin.spokenName
                onResult?("Known pin \(name), not reported")
                speak?(Spoken.named(name, d, lang: lang)) { }
                continue
            case .post: break
            }
            gate.mark(d) // in flight until the POST succeeds or its retries fail
            let clearance = d.kind == .headHeight ? floorY.map { Double(d.point.y - $0) } : nil
            let req = Request(detection: d, fix: fix, heading: localizer.heading, clearanceM: clearance,
                              epoch: epoch.withLock { $0 })
            pending.withLock { $0.append(req) }
        }
    }

    func reset() {
        gate.reset()
        stillness.reset()
        latest = [:]
        epoch.withLock { $0 += 1 }
        pending.withLock { $0 = [] }
    }

    /// ARSession delegate queue, every frame. Only copies the crop's pixels; never retains the frame.
    func capture(_ frame: ARFrame) {
        let requests = pending.withLock { r -> [Request] in defer { r = [] }; return r }
        guard !requests.isEmpty else { return }
        let camera = frame.camera
        let t = camera.transform
        let size = camera.imageResolution
        let ep = epoch.withLock { $0 }
        for req in requests where req.epoch == ep { // queued before a reset/stop: its world point is stale
            let d = req.detection
            let corners = HazardBox.corners(d, cameraTransform: t).filter { HazardBox.inFront($0, cameraTransform: t) }
            let points = corners.map { camera.projectPoint($0, orientation: .landscapeRight, viewportSize: size) }
            let center = HazardBox.inFront(d.point, cameraTransform: t)
                ? camera.projectPoint(d.point, orientation: .landscapeRight, viewportSize: size)
                : CGPoint(x: size.width / 2, y: size.height / 2)
            guard let rect = CropMath.box(points, center: center, imageSize: size),
                  let region = FrameCrop.copyRegion(frame.capturedImage, rect: rect) else {
                DispatchQueue.main.async { self.gaveUp(req, ep, "No crop for \(d.kind.band) hazard") }
                continue
            }
            encodeQueue.async {
                let jpeg = FrameCrop.render(region).flatMap(FrameCrop.jpeg)
                DispatchQueue.main.async {
                    guard let jpeg else { return self.gaveUp(req, ep, "Crop encode failed") }
                    self.post(req, jpeg, ep)
                }
            }
        }
    }

    /// Dropped (stopped, reset or cancelled): forget the task and the gate entry so it can be reported again.
    private func abandon(_ req: Request, _ id: UUID) {
        tasks[id] = nil
        gate.forget(req.detection)
    }

    private func gaveUp(_ req: Request, _ ep: Int, _ message: String) {
        guard epoch.withLock({ $0 }) == ep else { return }
        gate.failed(req.detection, now: now)
        onResult?(message)
    }

    /// Main. POST with up to 2 retries (2 s, 4 s) on transport errors, 429 and 5xx.
    private func post(_ req: Request, _ jpeg: Data, _ ep: Int) {
        let id = UUID()
        tasks[id] = Task { [api] in
            var failures = 0
            while true {
                // Right before every POST: same session epoch and still walking, else drop the report.
                guard !Task.isCancelled, self.epoch.withLock({ $0 }) == req.epoch, self.walking.withLock({ $0 }) else {
                    DispatchQueue.main.async { self.abandon(req, id) }
                    return
                }
                do {
                    let r = try await api.report(crop: jpeg, lat: req.fix.lat, lng: req.fix.lng, heading: req.heading,
                                                 heightBand: req.detection.kind.band, clearanceM: req.clearanceM)
                    DispatchQueue.main.async { self.reported(req, r, ep, id) }
                    return
                } catch {
                    if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                        DispatchQueue.main.async { self.abandon(req, id) }
                        return
                    }
                    failures += 1
                    let status = (error as? APIClient.ServerError)?.status
                    self.log.error("report failed (\(failures)): \(error.localizedDescription, privacy: .public)")
                    guard let delay = ReportGate.retryDelay(failures: failures, status: status) else {
                        DispatchQueue.main.async {
                            self.tasks[id] = nil
                            self.gaveUp(req, ep, "Report failed: \(error.localizedDescription)")
                        }
                        return
                    }
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1e9))
                }
            }
        }
    }

    private func reported(_ req: Request, _ r: APIClient.ReportResult, _ ep: Int, _ id: UUID) {
        tasks[id] = nil
        let pinned = !r.id.isEmpty // empty id: the server does not pin people or dogs
        if pinned { onReported?(r.id) }
        onResult?("\(r.merged ? "Merged" : pinned ? "New" : "Not pinned"): \(r.label)")
        guard epoch.withLock({ $0 }) == ep else { return }
        gate.answered(req.detection, pinned: pinned, now: now)
        guard !Spoken.isGeneric(r.label) else { return } // a new pin: named later, reaches walkers via heads-up
        // Speak only while path guard still sees it (distance and side from the latest detection).
        if let now = latest[req.detection.kind],
           simd_distance(now.point, req.detection.point) <= 2 * Tuning.sameHazardRadius {
            let name = Taxonomy.localize(r.label, lang: lang, in: taxonomy)
            speak?(Spoken.named(name, now, lang: lang)) { }
        }
    }
}
