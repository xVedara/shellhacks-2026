import type { HazardSummary } from "./api";

export type HazardMarkerProps = {
  hazard: HazardSummary;
  selected: boolean;
  highlighted: boolean;
  compact?: boolean;
  onSelect?: (id: string) => void;
};

/** True when a pin would draw and behave the same, so Leaflet can skip setIcon. */
export function sameHazardMarker(prev: HazardMarkerProps, next: HazardMarkerProps): boolean {
  if (prev.selected !== next.selected || prev.highlighted !== next.highlighted || prev.compact !== next.compact || prev.onSelect !== next.onSelect) return false;
  const a = prev.hazard;
  const b = next.hazard;
  return (
    a.id === b.id &&
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.category === b.category &&
    a.heightBand === b.heightBand &&
    a.confidence === b.confidence &&
    a.sample === b.sample &&
    a.label === b.label &&
    a.type === b.type &&
    a.status === b.status
  );
}
