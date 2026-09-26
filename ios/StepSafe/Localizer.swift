import CoreLocation
import os
import simd

/// AR world point -> lat/lng: the point's east/north offset from the camera (worldAlignment .gravityAndHeading:
/// +x east, -z north) added to the phone's latest GPS fix. Thread-safe.
final class Localizer: NSObject, CLLocationManagerDelegate {
    private struct State {
        var fix: CLLocation?
        var trueHeading: Double?
        var camera: simd_float4x4?
    }

    private let manager = CLLocationManager()
    private let state = OSAllocatedUnfairLock(initialState: State())
    var onFix: ((CLLocation) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .fitness
    }

    func start() {
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
        manager.startUpdatingHeading()
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
    }

    /// Latest AR camera pose (SensorSession.onPose, any thread).
    func setCamera(_ t: simd_float4x4) { state.withLock { $0.camera = t } }

    var fix: Geo.Fix? { state.withLock { $0.fix.map { Geo.Fix(lat: $0.coordinate.latitude, lng: $0.coordinate.longitude) } } }
    /// Horizontal accuracy (m) and age (s) of the latest fix.
    var fixQuality: (accuracyM: Double, ageS: Double)? {
        state.withLock { s in s.fix.map { ($0.horizontalAccuracy, -$0.timestamp.timeIntervalSinceNow) } }
    }
    /// True heading in degrees, or nil when the compass has none.
    var heading: Double? { state.withLock { $0.trueHeading } }
    /// Walking direction for heads-up: the AR camera's flattened forward (true-north aligned), else the compass.
    var walkingHeading: Double? { state.withLock { s in s.camera.flatMap(Geo.cameraHeading) ?? s.trueHeading } }
    var camera: simd_float4x4? { state.withLock { $0.camera } }

    /// The AR world point's lat/lng, or nil with no GPS fix or no camera pose yet.
    func locate(_ point: SIMD3<Float>) -> Geo.Fix? {
        state.withLock { s in
            guard let fix = s.fix, let t = s.camera else { return nil }
            let cam = SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
            return Geo.locate(point, camera: cam,
                              cameraFix: Geo.Fix(lat: fix.coordinate.latitude, lng: fix.coordinate.longitude))
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last, last.horizontalAccuracy >= 0 else { return }
        state.withLock { $0.fix = last }
        onFix?(last)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        let h = newHeading.trueHeading
        state.withLock { $0.trueHeading = h >= 0 ? h : nil }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
