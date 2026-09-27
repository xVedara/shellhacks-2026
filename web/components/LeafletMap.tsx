"use client";

// Leaflet touches `window` at import time, so this module is only ever loaded via
// next/dynamic with ssr:false (see components/Map.tsx).
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttributionControl, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from "react-leaflet";
import type { HazardSummary } from "@/lib/api";
import { clusterByPixel, pushClear } from "@/lib/cluster";
import { hazardAccessibleName, markerHtml, markerSize, pinBox } from "@/lib/marker";
import { sameHazardMarker, type HazardMarkerProps } from "@/lib/pin-equal";

export type MapProps = {
  hazards: HazardSummary[];
  center: [number, number];
  zoom?: number;
  selectedId?: string | null;
  highlightId?: string | null;
  onSelect?: (id: string) => void;
  showOsm?: boolean;
  /** Small, non-interactive map (verify queue). */
  compact?: boolean;
  label: string;
  /** Phone sheet height in px. The selected pin is shifted up by about half of this. */
  sheet?: number;
  /** An overlay covers the map (first contact failed): the map leaves the tab order, the controls stay. */
  blocked?: boolean;
};

type OsmFeature = {
  id: string;
  kind: "crossing" | "kerb" | "tactile";
  tactile: boolean;
  detail: string | null;
  lat?: number;
  lng?: number;
  line?: [number, number][];
};

function hazardIcon(h: HazardSummary, selected: boolean, highlighted: boolean) {
  const size = markerSize(h.confidence) + (selected ? 8 : 0);
  const box = pinBox(size, selected);
  const html =
    `<span class="ss-pin-hit${highlighted ? " ss-pin--new" : ""}" style="width:${box}px;height:${box}px">` +
    markerHtml(h, size, selected) +
    (h.sample ? ` <span class="ss-pin__sample">Sample</span>` : "") +
    `</span>`;
  return L.divIcon({ html, className: "ss-pin-wrap", iconSize: [box, box], iconAnchor: [box / 2, box / 2] });
}

/** Selected pin radius with its ring (about 31px) plus the cluster's 22px radius, plus a little air. */
const SELECTED_CLEARANCE = 56;

const CLUSTER_SIZE = 44;

function clusterIcon(count: number) {
  const size = CLUSTER_SIZE;
  return L.divIcon({
    html: `<span class="ss-cluster" style="width:${size}px;height:${size}px">${count}</span>`,
    className: "ss-pin-wrap",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  const [lat, lng] = center;
  useEffect(() => {
    map.setView([lat, lng], zoom ?? map.getZoom());
  }, [map, lat, lng, zoom]);
  return null;
}

const PIN_EDGE = 24;
// The map point is the pin center. The glyph plus the Sample tag hang about 60px below it.
const PIN_AND_TAG = 60;

function centerAboveSheet(map: L.Map, lat: number, lng: number, sheet: number) {
  const zoom = map.getZoom();
  const size = map.getSize();
  const visible = Math.max(0, size.y - sheet);
  const lowest = visible - PIN_AND_TAG;
  const y = Math.min(Math.max(visible / 2, PIN_EDGE), Math.max(lowest, PIN_EDGE));
  const point = map.project([lat, lng], zoom).add([0, size.y / 2 - y]);
  return map.unproject(point, zoom);
}

function pinClearsSheet(map: L.Map, lat: number, lng: number, sheet: number) {
  const size = map.getSize();
  if (!size.x || !size.y) return false;
  const pt = map.latLngToContainerPoint([lat, lng]);
  return (
    pt.x >= PIN_EDGE &&
    pt.x <= size.x - PIN_EDGE &&
    pt.y >= PIN_EDGE &&
    pt.y <= size.y - sheet - PIN_AND_TAG
  );
}

function PanToSelected({
  hazards,
  selectedId,
  sheet = 0,
}: {
  hazards: HazardSummary[];
  selectedId?: string | null;
  sheet?: number;
}) {
  const map = useMap();
  const target = hazards.find((h) => h.id === selectedId);
  const lat = target?.lat;
  const lng = target?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    const place = () => {
      if (!map.getSize().y) return;
      if (sheet > 0) {
        if (pinClearsSheet(map, lat, lng, sheet)) return;
        map.panTo(centerAboveSheet(map, lat, lng, sheet), { animate: false });
        return;
      }
      if (!map.getBounds().pad(-0.2).contains([lat, lng])) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        map.panTo([lat, lng], { animate: !reduce });
      }
    };
    place();
    map.on("resize", place);
    return () => {
      map.off("resize", place);
    };
  }, [map, lat, lng, sheet]);
  return null;
}

/**
 * WCAG 2.4.11: a pin that takes keyboard focus under the phone sheet (or at the map's edge) is panned
 * into the clear strip. Leaflet's own autoPanOnFocus only knows the container, which runs under the sheet.
 */
