import Foundation
import simd

extension simd_float4x4 {
    /// Camera position (column 3).
    var translation: SIMD3<Float> { SIMD3(columns.3.x, columns.3.y, columns.3.z) }

    /// Upper 3×3, the camera's rotation.
    var rotation3: simd_float3x3 {
        simd_float3x3(SIMD3(columns.0.x, columns.0.y, columns.0.z),
                      SIMD3(columns.1.x, columns.1.y, columns.1.z),
                      SIMD3(columns.2.x, columns.2.y, columns.2.z))
    }
}

/// Lat/lng math for the Localizer, heads-up and passive votes. Pure, so it is unit-tested.
/// AR world axes (worldAlignment .gravityAndHeading): +x = east, +y = up, -z = true north.
/// Flat-earth (equirectangular) approximation: fine for the tens of metres StepSafe works in.
enum Geo {
    static let earthRadiusM = 6_378_137.0

    struct Fix: Equatable {
        var lat: Double
        var lng: Double
    }

    /// East/north offset in metres of an AR world point from the camera.
    static func eastNorth(of point: SIMD3<Float>, from camera: SIMD3<Float>) -> (east: Double, north: Double) {
        let d = point - camera
        return (Double(d.x), Double(-d.z))
    }

    /// The fix moved by `east`/`north` metres.
    static func offset(_ fix: Fix, east: Double, north: Double) -> Fix {
        let lat = fix.lat + north / earthRadiusM * 180 / .pi
        let lng = fix.lng + east / (earthRadiusM * cos(fix.lat * .pi / 180)) * 180 / .pi
        return Fix(lat: lat, lng: lng)
    }

    /// The AR world point's lat/lng, given the GPS fix of the phone (= the camera).
    static func locate(_ point: SIMD3<Float>, camera: SIMD3<Float>, cameraFix: Fix) -> Fix {
        let (e, n) = eastNorth(of: point, from: camera)
        return offset(cameraFix, east: e, north: n)
    }

    /// East/north metres from `a` to `b`.
    static func delta(from a: Fix, to b: Fix) -> (east: Double, north: Double) {
        let north = (b.lat - a.lat) * .pi / 180 * earthRadiusM
        let east = (b.lng - a.lng) * .pi / 180 * earthRadiusM * cos(a.lat * .pi / 180)
        return (east, north)
    }

    static func distance(_ a: Fix, _ b: Fix) -> Double {
        let (e, n) = delta(from: a, to: b)
        return (e * e + n * n).squareRoot()
    }

    /// Compass bearing from `a` to `b`, degrees [0, 360), 0 = north, 90 = east.
    static func bearing(from a: Fix, to b: Fix) -> Double {
        let (e, n) = delta(from: a, to: b)
        return normalize(atan2(e, n) * 180 / .pi)
    }

    /// Compass bearing of the AR camera's flattened forward (-z column), or nil when looking straight up/down.
    static func cameraHeading(_ t: simd_float4x4) -> Double? {
        let fwd = -SIMD3(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        guard fwd.x * fwd.x + fwd.z * fwd.z > 1e-4 else { return nil }
        return normalize(Double(atan2(fwd.x, -fwd.z)) * 180 / .pi)
    }

    static func normalize(_ deg: Double) -> Double {
        let r = deg.truncatingRemainder(dividingBy: 360)
        return r < 0 ? r + 360 : r
    }

    /// Signed difference target - heading in (-180, 180]; negative = to the left.
    static func relative(_ target: Double, to heading: Double) -> Double {
        let d = normalize(target - heading)
        return d > 180 ? d - 360 : d
    }
}
