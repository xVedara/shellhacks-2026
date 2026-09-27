import MapKit
import SwiftUI
import UIKit

/// Community map for sighted helpers: hazards that overlap at the current zoom merge into one "3 hazards" marker
/// (tap to zoom in); a single hazard opens its detail. SwiftUI `Map` has no clustering, hence MKMapView.
/// The list stays the primary path; VoiceOver reaches every hazard there too.
struct HazardMap: UIViewRepresentable {
    struct Pin {
        let id: String
        let coordinate: CLLocationCoordinate2D
        /// First letter of the category (P, T, M), the marker glyph.
        let letter: String
        let title: String
        /// The same spoken sentence as the list row (live distance and direction).
        let spoken: String
    }

    var pins: [Pin]
    var center: CLLocationCoordinate2D?
    var radiusM: Double
    var lang: String
    var onSelect: (String) -> Void
    /// Hazards stacked on the same spot, which zooming cannot separate: the caller lets people pick one.
    var onStack: ([String]) -> Void

    /// Cluster members closer than this to their centre are "one spot": a tap offers a choice instead of zooming.
    static let stackedSpreadM = 15.0

    static func category(_ c: String, lang: String) -> String {
        let es = lang == "es"
        switch c {
        case "permanent": return es ? "Permanente" : "Permanent"
        case "temporary": return es ? "Temporal" : "Temporary"
        case "moving": return es ? "Móvil" : "Moving"
        default: return es ? "Otro" : "Other"
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = AccessibleMap()
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
        c.sync(pins, on: map)
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

    /// Spread of a cluster's members around its centre, in metres.
    static func spreadM(_ cluster: MKClusterAnnotation) -> Double {
        let centre = MKMapPoint(cluster.coordinate)
        return cluster.memberAnnotations.map { MKMapPoint($0.coordinate).distance(to: centre) }.max() ?? 0
    }

    /// One marker view for hazards and clusters. Its VoiceOver label and hint are read live from the annotation
    /// (so a reused or re-clustered view never speaks stale text), and only a marker actually on screen is an
    /// accessibility element: MapKit keeps hidden views for cluster members and recycled clusters.
    final class Marker: MKMarkerAnnotationView {
        var lang = "en"
        var activate: (() -> Void)?

        /// Drawn and not folded into a cluster (`cluster` is the view that absorbed this one).
        var onScreen: Bool { annotation != nil && cluster == nil && window != nil && !isHidden && alpha > 0.01 }
        override var isAccessibilityElement: Bool { get { onScreen } set {} }
        override var accessibilityElementsHidden: Bool { get { !onScreen } set {} }
        override var accessibilityTraits: UIAccessibilityTraits { get { .button } set {} }

        override var accessibilityLabel: String? {
            get {
                let es = lang == "es"
                if let cluster = annotation as? MKClusterAnnotation {
                    let n = cluster.memberAnnotations.count
                    return es ? "\(n) peligros" : "\(n) hazards"
                }
                return (annotation as? HazardAnnotation)?.pin.spoken
            }
            set {}
        }

        override var accessibilityHint: String? {
            get {
                let es = lang == "es"
                if let cluster = annotation as? MKClusterAnnotation {
                    return HazardMap.spreadM(cluster) < HazardMap.stackedSpreadM
                        ? (es ? "Toca dos veces para elegir uno" : "Double-tap to choose one")
                        : (es ? "Toca dos veces para acercar" : "Double-tap to zoom")
                }
                return es ? "Abre los detalles" : "Opens details"
            }
            set {}
        }

        /// A cluster outranks the hazards and smaller clusters stacked under it.
        var weight: Int { (annotation as? MKClusterAnnotation)?.memberAnnotations.count ?? 1 }

        func frame(in view: UIView) -> CGRect { convert(bounds, to: view) }

        /// VoiceOver double-tap selects the annotation itself instead of tapping the marker's frame.
        override func accessibilityActivate() -> Bool {
            guard let activate else { return false }
            activate()
            return true
        }
    }

    /// MapKit's own accessibility tree lists every annotation view it keeps, including hazards folded into a
    /// cluster and recycled cluster views, all stacked on the drawn marker. This map exposes only the markers a
    /// sighted person sees: on screen, not folded in, and one per spot (the cluster with the most members wins),
    /// in reading order, plus the user's location.
    final class AccessibleMap: MKMapView {
        override var accessibilityElements: [Any]? {
            get {
                var best: [String: Marker] = [:] // one marker per drawn spot
                for m in markers(in: self) where m.onScreen && bounds.intersects(m.frame(in: self)) {
                    let f = m.frame(in: self)
                    let key = "\(Int(f.midX.rounded())),\(Int(f.midY.rounded()))"
                    if let other = best[key], other.weight >= m.weight { continue }
                    best[key] = m
                }
                let sorted = best.values.sorted {
                    let a = $0.frame(in: self), b = $1.frame(in: self)
                    return abs(a.minY - b.minY) > 8 ? a.minY < b.minY : a.minX < b.minX
                }
                var elements: [Any] = sorted
                if let me = view(for: userLocation), me.window != nil { elements.insert(me, at: 0) }
                return elements
            }
            set {}
        }

        private func markers(in view: UIView) -> [Marker] {
            view.subviews.flatMap { sub -> [Marker] in
                (sub as? Marker).map { [$0] } ?? markers(in: sub)
            }
        }
    }

    final class HazardAnnotation: NSObject, MKAnnotation {
        /// Updated in place when the text changes (distance, direction, name), so markers are not re-added.
        var pin: Pin {
            willSet { if newValue.title != pin.title { willChangeValue(forKey: "title") } }
            didSet { if oldValue.title != pin.title { didChangeValue(forKey: "title") } }
        }
        let coordinate: CLLocationCoordinate2D
        var title: String? { pin.title }
        init(_ pin: Pin) { self.pin = pin; coordinate = pin.coordinate }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        static let pinID = "hazard", clusterID = "hazards"
        var parent: HazardMap
        var centered = false
        var circle: MKCircle?
        /// On-map annotations by hazard id.
        private var byID: [String: HazardAnnotation] = [:]
        /// Set by a cluster tap; the zoom it starts ends with one VoiceOver layout refresh.
        private var zooming = false

        init(_ parent: HazardMap) { self.parent = parent }

        /// Adds and removes only hazards whose id (or position, or glyph) changed; text updates happen in place.
        func sync(_ pins: [Pin], on map: MKMapView) {
            let wanted = Dictionary(pins.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            var gone: [HazardAnnotation] = [], added: [HazardAnnotation] = []
            for (id, ann) in byID {
                guard let p = wanted[id] else { gone.append(ann); byID[id] = nil; continue }
                if p.coordinate.latitude != ann.coordinate.latitude || p.coordinate.longitude != ann.coordinate.longitude
                    || p.letter != ann.pin.letter {
                    gone.append(ann)
                    byID[id] = nil
                } else {
                    ann.pin = p
                }
            }
            for (id, p) in wanted where byID[id] == nil {
                let ann = HazardAnnotation(p)
                byID[id] = ann
                added.append(ann)
            }
            if !gone.isEmpty { map.removeAnnotations(gone) }
            if !added.isEmpty { map.addAnnotations(added) }
        }

        func mapView(_ map: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let cluster = annotation as? MKClusterAnnotation {
                let v = map.dequeueReusableAnnotationView(withIdentifier: Self.clusterID, for: cluster) as! Marker
                style(v, map, cluster)
                v.glyphText = "\(cluster.memberAnnotations.count)"
                v.displayPriority = .required
                return v
            }
            guard let hazard = annotation as? HazardAnnotation else { return nil } // the user dot stays system
            let v = map.dequeueReusableAnnotationView(withIdentifier: Self.pinID, for: hazard) as! Marker
            style(v, map, hazard)
            v.glyphText = hazard.pin.letter
            v.clusteringIdentifier = Self.pinID
            v.titleVisibility = .adaptive
            return v
        }

        private func style(_ v: Marker, _ map: MKMapView, _ annotation: MKAnnotation) {
            v.lang = parent.lang
            v.activate = { [weak map] in map?.selectAnnotation(annotation, animated: false) }
            v.markerTintColor = UIColor(Color.hazard)
            v.glyphTintColor = UIColor(Color.navy) // navy on orange 6.94:1 (white would be 2.63:1)
            v.canShowCallout = false
        }

        func mapView(_ map: MKMapView, didSelect annotation: MKAnnotation) {
            map.deselectAnnotation(annotation, animated: false)
            if let cluster = annotation as? MKClusterAnnotation {
                let members = cluster.memberAnnotations.compactMap { $0 as? HazardAnnotation }
                if HazardMap.spreadM(cluster) < HazardMap.stackedSpreadM { // same spot: no zoom level splits them
                    parent.onStack(members.map(\.pin.id))
                } else {
                    zooming = true
                    map.showAnnotations(members, animated: !UIAccessibility.isReduceMotionEnabled)
                }
            } else if let hazard = annotation as? HazardAnnotation {
                parent.onSelect(hazard.pin.id)
            }
        }

        /// After a cluster zoom the set of visible markers changed: let VoiceOver rebuild its view of the map.
        func mapView(_ map: MKMapView, regionDidChangeAnimated animated: Bool) {
            guard zooming else { return }
            zooming = false
            UIAccessibility.post(notification: .layoutChanged, argument: nil)
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

/// What the marker letters mean, for sighted helpers. One row normally; stacked at accessibility sizes, where it
/// also stops growing at AX1 (supplemental map chrome must not cover the map).
struct HazardMapLegend: View {
    let lang: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 10))
        layout {
            item("P", HazardMap.category("permanent", lang: lang))
            item("T", HazardMap.category("temporary", lang: lang))
            item("M", HazardMap.category("moving", lang: lang))
        }
        .font(.caption)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.navy.opacity(0.85), in: RoundedRectangle(cornerRadius: stacked ? 12 : 20))
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(lang == "es" ? "Letras: P permanente, T temporal, M móvil"
                                         : "Marker letters: P permanent, T temporary, M moving")
    }

    private func item(_ letter: String, _ name: String) -> some View {
        HStack(spacing: 4) {
            Text(letter).font(.caption.bold()).foregroundStyle(Color.navy)
                .fixedSize()
                .padding(4)
                .frame(minWidth: 18, minHeight: 18)
                .background(Color.hazard, in: Circle())
            Text(name).foregroundStyle(.white).fixedSize() // never hyphenated
        }
    }
}