function PanFocusedMarker({ sheet }: { sheet: number }) {
  const map = useMap();
  useEffect(() => {
    const pane = map.getPane("markerPane");
    if (!pane) return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!el.classList?.contains("leaflet-marker-icon")) return;
      // The browser scrolls the (overflow: hidden) container to reveal a focused pin, and Leaflet snaps that
      // scroll back a moment later, which would hide the pin again. Undo it first, then measure.
      const container = map.getContainer();
      container.scrollTop = 0;
      container.scrollLeft = 0;
      const box = el.getBoundingClientRect();
      const origin = container.getBoundingClientRect();
      const at = map.containerPointToLatLng([box.left + box.width / 2 - origin.left, box.top + box.height / 2 - origin.top]);
      if (pinClearsSheet(map, at.lat, at.lng, sheet)) return;
      map.panTo(centerAboveSheet(map, at.lat, at.lng, sheet), { animate: false });
    };
    pane.addEventListener("focusin", onFocus);
    return () => pane.removeEventListener("focusin", onFocus);
  }, [map, sheet]);
  return null;
}

/** A pin must show at least this much of itself (width and height) above the sheet and inside the map. */
const MIN_EXPOSED = 24;

/**
 * Pins that show less than 24x24px of themselves (under the phone sheet or past the map's edge) are slivers
 * (WCAG 2.5.8, 2.4.11): no pointer, no tab stop, hidden from the accessibility tree. The list carries every
 * hazard. A pin that has focus when it goes offstage hands focus to the panel first, so focus never strands on
 * a hidden node. (Not `inert`: Chrome would drop that focus to <body> with no announcement.)
 */
function OffstagePins({ sheet }: { sheet: number }) {
  const map = useMap();
  useEffect(() => {
    const pane = map.getPane("markerPane");
    if (!pane) return;
    const update = () => {
      const size = map.getSize();
      const origin = map.getContainer().getBoundingClientRect();
      const region = map.getContainer().parentElement ?? map.getContainer();
      const controls = [...region.querySelectorAll<HTMLElement>(".leaflet-control-container .leaflet-control, .map-locate")]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const c = el.getBoundingClientRect();
          return { l: c.left - origin.left, r: c.right - origin.left, t: c.top - origin.top, b: c.bottom - origin.top };
        });
      for (const el of pane.querySelectorAll<HTMLElement>(".leaflet-marker-icon")) {
        // The drawn glyph, not the icon box (which carries padding for the ring).
        const r = (el.querySelector(".ss-pin, .ss-cluster") ?? el).getBoundingClientRect();
        let v = {
          l: Math.max(r.left - origin.left, 0),
          r: Math.min(r.right - origin.left, size.x),
          t: Math.max(r.top - origin.top, 0),
          b: Math.min(r.bottom - origin.top, size.y - sheet),
        };
        // The zoom, locate and credit controls cover pins as well: keep the largest uncovered piece.
        for (const c of controls) {
          if (c.r <= v.l || c.l >= v.r || c.b <= v.t || c.t >= v.b) continue;
          const pieces = [
            { ...v, r: Math.min(v.r, c.l) },
            { ...v, l: Math.max(v.l, c.r) },
            { ...v, b: Math.min(v.b, c.t) },
            { ...v, t: Math.max(v.t, c.b) },
          ];
          v = pieces.reduce((best, q) => (Math.min(q.r - q.l, q.b - q.t) > Math.min(best.r - best.l, best.b - best.t) ? q : best));
        }
        const off = v.r - v.l < MIN_EXPOSED || v.b - v.t < MIN_EXPOSED;
        if (off && el.contains(document.activeElement)) document.getElementById("hazard-panel")?.focus({ preventScroll: true });
        // Idempotent (writes only on a difference), so the attribute observer below settles after one pass.
        if (el.classList.contains("ss-pin-offstage") !== off) el.classList.toggle("ss-pin-offstage", off);
        if (off) {
          if (el.getAttribute("aria-hidden") !== "true") el.setAttribute("aria-hidden", "true");
          if (el.tabIndex === 0) {
            el.dataset.tab = "0";
            el.tabIndex = -1;
          }
        } else {
          if (el.hasAttribute("aria-hidden")) el.removeAttribute("aria-hidden");
          if (el.dataset.tab === "0" && el.tabIndex !== 0) el.tabIndex = 0;
        }
      }
    };
    update();
    map.on("moveend zoomend resize", update);
    // Leaflet reuses a marker's element when its icon changes (selection, live updates) and resets its class and
    // tabindex, so watch those attributes as well as new icons.
    const mo = new MutationObserver(update);
    mo.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "tabindex"] });
    return () => {
      map.off("moveend zoomend resize", update);
      mo.disconnect();
    };
  }, [map, sheet]);
  return null;
}

