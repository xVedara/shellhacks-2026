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

    // MARK: Analysis rate
    static let analysisHz: Double = 12

    // MARK: Alerts
    /// A drop-off this close is priority 1 (tone + haptic, never muted); farther is priority 2.
    static let dropUrgentDistance: Float = 2.0
    /// The same hazard is not repeated within this window...
    static let repeatWindow: Double = 30
    /// ...unless the user gets this close (re-announced once).
    static let repeatCloseDistance: Float = 2.0
    /// Same kind within this distance of the point where it was first announced = the same hazard.
    static let sameHazardRadius: Float = 0.75
    /// Lateral offset beyond which a hazard is spoken as "left"/"right" instead of "ahead".
    static let sideDeadband: Float = 0.15

    // MARK: Controls
    static let doublePressWindow: Double = 2
    static let muteDuration: Double = 5 * 60
}
