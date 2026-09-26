// One-off: pull crossings, kerbs and tactile paving around FIU Graham Center from
// the Overpass API into public/osm-graham.json, so the demo never depends on Overpass.
// Run from web/: node scripts/fetch-osm.mjs   (data (c) OpenStreetMap contributors, ODbL)
import { writeFile } from "node:fs/promises";

const LAT = 25.7566, LNG = -80.3739, RADIUS_M = 800;
const around = `(around:${RADIUS_M},${LAT},${LNG})`;
const query = `[out:json][timeout:60];
(
  node["highway"="crossing"]${around};
  way["footway"="crossing"]${around};
  node["kerb"]${around};
  way["barrier"="kerb"]${around};
  node["tactile_paving"="yes"]${around};
  way["tactile_paving"="yes"]${around};
);
out geom;`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "StepSafe-hackathon/0.1" },
  body: "data=" + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
const { elements } = await res.json();

const kindOf = (t) =>
  t.kerb || t.barrier === "kerb" ? "kerb"
  : t.highway === "crossing" || t.footway === "crossing" ? "crossing"
  : "tactile";
const r = (n) => Math.round(n * 1e6) / 1e6;

const features = elements.map((e) => {
  const t = e.tags ?? {};
  const base = {
    id: `${e.type}/${e.id}`,
    kind: kindOf(t),
    tactile: t.tactile_paving === "yes",
    detail: t.crossing ?? t.kerb ?? null,
  };
  return e.type === "node"
    ? { ...base, lat: r(e.lat), lng: r(e.lon) }
    : { ...base, line: (e.geometry ?? []).map((p) => [r(p.lat), r(p.lon)]) };
});

const out = {
  attribution: "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
  fetchedAt: new Date().toISOString(),
  center: [LAT, LNG],
  radiusM: RADIUS_M,
  features,
};
await writeFile(new URL("../public/osm-graham.json", import.meta.url), JSON.stringify(out));
const count = (k) => features.filter((f) => f.kind === k).length;
console.log(`wrote ${features.length} features: crossing=${count("crossing")} kerb=${count("kerb")} tactile=${count("tactile")} (tactile-tagged: ${features.filter((f) => f.tactile).length})`);
