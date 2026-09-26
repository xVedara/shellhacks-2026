/// When to say "Path guard paused" (pure, unit-tested). An episode starts at the first loss of normal
/// tracking and ends only after tracking has stayed normal for Tuning.trackingPauseSeconds. "Paused" is said
/// once per episode, at a lost step at least trackingPauseSeconds after the episode began: a single short
/// blip stays quiet, but tracking that keeps flapping still gets announced.
struct TrackingDebounce {
    private(set) var lostSince: Double?
    private var normalSince: Double?
    private var announced = false

    var episodeOpen: Bool { lostSince != nil }

    /// Feed on every state change and periodically while an episode is open. True = say "paused" now.
    mutating func step(active: Bool, now: Double) -> Bool {
        if active {
            if normalSince == nil { normalSince = now }
            if let n = normalSince, lostSince != nil, now - n >= Tuning.trackingPauseSeconds {
                lostSince = nil
                announced = false
            }
            return false
        }
        normalSince = nil
        if lostSince == nil { lostSince = now }
        guard !announced, let l = lostSince, now - l >= Tuning.trackingPauseSeconds else { return false }
        announced = true
        return true
    }

    mutating func reset() { self = TrackingDebounce() }
}
