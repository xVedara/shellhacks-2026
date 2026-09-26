import Foundation
import os
#if canImport(UIKit)
import UIKit
#endif

/// The StepSafe server (PLAN.md section 6, server/README.md). Nothing here is on the safety path:
/// callers never wait on it before warning the walker. Thread-safe; completion work is the caller's.
final class APIClient {
    static let defaultBaseURL = "http://192.168.81.233:8787" // the Mac on the venue LAN
    static let baseURLKey = "serverURL"

    struct ReportResult: Decodable { var id: String; var label: String; var merged: Bool }
    struct VoteResult: Decodable { var confidence: Double; var status: String }
    struct ReclassifyResult: Decodable { var applied: Bool; var agreeing: Int }
    struct ServerError: Error, LocalizedError {
        var status: Int
        var code: String
        var errorDescription: String? { "HTTP \(status) \(code)" }
    }

    /// Reachability as last observed: true after any HTTP response, false after a transport error.
    var onReachability: ((Bool) -> Void)?

    var baseURL: URL {
        let s = UserDefaults.standard.string(forKey: Self.baseURLKey)?.trimmingCharacters(in: .whitespaces)
        return URL(string: (s?.isEmpty == false ? s! : Self.defaultBaseURL)) ?? URL(string: Self.defaultBaseURL)!
    }

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

    /// `type` must be a taxonomy id (GET /taxonomy), else the server answers 400.
    func reclassify(_ id: String, type: String) async throws -> ReclassifyResult {
        try await send("POST", "/hazards/\(id)/reclassify", body: ["type": type, "deviceId": deviceId])
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
            let code = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw ServerError(status: http.statusCode, code: code ?? "error")
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
