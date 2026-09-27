import MapKit
import SwiftUI
import UIKit

/// Community map for sighted helpers: hazards that overlap at the current zoom merge into one "3 hazards" marker
/// (tap to zoom in); a single hazard opens its detail. SwiftUI `Map` has no clustering, hence MKMapView.
/// The list stays the primary path; VoiceOver reaches every hazard there too.
struct HazardMap: UIViewRepresentable {
    struct Pin: Equatable {
        let id: String
        let coordinate: CLLocationCoordinate2D
        /// First letter of the category (P, T, M), the marker glyph.
        let letter: String
        let title: String
        /// The same spoken sentence as the list row.
        let spoken: String

        static func == (a: Pin, b: Pin) -> Bool {
            a.id == b.id && a.letter == b.letter && a.title == b.title && a.spoken == b.spoken
                && a.coordinate.latitude == b.coordinate.latitude && a.coordinate.longitude == b.coordinate.longitude
        }
    }

    var pins: [Pin]
    var center: CLLocationCoordinate2D?
    var radiusM: Double
    var lang: String
    var onSelect: (String) -> Void
    /// Hazards stacked on the same spot, which zooming cannot separate: the caller lets people pick one.
    var onStack: ([String]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true
        map.pointOfInterestFilter = .excludingAll // hazards are the content, not shops
        map.register(Marker.self, forAnnotationViewWithReuseIdentifier: Coordinator.pinID)
        map.register(Marker.self, forAnnotationViewWithReuseIdentifier: Coordinator.clusterID)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let c = context.coordinator
        c.parent = self
        if pins != c.shown {
            map.removeAnnotations(map.annotations.filter { $0 is HazardAnnotation || $0 is MKClusterAnnotation })
            map.addAnnotations(pins.map(HazardAnnotation.init))
            c.shown = pins
        }
        guard let center else { return }
        if !c.centered { // open on the user with the whole radius in view, plus 10% padding on each side
            let span = radiusM * 2 * 1.2
            map.setRegion(MKCoordinateRegion(center: center, latitudinalMeters: span, longitudinalMeters: span), animated: false)
            c.centered = true
        }
        if c.circle.map({ $0.coordinate.latitude != center.latitude || $0.coordinate.longitude != center.longitude }) ?? true {
            if let old = c.circle { map.removeOverlay(old) }
            let circle = MKCircle(center: center, radius: radiusM)
            map.addOverlay(circle)
            c.circle = circle
        }
    }

    /// VoiceOver double-tap selects the annotation itself instead of tapping the marker's on-screen frame,
    /// which can be stale right after a zoom and would land on a neighbouring marker.
    final class Marker: MKMarkerAnnotationView {
        var activate: (() -> Void)?
        override func accessibilityActivate() -> Bool {
            guard let activate else { return false }
            activate()
            return true
        }
    }

    final class HazardAnnotation: NSObject, MKAnnotation {
        let pin: Pin
        var coordinate: CLLocationCoordinate2D { pin.coordinate }
        var title: String? { pin.title }
        init(_ pin: Pin) { self.pin = pin }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        static let pinID = "hazard", clusterID = "hazards"
        var parent: HazardMap
        var shown: [Pin] = []
        var centered = false
        var circle: MKCircle?

        init(_ parent: HazardMap) { self.parent = parent }

        func mapView(_ map: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let cluster = annotation as? MKClusterAnnotation {
                let v = map.dequeueReusableAnnotationView(withIdentifier: Self.clusterID, for: cluster) as! Marker
                let n = cluster.memberAnnotations.count
                style(v, map, cluster)
                v.glyphText = "\(n)"
                v.displayPriority = .required
                v.accessibilityLabel = parent.lang == "es" ? "\(n) peligros" : "\(n) hazards"
                v.accessibilityHint = parent.lang == "es" ? "Toca dos veces para acercar" : "Double-tap to zoom"
                return v
            }
            guard let hazard = annotation as? HazardAnnotation else { return nil } // the user dot stays system
            let v = map.dequeueReusableAnnotationView(withIdentifier: Self.pinID, for: hazard) as! Marker
            style(v, map, hazard)
            v.glyphText = hazard.pin.letter
            v.clusteringIdentifier = Self.pinID
            v.titleVisibility = .adaptive
            v.accessibilityLabel = hazard.pin.spoken
            v.accessibilityHint = parent.lang == "es" ? "Abre los detalles" : "Opens details"
            return v
        }

        private func style(_ v: Marker, _ map: MKMapView, _ annotation: MKAnnotation) {
            v.activate = { [weak map] in map?.selectAnnotation(annotation, animated: false) }
            v.markerTintColor = UIColor(Color.hazard)
            v.glyphTintColor = UIColor(Color.navy) // navy on orange 6.94:1 (white would be 2.63:1)
            v.canShowCallout = false
            v.isAccessibilityElement = true
            v.accessibilityTraits = .button
        }

        func mapView(_ map: MKMapView, didSelect annotation: MKAnnotation) {
            map.deselectAnnotation(annotation, animated: false)
            if let cluster = annotation as? MKClusterAnnotation {
                let members = cluster.memberAnnotations.compactMap { $0 as? HazardAnnotation }
                let first = MKMapPoint(cluster.coordinate)
                let spreadM = members.map { MKMapPoint($0.coordinate).distance(to: first) }.max() ?? 0
                if spreadM < 15 { // same spot: no zoom level splits them
                    parent.onStack(members.map(\.pin.id))
                } else {
                    map.showAnnotations(members, animated: !UIAccessibility.isReduceMotionEnabled)
                }
            } else if let hazard = annotation as? HazardAnnotation {
                parent.onSelect(hazard.pin.id)
            }
        }

        func mapView(_ map: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            let r = MKCircleRenderer(overlay: overlay)
            r.fillColor = UIColor(Color.control).withAlphaComponent(0.08)
            r.strokeColor = UIColor(Color.control).withAlphaComponent(0.6)
            r.lineWidth = 1.5
            return r
        }
    }
}

/// What the marker letters mean, for sighted helpers.
struct HazardMapLegend: View {
    let lang: String

    var body: some View {
        let es = lang == "es"
        HStack(spacing: 10) {
            item("P", es ? "Permanente" : "Permanent")
            item("T", es ? "Temporal" : "Temporary")
            item("M", es ? "Móvil" : "Moving")
        }
        .font(.caption)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.navy.opacity(0.85), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(es ? "Letras: P permanente, T temporal, M móvil" : "Marker letters: P permanent, T temporary, M moving")
    }

    private func item(_ letter: String, _ name: String) -> some View {
        HStack(spacing: 4) {
            Text(letter).font(.caption.bold()).foregroundStyle(Color.navy)
                .frame(minWidth: 18, minHeight: 18)
                .background(Color.hazard, in: Circle())
            Text(name).foregroundStyle(.white)
        }
    }
}
