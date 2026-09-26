@preconcurrency import AVFoundation
import os

/// Server-voiced audio for spoken labels and heads-ups: GET /tts, cached in memory and on disk by text + lang,
/// decoded to AlertManager.clipFormat so AlertManager plays it through its one AVAudioEngine.
/// Gives up after TTSChoice.timeout (AlertManager then speaks with AVSpeechSynthesizer); a late clip is still
/// cached for next time. Call on the main thread; completions arrive on the main thread.
final class TTSPlayer: @unchecked Sendable { // main-confined; tasks hop back to main
    private let api: APIClient
    private let log = Logger(subsystem: "net.babigian.stepsafe", category: "tts")
    private var memory: [String: AVAudioPCMBuffer] = [:]
    private let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("tts")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    init(api: APIClient) { self.api = api }

    /// The clip for `text`, or nil (speak it instead) on any error or after 3 s.
    func clip(for text: String, completion: @escaping (AVAudioPCMBuffer?) -> Void) {
        let lang = TTSChoice.lang()
        let key = TTSChoice.cacheKey(text: text, lang: lang)
        if let hit = memory[key] { return completion(hit) }
        let file = dir.appendingPathComponent("\(key).mp3")
        if let buffer = Self.decode(file) {
            memory[key] = buffer
            return completion(buffer)
        }
        var done = false
        let finish: (AVAudioPCMBuffer?) -> Void = { b in
            guard !done else { return }
            done = true
            completion(b)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + TTSChoice.timeout) { finish(nil) }
        let start = Date()
        Task {
            let result = try? await api.tts(text: text, lang: lang, timeout: 10)
            let elapsed = Date().timeIntervalSince(start)
            var buffer: AVAudioPCMBuffer?
            if let (status, type, data) = result,
               TTSChoice.useClip(status: status, contentType: type, bytes: data.count, elapsed: 0) { // cache even if late
                try? data.write(to: file, options: .atomic)
                buffer = Self.decode(file)
            }
            let inTime = TTSChoice.useClip(status: result?.0, contentType: result?.1, bytes: result?.2.count ?? 0, elapsed: elapsed)
            let status = result.map { "\($0.0)" } ?? "network error"
            DispatchQueue.main.async {
                if let buffer { self.memory[key] = buffer }
                self.log.info("tts \(status, privacy: .public) in \(elapsed, format: .fixed(precision: 2)) s")
                finish(inTime ? buffer : nil)
            }
        }
    }

    private static func decode(_ url: URL) -> AVAudioPCMBuffer? { AudioClip.decode(url) }
}
