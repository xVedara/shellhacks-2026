// Marker drawing shared by the Leaflet map and the plain-HTML legend/list (no Leaflet import here).
import { CATEGORY_META, HEIGHT_META, type HazardSummary } from "./api";

/** Pin diameter in px: bigger means more community confidence. */
export const markerSize = (confidence: number) => Math.round(Math.min(40, Math.max(22, 24 + confidence * 3)));

/**
 * Color + letter = category (M moving, T temporary, P permanent).
 * Shape = height band (circle ground, triangle head, square drop-off).
 */
export function markerSvg(h: Pick<HazardSummary, "category" | "heightBand">, size: number, selected = false) {
  const { color, ink, letter } = CATEGORY_META[h.category];
  const s = size;
  const stroke = `stroke="#fff" stroke-width="2.5"`;
  let shape: string;
  let textY = s / 2;
  if (h.heightBand === "head") {
    shape = `<polygon points="${s / 2},2 ${s - 2},${s - 3} 2,${s - 3}" fill="${color}" ${stroke} stroke-linejoin="round"/>`;
    textY = s * 0.64;
  } else if (h.heightBand === "dropoff") {
    shape = `<rect x="3" y="3" width="${s - 6}" height="${s - 6}" rx="2" fill="${color}" ${stroke}/>`;
  } else {
    shape = `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 3}" fill="${color}" ${stroke}/>`;
  }
  const fontSize = Math.round(s * (h.heightBand === "head" ? 0.36 : 0.44));
  const text = `<text x="${s / 2}" y="${textY}" fill="${ink}" font-size="${fontSize}" font-weight="800" font-family="Inter, system-ui, sans-serif" text-anchor="middle" dominant-baseline="central">${letter}</text>`;
  const ring = selected
    ? `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 1}" fill="none" stroke="#081624" stroke-width="2" stroke-dasharray="3 2"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" focusable="false" style="overflow:visible;filter:drop-shadow(0 0 1.5px rgba(8,22,36,.95))">${shape}${text}${ring}</svg>`;
}

export const hazardAccessibleName = (h: HazardSummary) =>
  `${h.sample ? "Sample: " : ""}${h.label || h.type}, ${CATEGORY_META[h.category].label.toLowerCase()}, ${HEIGHT_META[h.heightBand].label.toLowerCase()}, confidence ${h.confidence.toFixed(1)}`;
