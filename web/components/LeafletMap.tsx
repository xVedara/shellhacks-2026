"use client";

// Leaflet touches `window` at import time, so this module is only ever loaded via
// next/dynamic with ssr:false (see components/Map.tsx).
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { HazardSummary } from "@/lib/api";
import { hazardAccessibleName, markerSize, markerSvg } from "@/lib/marker";

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
  const html =
    `<div class="ss-pin${selected ? " ss-pin--selected" : ""}${highlighted ? " ss-pin--new" : ""}">` +
    markerSvg(h, size, selected) +
    (h.sample ? `<span class="ss-pin__sample">Sample</span>` : "") +
    `</div>`;
  return L.divIcon({ html, className: "ss-pin-wrap", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  const [lat, lng] = center;
  useEffect(() => {
    map.setView([lat, lng], zoom ?? map.getZoom());
  }, [map, lat, lng, zoom]);
  return null;
}

function PanToSelected({ hazards, selectedId }: { hazards: HazardSummary[]; selectedId?: string | null }) {
  const map = useMap();
  const target = hazards.find((h) => h.id === selectedId);
  const lat = target?.lat;
  const lng = target?.lng;
  useEffect(() => {
    if (lat !== undefined && lng !== undefined && !map.getBounds().pad(-0.2).contains([lat, lng])) {
      map.panTo([lat, lng]);
    }
  }, [map, lat, lng]);
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

function OsmLayer() {
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
}

function HazardMarker({
  hazard: h,
  selected,
  highlighted,
  compact,
  onSelect,
}: {
  hazard: HazardSummary;
  selected: boolean;
  highlighted: boolean;
  compact?: boolean;
  onSelect?: (id: string) => void;
}) {
  const ref = useRef<L.Marker>(null);
  const name = hazardAccessibleName(h);
  const icon = useMemo(() => hazardIcon(h, selected, highlighted), [h, selected, highlighted]);

  // react-leaflet never updates `title` after creation, so keep the accessible name current
  // ourselves (options.title too, because Leaflet re-applies it whenever the icon is swapped).
  useEffect(() => {
    const marker = ref.current;
    if (!marker) return;
    marker.options.title = name;
    const el = marker.getElement();
    el?.setAttribute("title", name);
    el?.setAttribute("aria-label", name);
  }, [name, icon]);

  return (
    <Marker
      ref={ref}
      position={[h.lat, h.lng]}
      icon={icon}
      title={name}
      keyboard={!compact}
      interactive={!compact}
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
}

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
}: MapProps) {
  return (
    <div role="region" aria-label={label} className="h-full w-full">
      <MapContainer
        center={center}
        zoom={zoom}
        preferCanvas
        className="h-full w-full"
        zoomControl={!compact}
        dragging={!compact}
        scrollWheelZoom={!compact}
        doubleClickZoom={!compact}
        keyboard={!compact}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {compact ? <Recenter center={center} zoom={zoom} /> : <PanToSelected hazards={hazards} selectedId={selectedId} />}
        {showOsm && <OsmLayer />}
        {hazards.map((h) => (
          <HazardMarker
            key={h.id}
            hazard={h}
            selected={h.id === selectedId}
            highlighted={h.id === highlightId}
            compact={compact}
            onSelect={onSelect}
          />
        ))}
      </MapContainer>
    </div>
  );
}
