// Generates static named-pin-density mockups. Not used by the production app.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function write(rel, text) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function palette(dark) {
  return dark
    ? {
        land: "#171c22",
        park: "#1c3329",
        water: "#163246",
        road: "#313a46",
        roadMajor: "#3c4654",
        building: "#232a33",
        graham: "#2c3642",
        label: "#d5dbe3",
        soft: "#9aa3ae",
        roadLabel: "#8e98a4",
        tree: "#2c4d3b",
        tree2: "#3d6a50",
        path: "#3a463c",
        hatch: "#1e262f",
        hatchLine: "#3a4552",
        walk: "#222a33",
        pole: "#b7c0ca",
        curb: "#3a4450",
      }
    : {
        land: "#e4e2dc",
        park: "#c5d8c2",
        water: "#c2d7e6",
        road: "#f7f7f5",
        roadMajor: "#ffffff",
        building: "#f4f3ef",
        graham: "#fbfaf7",
        label: "#3e4854",
        soft: "#5c6570",
        roadLabel: "#7d756c",
        tree: "#8aaf86",
        tree2: "#6d9870",
        path: "#c9bba6",
        hatch: "#e6e0d6",
        hatchLine: "#d0c8bb",
        walk: "#eceae4",
        pole: "#4e5854",
        curb: "#d5cfc4",
      };
}

function svgDoc(body, w = 1200, h = 800) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${body}
</svg>
`;
}

function text(x, y, value, fill, size, weight = 600, anchor = "middle") {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle">${esc(value)}</text>`;
}

function lines(cx, cy, value, fill, size = 12, weight = 600) {
  const parts = String(value).split("\n");
  const lh = size + 3;
  const y0 = cy - ((parts.length - 1) * lh) / 2;
  return parts.map((line, i) => text(cx, y0 + i * lh, line, fill, size, weight)).join("");
}

