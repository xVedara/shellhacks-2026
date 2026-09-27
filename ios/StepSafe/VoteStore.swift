import Combine
import Foundation

/// One vote per hazard per device, shared by the Community and Scout tabs. UserDefaults is the only copy: every
/// read goes to it and every vote is merged into it, so a vote cast in one tab is seen by the other at once and
/// no save can overwrite votes it did not know about.
final class VoteStore: ObservableObject {
    static let shared = VoteStore()
    static let key = "communityVotes"

    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private var all: [String: String] { defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:] }

    /// "up" / "down" once this device voted on hazard `id`, else nil.
    func vote(_ id: String) -> String? { all[id] }

    func record(_ id: String, up: Bool) {
        objectWillChange.send()
        var merged = all // read-merge-write: never save a stale copy
        merged[id] = up ? "up" : "down"
        defaults.set(merged, forKey: Self.key)
    }
}
