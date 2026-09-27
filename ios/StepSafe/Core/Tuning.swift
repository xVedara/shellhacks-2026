// Source of truth: analysis/params.tuned.json; regenerate with analysis/tune.py.
// (analysis/ lives in the workspace, not in this repo.) Path-guard names are the JSON keys in
// camelCase, so lane_half_width_m -> laneHalfWidthM. The algorithm mirrors analysis/pathguard.py.
// Distances are metres, times are seconds, point counts are full-resolution (256x192) depth pixels.
// "Ahead" is along the walking direction (camera forward flattened); heights are above the floor.

enum Tuning {
    // MARK: Path guard (params.tuned.json)
    static let laneHalfWidthM: Float = 0.35
    static let laneNearM: Float = 0.5
    static let laneFarM: Float = 5.0
    static let groundBandMinM: Float = 0.1
    static let groundBandMaxM: Float = 1.0
    static let headBandMinM: Float = 1.2
    static let headBandMaxM: Float = 2.0
    static let dropoffNearM: Float = 1.0
    static let dropoffFarM: Float = 3.0
    /// A measured point this far below the floor is a drop pixel.
    static let dropoffDepthM: Float = 0.12  // below 0.15 so a standard 15 cm curb fires reliably (float32)
    /// Missing-floor rule: at least this many expected floor pixels in the zone...
    static let dropoffMinExpectedPoints = 200
    /// ...of which at least this share have no valid depth.
    static let dropoffMissingFraction: Float = 0.3
    static let minPointsGround = 60
    static let minPointsHead = 60
    static let minPointsDropoff = 60
    /// Minimum ARConfidenceLevel raw value kept (0 low, 1 medium, 2 high).
    static let minConfidence: UInt8 = 1
    /// PER WEARER: camera (head mount) height above the floor. Only used while no ARKit floor plane
    /// is known: as the floor estimate and to pick the floor plane nearest it
    /// (params.tuned.json fallback_camera_height_m).
    static let cameraHeightM: Float = 1.6
    /// A floor plane counts only if at least this far below the camera (pathguard.py pick_floor).
    static let floorMinBelowCameraM: Float = 0.5
    /// Ground band lower edge while the floor is only the cameraHeightM estimate (instead of groundBandMinM).
    static let estimatedFloorGroundMinM: Float = 0.3
    /// Slack around a plane's extent when deciding whether the walker stands on it.
    static let floorPlaneMarginM: Float = 0.3

    // MARK: Stability, in seconds (the replay's confirm_frames 3 / clear_frames 5 were at 5 Hz)
    /// Confirmed once seen in every analysis frame for this long.
    static let confirmSeconds: Double = 0.4 // replay: 3 frames at 5 Hz = 0.4 s after the first hit
    /// Cleared once unseen for this long.
    static let clearSeconds: Double = 1.0

    /// Tracking must stay lost this long before "Path guard paused" (and forgetting announcements on return).
    static let trackingPauseSeconds: Double = 0.5

    // MARK: Analysis rate
    static let analysisHz: Double = 12

    // MARK: Alerts
    /// A drop-off this close is priority 1 (tone + haptic, never muted); farther is priority 2 (muted by mute, never
    /// cuts head-height words). Time to contact (distance / walker speed) only orders priority-1 alerts.
    static let dropUrgentDistance: Float = 2.0
    /// The same hazard is not repeated within this window...
    static let repeatWindow: Double = 30
    /// ...unless the user gets this close (re-announced once).
    static let repeatCloseDistance: Float = 2.0
    /// Same kind within this distance of the point where it was first announced = the same hazard.
    static let sameHazardRadius: Float = 0.75
    /// Lateral offset beyond which a hazard is spoken as "left"/"right" instead of "ahead".
    static let sideDeadband: Float = 0.15

