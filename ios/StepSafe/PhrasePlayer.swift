@preconcurrency import AVFoundation
import os

/// Bundled StepSafe-voice clips for fixed alerts and notices (PhraseBook), decoded to AlertManager.clipFormat.
/// AlertManager plays them on its clip node with the same priorities and cut-off rules as the speech they
/// replace; with no clip for the phone's language it speaks the text as before. Thread-safe.
final class PhrasePlayer: @unchecked Sendable {
    private let book: PhraseBook?
    private let lang = TTSChoice.lang()
    private let cache = OSAllocatedUnfairLock<[String: AVAudioPCMBuffer]>(initialState: [:])
    private let warm = DispatchGroup()

    init() {
        book = Bundle.main.url(forResource: "phrases", withExtension: "json", subdirectory: "Phrases")
            .flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? PhraseBook(json: $0) }
        // Priority 1 phrases (drop-offs within 2 m, anything closing) are decoded up front: no decode delay then.
        // Slope phrases too (same distances); clip() returns nil for one not recorded yet, so that costs nothing.
        let urgent = PhraseBook.urgent(book?.entries.map(\.id) ?? [])
        warm.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            urgent.forEach { _ = self.clip("\($0).\(self.lang)") }
            self.warm.leave()
        }
    }

    /// Blocks until every urgent clip is decoded (called before scanning starts; about 0.1-0.5 s at launch).
    func waitUntilReady(timeout: Double = 2) { _ = warm.wait(timeout: .now() + timeout) }

    /// The clip(s) for `text` joined into one buffer after `leadIn` seconds of silence (the tone plays then),
    /// or nil: speak the text instead.
    func buffer(for text: String, leadIn: Double) -> AVAudioPCMBuffer? {
        guard let names = book?.clipNames(for: text, lang: lang, exists: { clip($0) != nil }) else { return nil }
        let clips = names.compactMap(clip)
        let format = AlertManager.clipFormat
        let lead = AVAudioFrameCount(leadIn * format.sampleRate)
        let total = lead + clips.reduce(0) { $0 + $1.frameLength }
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: total) else { return nil }
        let dst = out.floatChannelData![0]
        memset(dst, 0, Int(lead) * MemoryLayout<Float>.size)
        var at = Int(lead)
        for c in clips {
            memcpy(dst + at, c.floatChannelData![0], Int(c.frameLength) * MemoryLayout<Float>.size)
            at += Int(c.frameLength)
        }
        out.frameLength = total
        return out
    }

    private func clip(_ name: String) -> AVAudioPCMBuffer? {
        if let hit = cache.withLock({ $0[name] }) { return hit }
        guard let url = Bundle.main.url(forResource: name, withExtension: "mp3", subdirectory: "Phrases"),
              let buffer = AudioClip.decode(url) else { return nil }
        cache.withLock { $0[name] = buffer }
        return buffer
    }
}

enum AudioClip {
    /// Audio file -> mono float PCM in AlertManager.clipFormat, or nil.
    static func decode(_ url: URL) -> AVAudioPCMBuffer? {
        guard let file = try? AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false),
              let src = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
              (try? file.read(into: src)) != nil, src.frameLength > 0 else { return nil }
        let dst = AlertManager.clipFormat
        if src.format == dst { return trimmed(src) }
        guard let converter = AVAudioConverter(from: src.format, to: dst),
              let out = AVAudioPCMBuffer(pcmFormat: dst, frameCapacity:
                AVAudioFrameCount(Double(src.frameLength) * dst.sampleRate / src.format.sampleRate) + 1024) else { return nil }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .endOfStream; return nil }
            fed = true
            status.pointee = .haveData
            return src
        }
        return error == nil && out.frameLength > 0 ? trimmed(out) : nil
    }

    /// Leading and trailing silence (below -45 dBFS) removed, keeping 10 ms: speech starts right after the tone.
    static func trimmed(_ b: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
        let x = b.floatChannelData![0], n = Int(b.frameLength)
        let threshold: Float = 0.0056 // -45 dBFS
        guard let first = (0..<n).first(where: { abs(x[$0]) > threshold }),
              let last = (0..<n).last(where: { abs(x[$0]) > threshold }) else { return b }
        let pad = Int(0.01 * b.format.sampleRate)
        let start = max(0, first - pad), end = min(n, last + pad + 1)
        guard start > 0 || end < n, let out = AVAudioPCMBuffer(pcmFormat: b.format, frameCapacity: AVAudioFrameCount(end - start)) else { return b }
        memcpy(out.floatChannelData![0], x + start, (end - start) * MemoryLayout<Float>.size)
        out.frameLength = AVAudioFrameCount(end - start)
        return out
    }
}
