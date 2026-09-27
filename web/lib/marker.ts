// Pin chrome shared by the Leaflet map and the list/legend (no Leaflet import here).
// The glyph is a 1:1 crop of the locked sheet. Category is a colored edge plus a small M/T/P mark.
import { CATEGORY_META, HEIGHT_META, type HazardSummary } from "./api.ts";

/** Pin diameter in px: bigger means more community confidence. */
export const markerSize = (confidence: number) => Math.round(Math.min(40, Math.max(22, 24 + confidence * 3)));

export const typeIconSrc = (type: string) => `/hazard-icons/${encodeURIComponent(type)}.png`;

export const heightIconSrc = (band: HazardSummary["heightBand"]) => `/hazard-icons/height-${band}.png`;

/** Locked-sheet glyph, category edge, and the small M/T/P mark. No drawn substitute if the file is missing. */
export function markerHtml(h: Pick<HazardSummary, "category" | "type">, size: number, selected = false) {
  const { letter, color, ink } = CATEGORY_META[h.category];
  const src = typeIconSrc(h.type);
  return `<span class="ss-pin${selected ? " ss-pin--selected" : ""}" style="width:${size}px;height:${size}px;--pin-cat:${color};--pin-ink:${ink}"><img class="ss-pin__glyph" src="${src}" alt="" width="${size}" height="${size}" draggable="false" /><span class="ss-pin__mark">${letter}</span></span>`;
}

/** Includes the category mark and "Sample" in the order they are drawn, so the accessible name contains the visible label. */
export const hazardAccessibleName = (h: HazardSummary) => {
  const meta = CATEGORY_META[h.category];
  const sample = h.sample ? " Sample:" : "";
  return `${meta.letter}${sample} ${h.label || h.type}, ${meta.label.toLowerCase()}, ${HEIGHT_META[h.heightBand].label.toLowerCase()}, confidence ${h.confidence.toFixed(1)}`;
};