/** The map container is a tab stop for keyboard panning; not while an overlay hides it (WCAG 2.4.11). */
function BlockKeyboard({ blocked }: { blocked: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().tabIndex = blocked ? -1 : 0;
  }, [map, blocked]);
  return null;
}

function BindMap({ onMap }: { onMap: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onMap(map);
  }, [map, onMap]);
  return null;
}

let osmCache: Promise<OsmFeature[]> | null = null;
const loadOsm = () =>
  (osmCache ??= fetch("/osm-graham.json")
    .then((r) => r.json())
    .then((d) => d.features as OsmFeature[])
    .catch(() => {
      osmCache = null;
      return [];
    }));

const OSM_STYLE: Record<OsmFeature["kind"], { color: string; fill: string }> = {
  crossing: { color: "#111", fill: "#fff" },
  kerb: { color: "#111", fill: "#8a8a8a" },
  tactile: { color: "#111", fill: "#f5c400" },
};

const OsmLayer = memo(function OsmLayer() {
  const [features, setFeatures] = useState<OsmFeature[]>([]);
  useEffect(() => {
    let live = true;
    loadOsm().then((f) => live && setFeatures(f));
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      {features.map((f) => {
        const style = f.tactile ? OSM_STYLE.tactile : OSM_STYLE[f.kind];
        const name = `${f.kind === "kerb" ? "Curb" : "Crossing"}${f.detail ? ` (${f.detail})` : ""}${f.tactile ? ", tactile paving" : ""}`;
        if (f.line)
          return (
            <Polyline key={f.id} positions={f.line} pathOptions={{ color: style.fill === "#fff" ? "#111" : style.fill, weight: 3, dashArray: "4 3" }}>
              <Tooltip>{name}</Tooltip>
            </Polyline>
          );
        return (
          <CircleMarker
            key={f.id}
            center={[f.lat!, f.lng!]}
            radius={f.kind === "kerb" ? 3 : 4}
            pathOptions={{ color: style.color, weight: 1, fillColor: style.fill, fillOpacity: 1 }}
          >
            <Tooltip>{name}</Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
});

const HazardMarker = memo(function HazardMarker({
  hazard: h,
  selected,
  highlighted,
  compact,
  onSelect,
}: HazardMarkerProps) {
  const ref = useRef<L.Marker>(null);
  const name = hazardAccessibleName(h);
  const icon = useMemo(() => hazardIcon(h, selected, highlighted), [h, selected, highlighted]);
  // A pin with nothing to do (verify thumbnail, the single pin on /hazard) is a picture, not a tab stop.
  const interactive = !compact && !!onSelect;

  useEffect(() => {
    const marker = ref.current;
    if (!marker) return;
    marker.options.title = name;
    const el = marker.getElement();
    el?.setAttribute("title", name);
    el?.setAttribute("aria-label", name);
    if (!interactive) el?.setAttribute("role", "img");
  }, [name, icon, interactive]);

  return (
    <Marker
      ref={ref}
      position={[h.lat, h.lng]}
      icon={icon}
      title={name}
      keyboard={interactive}
      interactive={interactive}
      autoPanOnFocus={false}
      zIndexOffset={selected ? 1000 : 0}
      eventHandlers={{
        click: () => onSelect?.(h.id),
        keypress: (e) => {
          const key = (e.originalEvent as KeyboardEvent).key;
          if (key === "Enter" || key === " ") onSelect?.(h.id);
        },
      }}
    />
  );
}, sameHazardMarker);

function ClusteredHazards({
  hazards,
  selectedId,
  highlightId,
  onSelect,
  sheet,
}: {
  hazards: HazardSummary[];
  selectedId?: string | null;
  highlightId?: string | null;
  onSelect?: (id: string) => void;
  /** Phone sheet height: the bubble must stay in the strip above it, not just on the map. */
  sheet: number;
}) {
  const map = useMap();
  const [view, setView] = useState(0);
  useEffect(() => {
    const bump = () => setView((n) => n + 1);
    map.on("zoomend moveend", bump);
    return () => {
      map.off("zoomend moveend", bump);
    };
  }, [map]);

  const groups = useMemo(() => {
    const points = hazards.map((h) => {
      const p = map.latLngToContainerPoint([h.lat, h.lng]);
      return { item: h, x: p.x, y: p.y };
    });
    const clustered = clusterByPixel(points, 36);
    // Keep the selected pin visible even when it overlaps neighbors.
    const split: { hazards: HazardSummary[]; x: number; y: number }[] = [];
    for (const group of clustered) {
      const selected = group.items.find((h) => h.id === selectedId);
      const rest = group.items.filter((h) => h.id !== selectedId);
      if (selected && rest.length) {
        const p = map.latLngToContainerPoint([selected.lat, selected.lng]);
        split.push({ hazards: [selected], x: p.x, y: p.y });
        // Slide the leftover cluster out from under the selected pin so it stays a whole 44px target.
        const size = map.getSize();
        split.push({ hazards: rest, ...pushClear(group, p, SELECTED_CLEARANCE, { w: size.x, h: Math.max(0, size.y - sheet) }, CLUSTER_SIZE / 2) });
      } else {
        split.push({ hazards: group.items, x: group.x, y: group.y });
      }
    }
    return split;
    // view is the camera generation; map methods read the latest projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazards, map, selectedId, sheet, view]);

  return (
    <>
      {groups.map((group) => {
        if (group.hazards.length === 1) {
          const h = group.hazards[0];
          return (
            <HazardMarker
              key={h.id}
              hazard={h}
              selected={h.id === selectedId}
              highlighted={h.id === highlightId}
              onSelect={onSelect}
            />
          );
        }
        const ll = map.containerPointToLatLng([group.x, group.y]);
        const name = `${group.hazards.length} overlapping hazards`;
        return (
          <Marker
            key={group.hazards.map((h) => h.id).join("-")}
            position={[ll.lat, ll.lng]}
            icon={clusterIcon(group.hazards.length)}
            title={name}
            zIndexOffset={500}
            autoPanOnFocus={false}
            eventHandlers={{
              click: () => {
                const bounds = L.latLngBounds(group.hazards.map((h) => [h.lat, h.lng]));
                map.fitBounds(bounds, { padding: [48, 48], maxZoom: map.getZoom() + 2 });
              },
            }}
          />
        );
      })}
    </>
  );
}

function LocateButton({ map }: { map: L.Map | null }) {
  const [note, setNote] = useState("");
  return (
    <>
      <button
        type="button"
        className="map-locate"
        aria-label="Current location"
        onClick={() => {
          if (!map) return;
          setNote("");
          map.locate({ setView: true, maxZoom: 17 });
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.25" />
          <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2" />
        </svg>
      </button>
      <p className="sr-only" aria-live="polite">
        {note}
      </p>
      <MapLocateNote map={map} onNote={setNote} />
    </>
  );
}

function MapLocateNote({ map, onNote }: { map: L.Map | null; onNote: (note: string) => void }) {
  useEffect(() => {
    if (!map) return;
    const fail = () => onNote("Current location is unavailable.");
    const found = () => onNote("Map centered on your current location.");
    map.on("locationerror", fail);
    map.on("locationfound", found);
    return () => {
      map.off("locationerror", fail);
      map.off("locationfound", found);
    };
  }, [map, onNote]);
  return null;
}

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const reducedMotion = () => window.matchMedia(REDUCE).matches;

export default function LeafletMap({
  hazards,
  center,
  zoom = 17,
  selectedId,
  highlightId,
  onSelect,
  showOsm,
  compact,
  label,
  sheet = 0,
  blocked = false,
}: MapProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  // Leaflet reads its animation options only when the map is created, so a change to the reduced-motion
  // setting remounts the map (key). The view restarts at the page's center; a selected pin is panned back
  // into view. ponytail: keep the reader's pan/zoom across the remount if people toggle this mid-session.
  const calm = useSyncExternalStore(subscribeMotion, reducedMotion, () => false);
  return (
    <div role="region" aria-label={label} className="relative h-full w-full">
      <MapContainer
        key={calm ? "calm" : "moving"}
        center={center}
        zoom={zoom}
        preferCanvas
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
        dragging={!compact}
        scrollWheelZoom={!compact}
        doubleClickZoom={!compact}
        keyboard={!compact}
        zoomAnimation={!calm}
        fadeAnimation={!calm}
        markerZoomAnimation={!calm}
      >
        <BindMap onMap={setMap} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {/* Only the required OpenStreetMap credit; no library link or flag. */}
        <AttributionControl position="bottomleft" prefix={false} />
        {!compact && <ZoomControl position="bottomright" />}
        {compact ? <Recenter center={center} zoom={zoom} /> : <PanToSelected hazards={hazards} selectedId={selectedId} sheet={sheet} />}
        {!compact && <PanFocusedMarker sheet={sheet} />}
        {!compact && <BlockKeyboard blocked={blocked} />}
        {!compact && <OffstagePins sheet={sheet} />}
        {showOsm && <OsmLayer />}
        {compact
          ? hazards.map((h) => (
              <HazardMarker key={h.id} hazard={h} selected={h.id === selectedId} highlighted={h.id === highlightId} compact onSelect={onSelect} />
            ))
          : (
              <ClusteredHazards hazards={hazards} selectedId={selectedId} highlightId={highlightId} onSelect={onSelect} sheet={sheet} />
            )}
      </MapContainer>
      {!compact && <LocateButton map={map} />}
    </div>
  );
}
