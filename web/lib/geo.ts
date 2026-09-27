import { GRAHAM_CENTER } from "./api.ts";

/** Miles from FIU Graham Center, one decimal. Shared by the live list and the hazard page. */
export function milesFromGraham(lat: number, lng: number) {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat - GRAHAM_CENTER[0]);
  const dLng = toR(lng - GRAHAM_CENTER[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(GRAHAM_CENTER[0])) * Math.cos(toR(lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  return `${(meters / 1609.344).toFixed(1)} mi`;
}
