import Foundation
import os
#if canImport(UIKit)
import UIKit
#endif

/// The StepSafe server (PLAN.md section 6, server/README.md). Nothing here is on the safety path:
/// callers never wait on it before warning the walker. Thread-safe; completion work is the caller's.
final class APIClient {
    /// The only server the app talks to: the Jetson behind the Cloudflare tunnel. Not user-configurable.
    static let baseURL = URL(string: "https://api.stepsafe.miami")!

    struct ReportResult: Decodable { var id: String; var label: String; var merged: Bool }
    struct VoteResult: Decodable { var confidence: Double; var status: String }
    struct ReclassifyResult: Decodable { var applied: Bool; var agreeing: Int }
    struct ServerError: Error, LocalizedError {
        var status: Int
        var code: String
        /// The server's `message` on a 400 (e.g. "hazard cleared").
        var message: String? = nil
        var errorDescription: String? { "HTTP \(status) \(code)" }
    }

    /// Reachability as last observed: true after any HTTP response, false after a transport error.
    var onReachability: ((Bool) -> Void)?

    var baseURL: URL { Self.baseURL }

    /// identifierForVendor, matching the server's ^[A-Za-z0-9._:-]{1,128}$.
    let deviceId: String = {
        #if canImport(UIKit)
        if let id = UIDevice.current.identifierForVendor?.uuidString { return id }
        #endif
        let key = "fallbackDeviceId"
        if let id = UserDefaults.standard.string(forKey: key) { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: key)
        return id
    }()

    private let session = URLSession(configuration: .ephemeral)
    private let taxonomyCache = OSAllocatedUnfairLock<[HazardTypeEntry]?>(initialState: nil)

    /// GET /taxonomy, fetched once per session (only a successful answer is cached).
    func getTaxonomy() async throws -> [HazardTypeEntry] {
        if let cached = taxonomyCache.withLock({ $0 }) { return cached }
        let entries: [HazardTypeEntry] = try await send("GET", "/taxonomy")
        taxonomyCache.withLock { $0 = entries }
        return entries
    }

    func report(crop: Data, lat: Double, lng: Double, heading: Double?, heightBand: String,
                clearanceM: Double? = nil, widthM: Double? = nil) async throws -> ReportResult {
        var body: [String: Any] = [
            "crop": crop.base64EncodedString(), "lat": lat, "lng": lng, "heading": heading ?? NSNull(),
            "heightBand": heightBand, "deviceId": deviceId,
        ]
        var m: [String: Double] = [:]
        if let clearanceM { m["clearanceM"] = clearanceM }
        if let widthM { m["widthM"] = widthM }
        if !m.isEmpty { body["measurements"] = m }
        return try await send("POST", "/hazards", body: body, timeout: 20) // naming model can take ~15 s
    }

    func near(lat: Double, lng: Double, radiusM: Double, heading: Double?) async throws -> [NearHazard] {
        var q = [URLQueryItem(name: "lat", value: "\(lat)"), URLQueryItem(name: "lng", value: "\(lng)"),
                 URLQueryItem(name: "radius_m", value: "\(Int(radiusM))")]
        if let heading { q.append(URLQueryItem(name: "heading", value: String(format: "%.0f", heading))) }
        return try await send("GET", "/hazards/near", query: q)
    }

    func vote(_ id: String, up: Bool, source: String) async throws -> VoteResult {
        try await send("POST", "/hazards/\(id)/votes", body: ["vote": up ? "up" : "down", "source": source, "deviceId": deviceId])
    }

    /// `type` must be a taxonomy id (GET /taxonomy), else the server answers 400. At least one field is required;
    /// the server applies the proposal once 3 devices sent the same one.
    func reclassify(_ id: String, type: String? = nil, category: String? = nil, heightBand: String? = nil) async throws -> ReclassifyResult {
        var body: [String: Any] = ["deviceId": deviceId]
        if let type { body["type"] = type }
        if let category { body["category"] = category }
        if let heightBand { body["heightBand"] = heightBand }
        return try await send("POST", "/hazards/\(id)/reclassify", body: body)
    }

    func hazard(_ id: String) async throws -> HazardDetail {
        try await send("GET", "/hazards/\(id)", timeout: 10)
    }

    /// Flag a pin: reason is "spam", "abuse" or "other". One open report per device (a second one replaces it).
    func report(_ id: String, reason: String) async throws {
        struct OK: Decodable { var ok: Bool }
        let _: OK = try await send("POST", "/hazards/\(id)/report", body: ["reason": reason, "deviceId": deviceId])
    }

    func user() async throws -> UserInfo {
        try await send("GET", "/users/\(deviceId)")
    }

    /// GET /events (SSE): `.open` once connected, then hazard upserts/removals. Finishes or throws when the
    /// connection drops; the caller reconnects. Cancelling the consumer closes the connection.
    func events() -> AsyncThrowingStream<Community.Event, Error> {
        let session = session, url = baseURL.appendingPathComponent("/events")
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var req = URLRequest(url: url, timeoutInterval: 40) // idle timeout; the server pings every 15 s
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    let (bytes, resp) = try await session.bytes(for: req)
                    guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
                        throw ServerError(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, code: "events")
                    }
                    continuation.yield(.open)
                    var parser = Community.SSEParser()
                    for try await line in bytes.lines {
                        if let e = parser.feed(line) { continuation.yield(e) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Raw GET /tts response: status, content type, body. Throws only on transport errors.
    func tts(text: String, lang: String, timeout: Double) async throws -> (Int, String?, Data) {
        let (data, http) = try await raw("GET", "/tts", query: [URLQueryItem(name: "text", value: text),
                                                                URLQueryItem(name: "lang", value: lang)],
                                         body: nil, timeout: timeout)
        return (http.statusCode, http.value(forHTTPHeaderField: "Content-Type"), data)
    }

    // MARK: Plumbing

    private func send<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [],
                                    body: [String: Any]? = nil, timeout: Double = 5) async throws -> T {
        let (data, http) = try await raw(method, path, query: query, body: body, timeout: timeout)
        guard (200..<300).contains(http.statusCode) else {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw ServerError(status: http.statusCode, code: json?["error"] as? String ?? "error",
                              message: json?["message"] as? String)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func raw(_ method: String, _ path: String, query: [URLQueryItem], body: [String: Any]?,
                     timeout: Double) async throws -> (Data, HTTPURLResponse) {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!, timeoutInterval: timeout)
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        do {
            let (data, resp) = try await session.data(for: req)
            onReachability?(true)
            return (data, resp as! HTTPURLResponse)
        } catch {
            onReachability?(false)
            throw error
        }
    }
}