    // MARK: Crossing assist (ClosingDetector; names for the replay)
    /// Trigger when time to contact is below this...
    static let ttcSeconds: Float = 3.0
    /// ...or a closing object is nearer than this.
    static let closeRangeM: Float = 4.0
    /// Slower than this after subtracting the walker's own motion is not closing (drift, noise, walking to a wall).
    static let minClosingSpeedMps: Float = 0.8
    static let closingHalfFieldDeg: Float = 60
    static let closingMinHeightM: Float = 0.3
    static let closingMaxHeightM: Float = 2.2
    static let closingMaxRangeM: Float = 5.5
    /// A moving object needs at least this many near-surface points.
    static let closingMinPoints = 40
    /// Track velocity (least squares) over this window (spans a head sweep's out-of-view gap).
    static let closingWindowSeconds: Double = 2.0
    /// Sanity cap on a bin's closing rate (m/s). Occlusion jumps are rejected by the track's velocity, not here.
    static let closingMaxSpeedMps: Float = 20
    /// Uncertainty margin on the miss distance before an object counts as passing beside.
    static let closingMissMarginM: Float = 0.25
    /// Consecutive track frames the miss must stay >= closingMissM + margin before suppressing.
    static let closingPassFrames = 4
    /// A depth track survives this long unseen (head sweeps, blank frames).
    static let closingTrackGapSeconds: Double = 1.2
    /// The same closing object (track id) is re-announced after this long while it keeps coming (one clip).
    static let closingRepeatSeconds: Double = 2.5
    /// A playing priority-1 clip plays at least this long before another priority 1 may cut it off.
    static let p1MinPlaySeconds: Double = 0.8
    /// A newcomer must be this much more urgent (TTC) than the playing priority-1 hazard to cut it off.
    static let p1PreemptMarginSeconds: Double = 0.3
    /// "Too late after the clip": a priority 1 that would have less than this left to react once the playing
    /// clip ends may cut it off - a closing object over a drop-off at once, closing vs closing only after
    /// p1MinPlaySeconds and with p1PreemptMarginSeconds. A drop-off never cuts closing words (it queues).
    /// 0.6 s is tuned on the policy sims (curb walk, demo-3 sweep).
    static let p1LeadSeconds: Double = 0.6
    /// Drop-off tone length before its words (AlertManager's drop-off tone: 3 x 0.14 s).
    static let dropOffToneSeconds: Double = 0.42
    /// Words count as heard after this long audible.
    static let heardWordsSeconds: Double = 0.6
    /// A drop-off starting within this of the end of closing words is said as their follow-on ("Drop-off ahead.").
    static let followOnSeconds: Double = 0.35
    /// A deferred closing phrase unspoken this long after the first idle moment is dropped.
    static let pendingClosingSeconds: Double = 2.0
    /// Closing object and drop-off both under this TTC: one combined phrase.
    static let combinedTTCSeconds: Float = 3.5
    /// ...and the closing object's TTC is at most this much longer than the drop-off's.
    static let combineSimilarTTCSeconds: Float = 0.6
    /// Walker speed floor for a drop-off's time to contact (distance / speed).
    static let minWalkerSpeedMps: Float = 0.5
    /// Report only objects whose predicted miss distance at closest approach is below this (they will
    /// plausibly reach the walker); things passing beside raise nothing.
    static let closingMissM: Float = 1.0
    /// "At a curb": a drop-off confirmed within this distance ahead...
    static let curbContextM: Float = 3.0
    /// ...in the last this many seconds (the walker looks left and right before crossing).
    static let curbHoldSeconds: Double = 10
    /// A closing object within this of where it was first announced is the same one (it moves).
    static let closingSameRadiusM: Float = 2.0
    /// Within this angle of the walking direction the side is spoken as "ahead".
    static let closingAheadDeg: Float = 8
    // Vehicles (YOLO11n boxes, beyond LiDAR range)
    static let vehicleHz: Double = 5
    static let vehicleMinConfidence: Float = 0.4
    /// Vehicles need a clearer closing speed: their distance comes from box size, which is noisy.
    static let vehicleMinClosingSpeedMps: Float = 1.5
    /// A closing vehicle whose box spans the walker's heading (widened by the margin) within this range alerts even
    /// when its box-centre miss says it passes (head-on in a parking aisle or driveway, no curb). Walks 18-16-49Z /
    /// 18-19-51Z: 1 more nuisance tag of 34, FA/min unchanged.
    static let vehicleInPathRangeM: Float = 6
    static let vehicleInPathMarginM: Float = 1.0

    // MARK: Community map
    /// Passive walker downvotes (MapRules PassiveVoter): on. The server weighs each one 0.6, so a reporter's weight-1
    /// pin clears only after two different walkers pass it and see nothing (Ara 2026-09-26).
    static let passiveDownvotesEnabled = true

    // MARK: Controls
    static let doublePressWindow: Double = 2
    static let muteDuration: Double = 5 * 60
    /// A queued server phrase (label, heads-up) older than this is dropped: its distance is stale.
    static let serverPhraseMaxWaitSeconds: Double = 3
}