function overview(dark) {
  const p = palette(dark);
  const roads = [
    [0, 108, 1200, 36, true],
    [0, 292, 1200, 16, false],
    [0, 478, 1200, 14, false],
    [0, 668, 1200, 22, true],
  ];
  const verts = [
    [96, 0, 34, 800, true],
    [338, 0, 12, 800, false],
    [572, 0, 14, 800, false],
    [812, 0, 14, 800, false],
    [1048, 0, 18, 800, true],
  ];
  const buildings = [
    [132, 148, 168, 108, "Chemistry"],
    [368, 146, 172, 112, "Education"],
    [604, 140, 176, 122, "Academic\nHealth"],
    [844, 154, 168, 100, "Viertes Haus"],
    [128, 322, 176, 124, "Green\nLibrary"],
    [368, 318, 78, 64, ""],
    [458, 348, 92, 96, ""],
    [604, 314, 176, 136, "Graham\nCenter", "graham"],
    [842, 326, 172, 118, "Owa Ehan"],
    [136, 508, 164, 118, "Student\nCenter"],
    [366, 516, 176, 112, "Gold\nGarage", "hatch"],
    [604, 508, 92, 72, "Market"],
    [712, 530, 72, 88, ""],
    [840, 504, 176, 128, "Primera\nCasa"],
    [150, 700, 120, 72, ""],
    [860, 698, 150, 74, ""],
  ];
  const parks = [
    [1070, 140, 118, 300],
    [130, 698, 400, 86],
    [1072, 510, 112, 150],
    [600, 456, 150, 16],
  ];
  let trees = "";
  const rand = mulberry(3);
  for (const [x, y, w, h] of [
    [1076, 150, 100, 270],
    [150, 708, 360, 64],
    [1080, 524, 92, 120],
  ]) {
    const n = Math.round((w * h) / 1800);
    for (let i = 0; i < n; i++) {
      const cx = x + 8 + rand() * (w - 16);
      const cy = y + 8 + rand() * (h - 16);
      const r = 4 + rand() * 5;
      trees += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${rand() > 0.45 ? p.tree : p.tree2}"/>`;
    }
  }
  for (let x = 150; x < 1000; x += 54) {
    trees += `<circle cx="${x}" cy="72" r="5.5" fill="${p.tree}"/>`;
  }

  const roadShapes = [
    ...roads.map(([x, y, w, h, major]) => `<rect x="${x}" y="${y - h / 2}" width="${w}" height="${h}" fill="${major ? p.roadMajor : p.road}"/>`),
    ...verts.map(([x, y, w, h, major]) => `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" fill="${major ? p.roadMajor : p.road}"/>`),
    `<circle cx="1048" cy="478" r="36" fill="${p.roadMajor}"/>`,
    `<circle cx="1048" cy="478" r="16" fill="${p.park}"/>`,
  ].join("");

  const zebras = [
    zebra(572, 108, true, p),
    zebra(572, 292, false, p),
    zebra(572, 478, false, p),
    zebra(338, 668, true, p),
    zebra(812, 292, false, p),
  ].join("");

  const blocks = buildings
    .map(([x, y, w, h, name, kind]) => {
      if (kind === "graham") {
        return `<rect x="646" y="352" width="96" height="64" rx="2" fill="${p.park}"/>
          <path fill="${p.graham}" fill-rule="evenodd" d="M${x} ${y}h${w}v${h}h-${w}z M652 358h84v52h-84z"/>
          ${lines(x + w / 2, y + h / 2 + 8, name, p.label, 13, 700)}`;
      }
      const fill = kind === "hatch" ? "url(#hatch)" : p.building;
      const base = kind === "hatch" ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${p.hatch}"/>` : "";
      return `${base}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}"/>${name ? lines(x + w / 2, y + h / 2, name, p.label, 12, 600) : ""}`;
    })
    .join("");

  const labels = [
    text(640, 112, "SW 8th St", p.roadLabel, 12, 600),
    `<text x="96" y="390" fill="${p.roadLabel}" font-family="system-ui, sans-serif" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90 96 390)">SW 107th Ave</text>`,
    text(760, 672, "SW 14th St", p.roadLabel, 12, 600),
    `<text x="1048" y="250" fill="${p.roadLabel}" font-family="system-ui, sans-serif" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90 1048 250)">E Campus Cir</text>`,
    text(1130, 740, "Lakeview", p.soft, 12, 600),
    text(1164, 36, "N", p.soft, 11, 700),
  ].join("");

  return svgDoc(`<rect width="1200" height="800" fill="${p.land}"/>
    <defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><line x1="0" y1="0" x2="0" y2="7" stroke="${p.hatchLine}" stroke-width="1.25"/></pattern></defs>
    ${parks.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${p.park}"/>`).join("")}
    <ellipse cx="1136" cy="742" rx="52" ry="28" fill="${p.water}"/>
    <path d="M160 742 H500" fill="none" stroke="${p.path}" stroke-width="2" stroke-dasharray="2 7"/>
    ${roadShapes}
    ${zebras}
    ${blocks}
    ${trees}
    <circle cx="454" cy="572" r="9" fill="none" stroke="${p.soft}" stroke-width="1.4"/>
    ${text(454, 572, "P", p.soft, 10, 700)}
    <path d="M1164 18 v16 M1164 18 l-3.5 4.5 M1164 18 l3.5 4.5" fill="none" stroke="${p.soft}" stroke-width="1.4" stroke-linecap="round"/>
    ${labels}`);
}

function zebra(x, y, vertical, p) {
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += vertical
      ? `<rect x="${x - 14}" y="${y - 18 + i * 8}" width="28" height="3.5" fill="${p.land}"/>`
      : `<rect x="${x - 18 + i * 8}" y="${y - 12}" width="3.5" height="24" fill="${p.land}"/>`;
  }
  return out;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function fourteenth(dark) {
  const p = palette(dark);
  const curve = "M-40 590 C 220 520, 480 500, 760 545 S 1100 610, 1280 560";
  let trees = "";
  const spots = [
    [120, 250], [168, 228], [214, 268], [90, 320], [260, 210],
    [340, 240], [400, 190], [470, 230], [90, 430], [150, 400],
    [980, 360], [1040, 330], [1100, 390], [900, 400], [860, 340],
  ];
  spots.forEach(([x, y], i) => {
    trees += `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 16 : 12}" fill="${i % 2 ? p.tree : p.tree2}"/>`;
  });
  return svgDoc(`<rect width="1200" height="800" fill="${p.land}"/>
    <ellipse cx="180" cy="700" rx="150" ry="70" fill="${p.water}"/>
    <rect x="620" y="0" width="580" height="310" fill="${p.building}"/>
    <rect x="648" y="28" width="250" height="18" fill="${p.park}"/>
    ${lines(910, 150, "Primera Casa", p.label, 18, 650)}
    <rect x="70" y="70" width="250" height="150" rx="2" fill="${p.building}"/>
    ${lines(195, 145, "Market", p.label, 14, 600)}
    <path d="${curve}" fill="none" stroke="${p.walk}" stroke-width="168" stroke-linecap="round"/>
    <path d="${curve}" fill="none" stroke="${p.road}" stroke-width="78" stroke-linecap="round"/>
    <path d="${curve}" fill="none" stroke="${p.curb}" stroke-width="2" stroke-dasharray="10 14" stroke-linecap="round"/>
    <polygon points="500,470 690,458 724,545 474,560" fill="${p.walk}" stroke="${p.curb}" stroke-width="2"/>
    <polygon points="548,508 656,500 674,542 530,552" fill="${p.road}"/>
    ${trees}
    ${text(150, 688, "Lakeview", p.soft, 13, 600)}
    ${text(430, 430, "Southwest 14th Street", p.roadLabel, 14, 600)}`);
}

function graham(dark) {
  const p = palette(dark);
  let cols = "";
  for (let i = 0; i < 5; i++) cols += `<rect x="500" y="${120 + i * 120}" width="16" height="64" rx="2" fill="${p.building}"/>`;
  return svgDoc(`<rect width="1200" height="800" fill="${p.land}"/>
    <rect x="0" y="0" width="470" height="800" fill="${p.building}"/>
    <rect x="36" y="36" width="398" height="64" fill="${dark ? "#1e2730" : "#e7e4dc"}"/>
    ${lines(235, 68, "Graham Center", p.label, 20, 650)}
    ${[160, 280, 420, 560, 700].map((y) => `<rect x="48" y="${y}" width="120" height="78" fill="${dark ? "#1b232c" : "#eae7e0"}"/>`).join("")}
    <rect x="470" y="0" width="210" height="800" fill="${p.walk}"/>
    ${cols}
    ${text(575, 70, "covered walk", p.soft, 13, 600)}
    <rect x="700" y="80" width="460" height="640" rx="4" fill="${p.park}"/>
    <circle cx="820" cy="180" r="28" fill="${p.tree2}"/>
    <circle cx="980" cy="150" r="34" fill="${p.tree}"/>
    <circle cx="1040" cy="280" r="22" fill="${p.tree2}"/>
    <circle cx="860" cy="340" r="26" fill="${p.tree}"/>
    <circle cx="1000" cy="460" r="30" fill="${p.tree2}"/>
    <circle cx="820" cy="520" r="20" fill="${p.tree}"/>
    <rect x="789" y="210" width="8" height="300" rx="1" fill="${p.pole}"/>
    <rect x="789" y="372" width="58" height="7" rx="1" fill="${p.pole}"/>
    ${text(930, 620, "quad", p.soft, 13, 600)}`);
}

function keyMap(dark) {
  const p = palette(dark);
  return svgDoc(
    `<rect width="1200" height="500" fill="${p.land}"/>
    <rect x="40" y="36" width="280" height="150" rx="2" fill="${p.building}"/>
    ${lines(180, 110, "Graham Center", p.label, 16, 600)}
    <rect x="860" y="40" width="280" height="170" rx="2" fill="${p.building}"/>
    ${lines(1000, 120, "Library", p.label, 16, 600)}
    <circle cx="400" cy="90" r="18" fill="${p.tree}"/>
    <circle cx="470" cy="120" r="14" fill="${p.tree2}"/>
    <circle cx="740" cy="80" r="16" fill="${p.tree}"/>
    <rect x="0" y="300" width="1200" height="78" fill="${p.roadMajor}"/>
    <rect x="560" y="0" width="54" height="500" fill="${p.road}"/>
    <rect x="0" y="276" width="1200" height="22" fill="${p.walk}"/>
    <rect x="0" y="378" width="1200" height="18" fill="${p.walk}"/>
    ${text(240, 342, "campus walk", p.roadLabel, 13, 600)}`,
    1200,
    500,
  );
}

const ICO = {
  map: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 4.5h15v15h-15zM8.5 12l2.5 2.5 4.5-5"/></svg>`,
  sun: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>`,
  moon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>`,
  back: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>`,
  hazard: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4L12 3.5Zm0 6v4.5m0 2.6v.1"/></svg>`,
  clock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.6l3 1.8"/></svg>`,
  eye: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  ok: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9.2 2.7 2.7L16.2 9"/></svg>`,
  info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5m0-8.2v.1"/></svg>`,
  photo: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M9.5 5h5l1.5 2H19a2 2 0 0 1 2 2v8.5M17.5 19H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.5M9.9 10.2a3 3 0 0 0 4 4"/></svg>`,
  signal: `<svg width="16" height="12" viewBox="0 0 17 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx=".5" fill="currentColor"/><rect x="4.5" y="5" width="3" height="7" rx=".5" fill="currentColor"/><rect x="9" y="2.5" width="3" height="9.5" rx=".5" fill="currentColor"/><rect x="13.5" y="0" width="3" height="12" rx=".5" fill="currentColor"/></svg>`,
  wifi: `<svg width="15" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M1 4.2c4-3.2 10-3.2 14 0"/><path d="M3.5 7c2.6-2 6.4-2 9 0"/><path d="M8 10.2h.01"/></svg>`,
  battery: `<svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true"><rect x="0.6" y="0.6" width="21" height="10.8" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2.2" y="2.2" width="16" height="7.6" rx="1" fill="currentColor"/><path d="M23 4.2v3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};

function logo() {
  const eye = `<path d="M6.2 16.2c2.3-3.5 5-5.3 9.8-5.3s7.5 1.8 9.8 5.3c-2.3 3.5-5 5.3-9.8 5.3s-7.5-1.8-9.8-5.3z" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="16" cy="16.2" r="2.2" fill="#fff"/>`;
  return `<svg class="logo logo-light" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#087FF5"/>${eye}</svg>
    <svg class="logo logo-dark" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#081624" stroke="#31465c"/>${eye}</svg>`;
}

const CAT = { moving: ["Moving", "M"], temporary: ["Temporary", "T"], permanent: ["Permanent", "P"] };
const HEIGHT = { ground: "Ground level", head: "Head height", dropoff: "Drop-off" };
const bar = (c) => Math.max(6, Math.min(100, ((c + 2) / 7) * 100));

const FEED = [
  { name: "curb", cat: "permanent", height: "ground", seen: "22 minutes ago", conf: 1.4, fresh: true },
  { name: "pole at head height", cat: "permanent", height: "head", seen: "2 hours ago", conf: 1.0, href: "hazard" },
  { name: "drop-off: pothole", cat: "permanent", height: "dropoff", seen: "3 hours ago", conf: 1.0, sample: true },
  { name: "e-scooter", cat: "moving", height: "ground", seen: "4 hours ago", conf: 0.8, sample: true },
  { name: "pole", cat: "permanent", height: "ground", seen: "4 hours ago", conf: 2.2 },
  { name: "planter", cat: "permanent", height: "ground", seen: "4 hours ago", conf: 3.1 },
  { name: "uneven pavement", cat: "permanent", height: "ground", seen: "5 hours ago", conf: 1.8 },
  { name: "trash bin", cat: "moving", height: "ground", seen: "5 hours ago", conf: 1.0, sample: true },
  { name: "scaffolding", cat: "temporary", height: "head", seen: "6 hours ago", conf: 3.0 },
  { name: "open trench", cat: "temporary", height: "dropoff", seen: "6 hours ago", conf: 2.6 },
  { name: "drop-off", cat: "moving", height: "dropoff", seen: "8 hours ago", conf: 0.4, sample: true, href: "verify", typeNote: "type “ramp”" },
  { name: "construction barrier", cat: "temporary", height: "ground", seen: "yesterday", conf: 4.0 },
];

const OVERVIEW_PINS = [
  { kind: "cluster", name: "pavement", count: 5, x: 22, y: 22 },
  { kind: "cluster", name: "pothole", count: 4, x: 46, y: 36 },
  { kind: "cluster", name: "pole", count: 5, x: 70, y: 28 },
  { kind: "cluster", name: "curb", count: 7, x: 34, y: 58 },
  { kind: "cluster", name: "planter", count: 4, x: 74, y: 52 },
  { kind: "precise", name: "pole · head", x: 84, y: 24, href: "hazard" },
  { kind: "precise", name: "e-scooter", x: 16, y: 40, sample: true },
  { kind: "precise", name: "drop-off", x: 20, y: 64, sample: true, href: "verify" },
  { kind: "precise", name: "trench", x: 88, y: 44 },
  { kind: "precise", name: "trash bin", x: 78, y: 70, sample: true },
  { kind: "precise", name: "scaffolding", x: 48, y: 74 },
];

const VERIFY_PIN = [{ kind: "precise", name: "drop-off", place: "ramp · SW 14th", x: 52, y: 62, sample: true, selected: true }];
const HAZARD_PIN = [{ kind: "precise", name: "pole at head height", place: "Graham · covered walk", x: 66, y: 48, selected: true }];

function pinHtml(p, theme) {
  const cls = ["pin", p.kind === "cluster" ? "pin--cluster" : "pin--precise", p.sample ? "is-sample" : "", p.selected ? "is-selected" : ""]
    .filter(Boolean)
    .join(" ");
  const style = `left:${p.x}%;top:${p.y}%;z-index:${p.selected ? 30 : Math.round(p.y)}`;
  const label = `${p.name}${p.count ? `, ${p.count} collapsed here` : ""}${p.place ? `, ${p.place}` : ""}${p.sample ? ", sample" : ""}`;
  const inner = `<span class="pin__label"><span class="pin__name">${esc(p.name)}</span>${p.place ? `<span class="pin__place">${esc(p.place)}</span>` : ""}${p.count ? `<span class="pin__count">${p.count}</span>` : ""}</span><span class="pin__stem" aria-hidden="true"></span><span class="pin__anchor" aria-hidden="true"></span>`;
  if (p.href) return `<a class="${cls}" style="${style}" href="${p.href}-${theme}.html" aria-label="${esc(label)}">${inner}</a>`;
  return `<div class="${cls}" style="${style}" aria-label="${esc(label)}">${inner}</div>`;
}

function legendHtml() {
  return `<div class="legend">
    <p class="legend__title">Named hazards</p>
    <div class="legend__row"><i class="chip--dot" aria-hidden="true"></i><span class="chip">curb<b>7</b></span></div>
    <div class="legend__row"><i class="chip--sq" aria-hidden="true"></i><span class="chip">drop-off</span></div>
    <p class="legend__note">A round mark is several hazards of one name. A square mark is one hazard. Dashed labels are samples. Confidence stays in the list.</p>
  </div>`;
}

function mapInner(base, pins, theme, { legend = false, prefix = "../assets/" } = {}) {
  return `<img class="mapbg mapbg--light" alt="" src="${prefix}${base}-light.svg">
    <img class="mapbg mapbg--dark" alt="" src="${prefix}${base}-dark.svg">
    ${pins.map((p) => pinHtml(p, theme)).join("")}
    <p class="map-attr">Schematic campus drawing</p>
    <div class="zoom" aria-hidden="true"><span>+</span><span>−</span></div>
    ${legend ? legendHtml() : ""}`;
}

function profile() {
  return `<div class="profile">
    <span class="avatar" aria-hidden="true">N</span>
    <p><span class="profile__name">Neighbor-5ae3</span><span class="profile__meta">0 karma · verifier</span></p>
  </div>`;
}

function themeLink(screen, theme, surface) {
  const next = theme === "light" ? "dark" : "light";
  const href = `${screen}-${next}.html`;
  const icon = theme === "dark" ? ICO.moon : ICO.sun;
  const pressed = theme === "dark" ? "true" : "false";
  if (surface === "desktop") {
    return `<a class="theme-btn" href="${href}" aria-pressed="${pressed}">${icon}<span>Dark theme</span></a>`;
  }
  return `<a class="theme-btn" href="${href}" aria-pressed="${pressed}">${icon}<span class="sr-only">Dark theme</span></a>`;
}

function nav(active, theme, layout) {
  const items = [
    ["live-map", "Live map", ICO.map],
    ["verify", "Verify queue", ICO.check],
  ];
  return items
    .map(([id, label, icon]) => {
      const on = active === id ? ` aria-current="page"` : "";
      return `<a href="${id}-${theme}.html"${on}>${icon}${label}</a>`;
    })
    .join("");
}

function metrics() {
  const items = [
    ["tint-orange", ICO.hazard, "Active hazards", "31", "18 sample · 13 real · 3 miles", ""],
    ["tint-blue", ICO.clock, "Last hour", "1", "Reported or seen again · 0 sample", ""],
    ["tint-blue", ICO.eye, "Awaiting check", "31", "Not yet verified here · 18 sample", ""],
    ["tint-mute", ICO.ok, "Cleared today", "0", "Seen clearing live on this page", ""],
  ];
  const cards = items
    .map(
      ([tint, icon, label, value, note]) => `<article class="metric">
        <span class="metric__icon ${tint}">${icon}</span>
        <div><p class="metric__label">${label}</p><p class="metric__value">${value}</p><p class="metric__note">${note}</p></div>
      </article>`,
    )
    .join("");
  return `<section class="metrics" aria-label="Summary">${cards}
    <article class="metric metric--live">
      <span class="metric__icon tint-signal"><span class="dot" aria-hidden="true"></span></span>
      <div class="metric__body">
        <p class="metric__label">Stream</p>
        <p class="metric__value"><span class="dot phone-dot" aria-hidden="true"></span> Live</p>
        <p class="metric__note">Updated just now</p>
      </div>
    </article>
  </section>`;
}

function feedRows(theme) {
  const rows = FEED.map((h) => {
    const [cat, letter] = CAT[h.cat];
    const meta = `${cat} · ${HEIGHT[h.height]} · seen ${h.seen}`;
    const title = `${esc(h.name)}${h.sample ? ` <span class="badge">Sample</span>` : ""}${h.fresh ? ` <span class="badge badge--new">New</span>` : ""}`;
    const body = `<span class="tile" title="${esc(cat)}">${letter}</span>
      <span class="row__text"><span class="row__title">${title}</span><span class="row__meta">${esc(meta)}</span></span>
      <span class="conf" aria-label="confidence ${h.conf.toFixed(1)}"><span class="conf__n">${h.conf.toFixed(1)}</span><span class="conf__track"><span class="conf__bar" style="width:${bar(h.conf).toFixed(1)}%"></span></span></span>`;
    if (h.href) return `<a class="row" href="${h.href}-${theme}.html">${body}</a>`;
    return `<div class="row">${body}</div>`;
  }).join("");
  return `<div class="feed-scroll"><h2 class="sr-only">Active hazards</h2>${rows}<p class="feed-more">19 more, most recently seen first</p></div>`;
}

function feedPanel(theme) {
  return `<aside class="panel feed-card" aria-label="Hazard feed">
    <div class="panel__head">
      <div><h2>Active hazards <span class="count">31</span></h2><p class="panel__sub">Most recently seen first. Select one for details.</p></div>
    </div>
    <details class="legend-disclosure"><summary>Map legend</summary>${legendHtml()}</details>
    ${feedRows(theme)}
  </aside>`;
}

function liveMapBody(theme) {
  return `<p class="lede">Hazards reported by StepSafe walkers within 3 miles of FIU Graham Center. Updates arrive live.</p>
    ${metrics()}
    <div class="work">
      <section class="panel map-card" aria-labelledby="map-heading">
        <div class="panel__head">
          <div><h2 id="map-heading">Map</h2><p class="panel__sub">FIU Graham Center · a short name at this zoom. A count is that name, collapsed.</p></div>
          <label class="check"><input type="checkbox"> OpenStreetMap layer</label>
        </div>
        <div class="map-stage">
          <p class="sr-only">Schematic map. Nearby hazards of one kind share a short name. A lone hazard keeps its name on a square mark.</p>
          <div class="map-ratio">${mapInner("map-overview", OVERVIEW_PINS, theme, { legend: true })}</div>
        </div>
      </section>
      ${feedPanel(theme)}
    </div>`;
}

function headingBlock(name, cat, height, type, sample, as = "h2") {
  const [catLabel, letter] = CAT[cat];
  return `<div class="hazard-title">
    <span class="tile" title="${esc(catLabel)}">${letter}</span>
    <div><${as}>${esc(name)}${sample ? ` <span class="badge">Sample</span>` : ""}</${as}>
    <p>${esc(catLabel)} · ${esc(HEIGHT[height])} · type “${esc(type)}”</p></div>
  </div>`;
}

function verifyBody(theme) {
  return `<div class="queue-head">
      <p class="lede">Least-confident hazards first. Is it still there? Shortcuts: <kbd>U</kbd> upvote, <kbd>D</kbd> downvote, <kbd>S</kbd> skip (when no button or link is focused).</p>
      <div class="panel progress-card">
        <p><strong>31</strong> left to review</p>
        <div class="track" role="progressbar" aria-label="Hazards checked from this device" aria-valuemin="0" aria-valuemax="31" aria-valuenow="0"><span></span></div>
        <p class="fine">0 of 31 checked from this device</p>
      </div>
    </div>
    <article class="panel verify" id="verify-card" aria-labelledby="verify-heading">
      <div class="verify__main">
        <div id="verify-heading">${headingBlock("drop-off", "moving", "dropoff", "ramp", true)}</div>
        <div class="notice">${ICO.info}<div><strong>Sample hazard</strong><p>Seeded for the demo, not a real report. Votes still count for the demo.</p></div></div>
        <div class="empty-photo">${ICO.photo}<span>No photo was sent with this report</span></div>
      </div>
      <div class="verify__side">
        <div class="mini-map"><div class="map-ratio">${mapInner("map-14th", VERIFY_PIN, theme)}</div></div>
        <dl class="facts">
          <div><dt>Confidence</dt><dd>0.4</dd></div>
          <div><dt>Clearance</dt><dd>Not measured</dd></div>
          <div><dt>Width left</dt><dd>Not measured</dd></div>
        </dl>
        <a class="link" href="hazard-${theme}.html">Full details and vote history</a>
      </div>
      <div class="votes">
        <button class="vote vote--yes" type="button"><b>▲ Still there</b><span>Upvote<span class="desk-only"> · U</span></span></button>
        <button class="vote" type="button"><b>▼ Gone</b><span>Not a hazard<span class="desk-only"> · D</span></span></button>
        <button class="vote" type="button"><b>Skip</b><span>Decide later<span class="desk-only"> · S</span></span></button>
      </div>
      <div class="row-actions">
        <button class="btn btn--ghost" type="button">Reclassify…</button>
        <button class="btn btn--ghost" type="button">Report…</button>
      </div>
    </article>`;
}

function hazardBody(theme) {
  return `<div class="detail-grid">
    <article class="panel detail-main">
      ${headingBlock("pole at head height", "permanent", "head", "pole", false)}
      <img class="crop" src="../assets/crop-pole.svg" alt="Camera crop of the reported pole at head height">
      <dl class="facts facts--2">
        <div><dt>Clearance height</dt><dd>5.6 ft</dd></div>
        <div><dt>Remaining sidewalk width</dt><dd>4.1 ft</dd></div>
        <div><dt>Confidence</dt><dd>1.0 (cleared below −2)</dd></div>
        <div><dt>Severity</dt><dd>2 of 3</dd></div>
        <div><dt>Last seen</dt><dd>2 hours ago</dd></div>
        <div><dt>Expires</dt><dd>in 89 days <span style="font-weight:500;color:var(--ink-3)">(clears after 90 days without an upvote)</span></dd></div>
        <div><dt>First reported</dt><dd>Sep 26, 2026, 10:14 PM</dd></div>
        <div><dt>Spoken in Spanish</dt><dd lang="es">poste a la altura de la cabeza</dd></div>
      </dl>
      <section class="section"><h3>Pending reclassifications</h3><p>None. A change applies when 3 people propose it.</p></section>
      <section class="section"><h3>Vote history (1)</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>When</th><th>Vote</th><th>From</th><th class="num">Weight</th></tr></thead>
          <tbody><tr><td>2 hours ago</td><td>▲ Still there</td><td>Scout</td><td class="num">1.00</td></tr></tbody>
        </table></div>
      </section>
    </article>
    <aside class="panel detail-map" aria-label="Location">
      <div class="map-stage"><div class="map-ratio">${mapInner("map-graham", HAZARD_PIN, theme)}</div></div>
    </aside>
  </div>`;
}

function pagebar(title, actions) {
  return `<div class="pagebar"><h1>${title}</h1><div class="pagebar__actions">${actions}</div></div>`;
}

function deskShell(screen, theme, actions, inner, live) {
  const current = screen === "hazard" ? "" : screen;
  return `<div class="desk">
    <header class="sidebar">
      <a class="brand" href="live-map-${theme}.html">${logo()}<span><span class="brand__name">StepSafe</span><span class="brand__sub">Community hazard map</span></span></a>
      <nav class="nav" aria-label="Main">${nav(current, theme)}</nav>
      <div class="sidebar__foot">${themeLink(screen, theme, "desktop")}${profile()}</div>
    </header>
    <div class="main">
      ${pagebar(screen === "live-map" ? "Live map" : screen === "verify" ? "Verify queue" : "Hazard details", actions)}
      <div class="content${screen === "live-map" ? "" : ""}">${inner}</div>
    </div>
  </div>`;
}

function phoneChrome(screen, theme, surface) {
  const current = screen === "hazard" ? "" : screen;
  if (surface === "mobile-app") {
    const back =
      screen === "hazard"
        ? `<div class="appbar"><a href="live-map-${theme}.html">${ICO.back} Map</a></div>`
        : "";
    const tabs =
      screen === "hazard"
        ? ""
        : `<nav class="tabbar" aria-label="Main">
            <a href="live-map-${theme}.html"${current === "live-map" ? ` aria-current="page"` : ""}>${ICO.map}Live map</a>
            <a href="verify-${theme}.html"${current === "verify" ? ` aria-current="page"` : ""}>${ICO.check}Verify</a>
          </nav>`;
    return { top: `<div class="status"><span>9:41</span><span class="status__icons">${ICO.signal}${ICO.wifi}${ICO.battery}</span></div>${back}`, bottom: `${tabs}<div class="homebar" aria-hidden="true"></div>` };
  }
  return {
    top: `<div class="browserbar"><span aria-hidden="true">Aa</span><div class="browserbar__url">${ICO.check} stepsafe.app</div></div>
      <div class="mhead">
        <a class="brand" href="live-map-${theme}.html">${logo()}<span><span class="brand__name">StepSafe</span><span class="brand__sub">Community hazard map</span></span></a>
        <div class="mhead__end">${profile()}${themeLink(screen, theme, "phone")}</div>
      </div>
      <nav class="tabs" aria-label="Main">${nav(current, theme)}</nav>`,
    bottom: "",
  };
}

function doc({ title, theme, bodyClass, css, body }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${theme}">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="${css}">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>
`;
}

function renderScreen(surface, screen, theme) {
  const titles = { "live-map": "Live map", verify: "Verify queue", hazard: "Hazard details" };
  const inner = screen === "live-map" ? liveMapBody(theme) : screen === "verify" ? verifyBody(theme) : hazardBody(theme);
  const verifyActions = `${`<label class="check"><input type="checkbox" checked> Keyboard shortcuts</label>`}<span class="live-pill"><span class="dot" aria-hidden="true"></span> Live</span>`;
  const liveActions = `<a class="btn btn--primary" href="verify-${theme}.html">Verify hazards</a>`;
  const hazardActions = `<a class="link" href="live-map-${theme}.html">← Back to the map</a>`;
  const actions = screen === "live-map" ? liveActions : screen === "verify" ? verifyActions : hazardActions;

  if (surface === "desktop") {
    const cls = `is-desk${screen === "live-map" ? " is-live" : ""}`;
    return doc({
      title: `${titles[screen]} · StepSafe`,
      theme,
      bodyClass: cls,
      css: "../assets/mock.css",
      body: deskShell(screen, theme, actions, inner),
    });
  }

  const chrome = phoneChrome(screen, theme, surface);
  const appTitle =
    surface === "mobile-app" && screen !== "hazard"
      ? `<div class="phone-title"><h1>${titles[screen]}</h1>${screen === "live-map" ? `<a class="btn btn--primary" href="verify-${theme}.html">Verify hazards</a>` : ""}</div>${screen === "verify" ? `<div class="pagebar__actions" style="padding:4px 16px 0">${verifyActions}</div>` : ""}`
      : "";
  const mwebBar = surface === "mobile-web" ? pagebar(titles[screen], actions) : "";
  const appHazardTitle = surface === "mobile-app" && screen === "hazard" ? pagebar("Hazard details", "") : "";
  const body = `<div class="device">${chrome.top}<div class="device__scroll">${appTitle}${appHazardTitle}${mwebBar}<div class="phone-pad">${inner}</div></div>${chrome.bottom}</div>`;
  const cls = `is-phone ${surface === "mobile-app" ? "is-app" : "is-mweb"}${screen === "live-map" ? " is-live" : ""}`;
  return doc({
    title: `${titles[screen]} · StepSafe`,
    theme,
    bodyClass: cls,
    css: "../assets/mock.css",
    body,
  });
}

function index() {
  const groups = [
    ["Desktop", "desktop", "desk"],
    ["Mobile web", "mobile-web", "phone"],
    ["Mobile app", "mobile-app", "phone"],
  ];
  const screens = [
    ["live-map", "Live map"],
    ["verify", "Verify"],
    ["hazard", "Hazard"],
  ];
  const themes = [
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  const blocks = groups
    .map(([label, folder, kind]) => {
      const cards = themes
        .flatMap(([theme, themeLabel]) =>
          screens.map(([screen, screenLabel]) => {
            const href = `${folder}/${screen}-${theme}.html`;
            return `<a class="frame frame--${kind}" href="${href}"><span class="frame__viewport"><iframe src="${href}" tabindex="-1" title=""></iframe></span><span class="frame__cap"><span>${screenLabel}</span><span>${themeLabel}</span></span></a>`;
          }),
        )
        .join("");
      return `<h2>${label}</h2><div class="${kind === "desk" ? "grid-desk" : "grid-phone"}">${cards}</div>`;
    })
    .join("");

  const keyPins = [
    { kind: "cluster", name: "curb", count: 7, x: 22, y: 78 },
    { kind: "precise", name: "e-scooter", x: 48, y: 74, sample: true },
    { kind: "precise", name: "pole at head height", place: "Graham · covered walk", x: 74, y: 70, selected: true },
  ];
  const body = `<div class="gallery">
    <header class="mast">
      <a class="brand" href="desktop/live-map-light.html">${logo()}<span><span class="brand__name">StepSafe</span><span class="brand__sub">Static mockups</span></span></a>
      <h1>Named pin density</h1>
      <p class="lede">The live map, verify queue, and hazard details stay put. Desktop keeps the sidebar. Phones keep two destinations. On the map, nearby hazards of one kind collapse to a short name. One hazard keeps that name on a precise mark.</p>
    </header>
    <h2>How a name sits on the map</h2>
    <div class="key">
      <div class="key__map"><div class="map-ratio">${mapInner("map-key", keyPins, "light", { prefix: "assets/", legend: false })}</div></div>
      <dl class="key__notes">
        <div><dt><span class="chip">curb<b>7</b></span></dt><dd>Several curbs share one label at this zoom. The round mark is the group.</dd></div>
        <div><dt><span class="chip" style="border-style:dashed;border-left-style:solid">e-scooter</span></dt><dd>One hazard, named on a square mark. A dashed edge means sample data.</dd></div>
        <div><dt><span class="chip" style="background:#081624;color:#fff;border-color:#081624">pole at head height</span></dt><dd>The open hazard inverts. The second line is the precise place.</dd></div>
      </dl>
    </div>
    ${blocks}
    <footer>Draft exploration for review. These files do not change the StepSafe app. Orange is the hazard bar only.</footer>
  </div>`;
  return doc({
    title: "Named pin density · StepSafe mockups",
    theme: "light",
    bodyClass: "is-gallery",
    css: "assets/mock.css",
    body,
  });
}

const crop = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <rect width="800" height="450" fill="#d5dde4"/>
  <rect x="470" y="0" width="330" height="280" fill="#c5ccd3"/>
  <rect x="500" y="36" width="70" height="110" fill="#b7c0c8"/>
  <rect x="590" y="48" width="54" height="98" fill="#b7c0c8"/>
  <rect x="664" y="28" width="86" height="130" fill="#aeb7c0"/>
  <rect x="0" y="250" width="800" height="200" fill="#d9d4cc"/>
  <rect x="0" y="248" width="800" height="10" fill="#cfc8bc"/>
  <rect x="0" y="300" width="520" height="150" fill="#c5d3bf"/>
  <circle cx="120" cy="250" r="46" fill="#8eaa8c"/>
  <circle cx="190" cy="236" r="34" fill="#7ea184"/>
  <rect x="392" y="78" width="10" height="250" fill="#4a534e"/>
  <rect x="392" y="168" width="74" height="8" fill="#4a534e"/>
  <rect x="0" y="392" width="800" height="58" fill="#c8c2b8"/>
</svg>
`;

write("assets/map-overview-light.svg", overview(false));
write("assets/map-overview-dark.svg", overview(true));
write("assets/map-14th-light.svg", fourteenth(false));
write("assets/map-14th-dark.svg", fourteenth(true));
write("assets/map-graham-light.svg", graham(false));
write("assets/map-graham-dark.svg", graham(true));
write("assets/map-key-light.svg", keyMap(false));
write("assets/map-key-dark.svg", keyMap(true));
write("assets/crop-pole.svg", crop);

const surfaces = ["desktop", "mobile-web", "mobile-app"];
const screens = ["live-map", "verify", "hazard"];
const themes = ["light", "dark"];
for (const surface of surfaces) {
  for (const screen of screens) {
    for (const theme of themes) {
      write(`${surface}/${screen}-${theme}.html`, renderScreen(surface, screen, theme));
    }
  }
}
write("index.html", index());
console.log("wrote 18 screens + index + maps");
