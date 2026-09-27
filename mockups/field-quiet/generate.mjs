import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const icon = (paths, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const I = {
  map: icon(`<path d="M4.5 6.5 9 4.5l6 2 4.5-2v13l-4.5 2-6-2-4.5 2v-13Z"/><path d="M9 4.5v13M15 6.5v13"/>`),
  check: icon(`<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="m8 12.2 2.4 2.4L16 9.2"/>`),
  sun: icon(`<circle cx="12" cy="12" r="3.25"/><path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M5.8 5.8l1.3 1.3M16.9 16.9l1.3 1.3M18.2 5.8l-1.3 1.3M7.1 16.9l-1.3 1.3"/>`),
  moon: icon(`<path d="M16.5 14.2A6.2 6.2 0 0 1 9.8 4.8 6.4 6.4 0 1 0 16.5 14.2Z"/>`),
  warn: icon(`<path d="M12 4.2 3.6 19h16.8L12 4.2Z"/><path d="M12 10v4.2"/><path d="M12 16.8h.01"/>`),
  info: icon(`<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8h.01"/>`),
  camera: icon(`<path d="M3 8.5h3.2L8 6h8l1.8 2.5H21v9.2a1.3 1.3 0 0 1-1.3 1.3H4.3A1.3 1.3 0 0 1 3 17.7V8.5Z"/><path d="m4 5 16 15"/>`),
  clock: icon(`<circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l2.6 1.6"/>`),
  eye: icon(`<path d="M2.8 12S6 6.8 12 6.8 21.2 12 21.2 12 18 17.2 12 17.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.4"/>`),
  ok: icon(`<circle cx="12" cy="12" r="8"/><path d="m8.4 12.2 2.3 2.3 4.8-5"/>`),
  back: icon(`<path d="M14.5 6 8.5 12l6 6"/>`, 18),
  plus: icon(`<path d="M12 7v10M7 12h10"/>`),
  minus: icon(`<path d="M7 12h10"/>`),
  signal: `<svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor" aria-hidden="true"><rect x="0" y="7" width="3" height="5" rx="0.6"/><rect x="4.5" y="4.5" width="3" height="7.5" rx="0.6"/><rect x="9" y="2" width="3" height="10" rx="0.6"/><rect x="13.5" y="0" width="3" height="12" rx="0.6"/></svg>`,
  wifi: `<svg width="15" height="12" viewBox="0 0 15 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M1 4.2c3.6-3 9.4-3 13 0"/><path d="M3.2 6.6c2.4-2 6.2-2 8.6 0"/><path d="M5.6 9c1.1-.9 2.7-.9 3.8 0"/><circle cx="7.5" cy="11" r="0.7" fill="currentColor" stroke="none"/></svg>`,
  battery: `<svg width="25" height="12" viewBox="0 0 25 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="0.7" y="0.7" width="20" height="10.6" rx="2.2"/><rect x="2.2" y="2.2" width="15" height="7.6" rx="1" fill="currentColor" stroke="none"/><path d="M22.2 4.2h1.2a1 1 0 0 1 1 1v1.6a1 1 0 0 1-1 1H22" stroke-linejoin="round"/></svg>`,
};

const sunMoon = `<span class="when-light">${I.sun}</span><span class="when-dark">${I.moon}</span>`;

function pinSvg(cat, band, size) {
  const meta = {
    moving: ["#ffc23d", "#081624", "M"],
    temporary: ["#FF7900", "#081624", "T"],
    permanent: ["#d93a1e", "#ffffff", "P"],
  }[cat];
  const [fill, ink, letter] = meta;
  const s = size;
  let shape;
  let ty = s / 2;
  const sw = Math.max(1.4, s * 0.08);
  if (band === "head") {
    shape = `<polygon points="${s / 2},1.2 ${s - 1.2},${s - 1.2} 1.2,${s - 1.2}" fill="${fill}" stroke="#fff" stroke-width="${sw}" stroke-linejoin="round"/>`;
    ty = s * 0.66;
  } else if (band === "dropoff") {
    shape = `<rect x="1.3" y="1.3" width="${s - 2.6}" height="${s - 2.6}" rx="2" fill="${fill}" stroke="#fff" stroke-width="${sw}"/>`;
  } else {
    shape = `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 1.5}" fill="${fill}" stroke="#fff" stroke-width="${sw}"/>`;
  }
  const fs = Math.round(s * (band === "head" ? 0.32 : 0.4));
  return `<svg class="pin" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" style="overflow:visible;filter:drop-shadow(0 0 1px rgba(8,22,36,.75))">${shape}<text x="${s / 2}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="${ink}" font-size="${fs}" font-weight="700" font-family="Geist, sans-serif">${letter}</text></svg>`;
}

const FEED = [
  ["drop-off: pothole", "permanent", "dropoff", "Permanent", "Drop-off", "28 minutes ago", 1],
  ["pole at head height", "permanent", "head", "Permanent", "Head height", "2 hours ago", 1],
  ["curb", "permanent", "ground", "Permanent", "Ground level", "4 hours ago", 1],
  ["pole", "permanent", "ground", "Permanent", "Ground level", "4 hours ago", 1],
  ["drop-off: step down", "permanent", "dropoff", "Permanent", "Drop-off", "4 hours ago", 1],
  ["planter", "permanent", "ground", "Permanent", "Ground level", "4 hours ago", 1],
  ["uneven pavement", "permanent", "ground", "Permanent", "Ground level", "4 hours ago", 1],
  ["trash bin", "moving", "ground", "Moving", "Ground level", "4 hours ago", 1],
  ["drop-off", "moving", "dropoff", "Moving", "Drop-off", "5 hours ago", 1, true],
];

function barWidth(c) {
  return Math.max(8, Math.min(100, ((c + 2) / 7) * 100));
}

function feedRows(hazardHref) {
  const rows = FEED.map((h) => {
    const [name, cat, band, catLabel, height, when, conf, sample] = h;
    const href = sample ? hazardHref : "";
    const tag = sample ? `<span class="badge-sample">Sample</span>` : "";
    const inner = `<span class="pin-tile">${pinSvg(cat, band, 22)}</span><span class="mid"><span class="name">${name}${tag}</span><span class="meta">${catLabel} · ${height} · seen ${when}</span></span><span class="conf"><b>${conf.toFixed(1)}</b><i aria-hidden="true"><span style="width:${barWidth(conf).toFixed(1)}%"></span></i></span>`;
    return href
      ? `<a class="row" href="${href}">${inner}</a>`
      : `<div class="row">${inner}</div>`;
  }).join("");
  return `${rows}<p class="more">Showing the 9 most recently seen of 31.</p>`;
}

function legendHtml() {
  return `<div class="legend-grid"><div><h3>Color + letter = category</h3><ul><li>${pinSvg("moving", "ground", 16)} Moving</li><li>${pinSvg("temporary", "ground", 16)} Temporary</li><li>${pinSvg("permanent", "ground", 16)} Permanent</li></ul></div><div><h3>Shape = height</h3><ul><li>${pinSvg("temporary", "ground", 16)} Ground level</li><li>${pinSvg("temporary", "head", 16)} Head height</li><li>${pinSvg("temporary", "dropoff", 16)} Drop-off</li></ul></div></div><p>Bigger pin = higher community confidence.</p>`;
}

const PINS = [
  { x: 92, y: 236, cat: "temporary", band: "head", s: 36 },
  { x: 132, y: 340, cat: "moving", band: "ground", s: 36 },
  { x: 960, y: 72, cat: "permanent", band: "ground", s: 32 },
  { x: 1064, y: 78, cat: "temporary", band: "ground", s: 36 },
  { x: 960, y: 200, cat: "permanent", band: "ground", s: 32 },
  { x: 1024, y: 372, cat: "permanent", band: "head", s: 34 },
  { x: 848, y: 578, cat: "moving", band: "dropoff", s: 42, sample: true, link: true },
  { x: 596, y: 730, cat: "permanent", band: "dropoff", s: 32 },
  { x: 980, y: 708, cat: "permanent", band: "ground", s: 34 },
];

function mapPin(p, hazardHref, highlight) {
  const meta = {
    moving: ["#ffc23d", "#081624", "M"],
    temporary: ["#FF7900", "#081624", "T"],
    permanent: ["#d93a1e", "#ffffff", "P"],
  }[p.cat];
  const [fill, ink, letter] = meta;
  const s = p.s;
  const sw = 2;
  let shape;
  let ty = s / 2;
  if (p.band === "head") {
    shape = `<polygon points="${s / 2},1.4 ${s - 1.4},${s - 1.4} 1.4,${s - 1.4}" fill="${fill}" stroke="#fff" stroke-width="${sw}" stroke-linejoin="round"/>`;
    ty = s * 0.66;
  } else if (p.band === "dropoff") {
    shape = `<rect x="1.5" y="1.5" width="${s - 3}" height="${s - 3}" rx="2.5" fill="${fill}" stroke="#fff" stroke-width="${sw}"/>`;
  } else {
    shape = `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 1.7}" fill="${fill}" stroke="#fff" stroke-width="${sw}"/>`;
  }
  const fs = Math.round(s * (p.band === "head" ? 0.32 : 0.4));
  const ring = highlight
    ? `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 + 4}" fill="none" stroke="var(--heading)" stroke-width="1.6" stroke-dasharray="3 2.2"/>`
    : "";
  const tag = p.sample
    ? `<g class="stag" transform="translate(${p.x - 34},${p.y - s / 2 - 26})"><rect width="68" height="20" rx="4" fill="#ffffff" stroke="#081624" stroke-width="1.25" stroke-dasharray="3 2"/><text x="34" y="14" text-anchor="middle" font-weight="650" fill="#081624" font-family="Geist, sans-serif">Sample</text></g>`
    : "";
  const body = `<g transform="translate(${p.x - s / 2},${p.y - s / 2})"><g filter="url(#pinshadow)">${shape}<text x="${s / 2}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="${ink}" font-size="${fs}" font-weight="700" font-family="Geist, sans-serif">${letter}</text></g>${ring}</g>${tag}`;
  if (p.link && hazardHref) {
    return `<a href="${hazardHref}" aria-label="Sample drop-off, moving, confidence 1.0">${body}</a>`;
  }
  return body;
}

function campusSvg({ viewBox, hazardHref, highlightRamp }) {
  const pins = PINS.map((p) => mapPin(p, hazardHref, highlightRamp && p.link)).join("");
  return `<svg class="campus" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of reported hazards around FIU Graham Center">
    <defs><filter id="pinshadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0.8" stdDeviation="0.7" flood-color="#081624" flood-opacity="0.55"/></filter></defs>
    <rect class="land" x="0" y="0" width="1200" height="800"/>
    <rect class="park" x="12" y="12" width="148" height="96" rx="16"/>
    <rect class="park" x="12" y="672" width="200" height="108" rx="16"/>
    <ellipse class="water" cx="1108" cy="728" rx="52" ry="22"/>
    <rect class="case" x="0" y="146" width="1200" height="30" rx="8"/>
    <rect class="road" x="0" y="152" width="1200" height="18" rx="6"/>
    <rect class="case" x="0" y="398" width="1200" height="26" rx="7"/>
    <rect class="road" x="0" y="404" width="1200" height="14" rx="5"/>
    <rect class="case" x="0" y="626" width="1200" height="28" rx="8"/>
    <rect class="road" x="0" y="632" width="1200" height="16" rx="6"/>
    <rect class="case" x="176" y="0" width="28" height="800" rx="8"/>
    <rect class="road" x="182" y="0" width="16" height="800" rx="6"/>
    <rect class="case" x="536" y="0" width="30" height="800" rx="8"/>
    <rect class="road" x="542" y="0" width="18" height="800" rx="6"/>
    <rect class="case" x="896" y="0" width="26" height="800" rx="8"/>
    <rect class="road" x="902" y="0" width="14" height="800" rx="6"/>
    <circle class="ring-case" cx="1004" cy="286" r="50"/>
    <circle class="ring" cx="1004" cy="286" r="50"/>
    <rect class="bldg" x="220" y="18" width="280" height="108" rx="3"/>
    <rect class="bldg" x="590" y="18" width="270" height="108" rx="3"/>
    <rect class="bldg" x="220" y="196" width="280" height="168" rx="3"/>
    <rect class="bldg" x="590" y="196" width="270" height="168" rx="3"/>
    <rect class="bldg" x="20" y="456" width="136" height="120" rx="3"/>
    <rect class="bldg" x="220" y="448" width="280" height="140" rx="3"/>
    <rect class="bldg" x="590" y="448" width="190" height="140" rx="3"/>
    <rect class="bldg" x="812" y="458" width="72" height="48" rx="3"/>
    <rect class="bldg" x="948" y="456" width="206" height="130" rx="3"/>
    <rect class="bldg" x="628" y="692" width="192" height="80" rx="3"/>
    <text class="blabel" x="360" y="78" text-anchor="middle">Chemistry &amp; Physics</text>
    <text class="blabel" x="725" y="64" text-anchor="middle">Academic Health</text>
    <text class="blabel" x="725" y="90" text-anchor="middle">Center</text>
    <text class="blabel" x="360" y="286" text-anchor="middle">Viertes Haus</text>
    <text class="blabel emph" x="725" y="286" text-anchor="middle">Green Library</text>
    <text class="blabel" x="88" y="522" text-anchor="middle">SIPA</text>
    <text class="blabel" x="360" y="524" text-anchor="middle">Ryder Business</text>
    <text class="blabel emph" x="685" y="524" text-anchor="middle">Graham Center</text>
    <text class="blabel small" x="848" y="488" text-anchor="middle">Market</text>
    <text class="blabel" x="1051" y="528" text-anchor="middle">Primera Casa</text>
    <text class="blabel" x="724" y="738" text-anchor="middle">Gold Garage</text>
    <text class="blabel small" x="1108" y="732" text-anchor="middle">Lakeview</text>
    <text class="street" x="236" y="166">SW 8th Street</text>
    <text class="street" x="660" y="646">SW 14th Street</text>
    <text class="street" x="1076" y="292">Campus Circle</text>
    <circle class="osm osm-cross" cx="190" cy="161" r="5"/>
    <circle class="osm osm-cross" cx="551" cy="161" r="5"/>
    <circle class="osm osm-curb" cx="909" cy="161" r="4.5"/>
    <circle class="osm osm-tactile" cx="190" cy="411" r="4.5"/>
    <circle class="osm osm-cross" cx="551" cy="411" r="5"/>
    <circle class="osm osm-curb" cx="909" cy="411" r="4.5"/>
    <circle class="osm osm-cross" cx="551" cy="640" r="5"/>
    <circle class="osm osm-tactile" cx="909" cy="640" r="4.5"/>
    ${pins}
  </svg>`;
}

function zoom() {
  return `<div class="zoom"><button type="button" aria-label="Zoom in">${I.plus}</button><button type="button" aria-label="Zoom out">${I.minus}</button></div>`;
}
function attrib() {
  return `<p class="attrib">Leaflet | <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors</p>`;
}

function metrics(variant) {
  const cells = [
    { k: `${I.warn.replace('stroke="currentColor"', 'stroke="currentColor" class="hazard"')} Active hazards`, v: "31", n: "18 sample · 13 real · 5 km" },
    { k: `${I.clock} Last hour`, v: "1", n: "Reported or seen again · 0 sample" },
    { k: `${I.eye} Awaiting check`, v: "31", n: "Not yet verified here · 18 sample" },
    { k: `${I.ok} Cleared today`, v: "0", n: "Seen clearing live on this page" },
    { k: `<span class="live-dot" aria-hidden="true"></span> Stream`, v: "Live", n: variant === "mweb" ? "Updated in under a minute" : "Updated just now", stream: true },
  ];
  const html = cells
    .map(
      (c) =>
        `<div class="metric${c.stream ? " stream" : ""}"><div><div class="k">${c.k}</div><div class="v">${c.v}</div></div><p class="n">${c.n}</p></div>`,
    )
    .join("");
  if (variant === "scroll") return `<div class="metric-scroller" aria-label="Summary">${html}</div>`;
  return `<section class="metric-group" aria-label="Summary">${html}</section>`;
}

function logos() {
  return `<img class="logo-light" src="assets/logo-light.png" width="28" height="28" alt=""><img class="logo-dark" src="assets/logo-dark.png" width="28" height="28" alt="">`;
}

function sidebar(active, live, verify) {
  const item = (href, name, label, on) =>
    `<a href="${href}"${on ? ' aria-current="page"' : ""}>${I[name]} ${label}</a>`;
  return `<aside class="sidebar"><a class="brand" href="${live}">${logos()}<span><span class="name">StepSafe</span><small>Community hazard map</small></span></a><nav class="nav" aria-label="Main">${item(live, "map", "Live map", active === "live")}${item(verify, "check", "Verify queue", active === "verify")}</nav><div class="side-foot"><button type="button" class="theme-btn" data-theme-toggle aria-pressed="false">${sunMoon}<span>Dark theme</span></button><div class="profile"><span class="avatar" aria-hidden="true">N</span><span><b>Neighbor-5ae3</b><small>0 karma · verifier</small></span></div></div></aside>`;
}

function mwebHead(active, live, verify) {
  const tab = (href, name, label, on) =>
    `<a href="${href}"${on ? ' aria-current="page"' : ""}>${I[name]} ${label}</a>`;
  return `<header class="m-bar"><a class="brand" href="${live}">${logos()}<span class="name">StepSafe</span></a><div class="who"><span class="avatar" aria-hidden="true">N</span><span class="who-text"><b>Neighbor-5ae3</b><small>0 karma · verifier</small></span><button type="button" class="icon-btn" data-theme-toggle aria-pressed="false" aria-label="Dark theme">${sunMoon}</button></div></header><nav class="tabs" aria-label="Main">${tab(live, "map", "Live map", active === "live")}${tab(verify, "check", "Verify queue", active === "verify")}</nav>`;
}

function statusBar() {
  return `<div class="status"><span>9:41</span><span class="island" aria-hidden="true"></span><span class="status-icons">${I.signal}${I.wifi}${I.battery}</span></div>`;
}
function tabbar(active, live, verify) {
  const tab = (href, name, label, on) =>
    `<a href="${href}"${on ? ' aria-current="page"' : ""}>${I[name]} ${label}</a>`;
  return `<nav class="tabbar" aria-label="Main">${tab(live, "map", "Live map", active === "live")}${tab(verify, "check", "Verify queue", active === "verify")}</nav>`;
}
const home = `<i class="home" aria-hidden="true"></i>`;

function preview(fileLabel) {
  return `<div class="preview-bar"><a href="index.html">Gallery</a><span>Field Quiet · ${fileLabel} · theme toggle is in the screen</span></div>`;
}

function shell({ title, bodyClass, main }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var t = q.get("theme");
  if (t !== "light" && t !== "dark") {
    try { t = localStorage.getItem("field-quiet-theme"); } catch (e) { t = null; }
  }
  if (t !== "light" && t !== "dark") t = "light";
  document.documentElement.setAttribute("data-theme", t);
  if (q.get("embed") === "1" || q.get("shot") === "1") document.documentElement.setAttribute("data-embed", "1");
})();
</script>
<link rel="stylesheet" href="field-quiet.css">
<link rel="icon" href="assets/logo-light.png">
</head>
<body class="${bodyClass}">
${main}
<script src="theme.js"></script>
</body>
</html>
`;
}

function votes(withKeys) {
  const u = withKeys ? `<span class="desk-only"> · U</span>` : "";
  const d = withKeys ? `<span class="desk-only"> · D</span>` : "";
  const s = withKeys ? `<span class="desk-only"> · S</span>` : "";
  return `<div class="votes"><button type="button" class="vote vote-up"><span class="vote-title">▲ Still there</span><span class="vote-sub">Upvote${u}</span></button><button type="button" class="vote vote-down"><span class="vote-title">▼ Gone</span><span class="vote-sub">Not a hazard${d}</span></button><button type="button" class="vote vote-skip"><span class="vote-title">Skip</span><span class="vote-sub">Decide later${s}</span></button></div>`;
}

function hazardBody(hazardHrefBack) {
  return `<div class="hz"><span class="pin-tile">${pinSvg("moving", "dropoff", 26)}</span><div><h2>drop-off <span class="badge-sample">Sample</span></h2><p>Moving · Drop-off · type “ramp”</p></div></div>
<div class="notice" role="status">${I.info}<div><strong>Sample hazard</strong><p>Seeded for the demo. It was not reported by a real walker.</p></div></div>
<div class="nophoto">${I.camera}<span>No photo was sent with this report</span></div>
<dl class="facts facts-2">
  <div><dt>Clearance height</dt><dd>Not measured</dd></div>
  <div><dt>Remaining sidewalk width</dt><dd>Not measured</dd></div>
  <div><dt>Confidence</dt><dd>1.0 <span class="hint">(cleared below −2)</span></dd></div>
  <div><dt>Severity</dt><dd>1 of 3</dd></div>
  <div><dt>Last seen</dt><dd>4 hours ago</dd></div>
  <div><dt>Expires</dt><dd>in 2 hours <span class="hint">(clears after 6 hours without an upvote)</span></dd></div>
  <div><dt>First reported</dt><dd>Sep 26, 2026, 6:12 PM</dd></div>
  <div><dt>Spoken in Spanish</dt><dd lang="es">Rampa adelante</dd></div>
</dl>
<section><h3 class="h3">Pending reclassifications</h3><ul class="pending"><li>Change to <strong>type “curb”, permanent, ground level</strong>: 1 of 3 agree</li></ul></section>
<section><h3 class="h3">Vote history (2)</h3><div class="table-wrap"><table><thead><tr><th>When</th><th>Vote</th><th>From</th><th class="num">Weight</th></tr></thead><tbody><tr><td>5 hours ago</td><td>Still there</td><td>Scout</td><td class="num">1.00</td></tr><tr><td>6 hours ago</td><td>Still there</td><td>Walker</td><td class="num">0.70</td></tr></tbody></table></div></section>`;
}

function verifyIntro(withKeys) {
  const keys = withKeys
    ? ` <span class="shortcut-copy">Shortcuts: <kbd>U</kbd> upvote, <kbd>D</kbd> downvote, <kbd>S</kbd> skip (when no button or link is focused).</span>`
    : "";
  return `<p class="lede">Least-confident hazards first. Is it still there?${keys}</p>`;
}

function countCard() {
  return `<div class="panel count-card"><p class="big"><b>31</b> left to review</p><div class="track" role="progressbar" aria-label="Hazards checked from this device" aria-valuemin="0" aria-valuemax="31" aria-valuenow="0"><span></span></div><p class="fine">0 of 31 checked from this device</p></div>`;
}

function verifyIdentity() {
  return `<div class="hz" id="verify-heading"><span class="pin-tile">${pinSvg("moving", "dropoff", 26)}</span><div><h2>drop-off <span class="badge-sample">Sample</span></h2><p>Moving · Drop-off · type “ramp”</p></div></div>
<div class="notice" role="status">${I.info}<div><strong>Sample hazard</strong><p>Seeded for the demo, not a real report. Votes still count for the demo.</p></div></div>
<div class="nophoto">${I.camera}<span>No photo was sent with this report</span></div>`;
}

const FULL = "0 0 1200 800";
const MWEB = "500 0 680 780";
const APP = "530 160 650 470";
const CROP = "730 430 450 270";

function liveMapDesktop() {
  const live = "desktop-live-map.html";
  const verify = "desktop-verify.html";
  const hazard = "desktop-hazard.html";
  return shell({
    title: "Live map · StepSafe",
    bodyClass: "surface-desk",
    main: `${preview("Desktop · Live map")}<div class="desktop">${sidebar("live", live, verify)}<div class="main lock"><div class="page-head"><h1>Live map</h1><div class="actions"><a class="btn" href="${verify}">Verify hazards</a></div></div><p class="lede">Hazards reported by StepSafe walkers within 5 km of FIU Graham Center. Updates arrive live.</p>${metrics("desk")}<div class="split"><section class="panel map-panel" aria-labelledby="map-heading"><div class="panel-head"><div><h2 id="map-heading">Map</h2><p>FIU Graham Center · pin size shows community confidence</p></div><label class="check right"><input id="osm" data-osm type="checkbox"> OpenStreetMap layer</label></div><div class="map-frame">${campusSvg({ viewBox: FULL, hazardHref: hazard })}<div class="legend">${legendHtml()}</div>${zoom()}${attrib()}</div></section><aside class="panel feed" aria-label="Active hazards"><div class="panel-head"><div><h2>Active hazards <span class="count">31</span></h2><p>Most recently seen first. Select one for details.</p></div></div><div class="feed-list">${feedRows(hazard)}</div></aside></div></div></div>`,
  });
}

function verifyDesktop() {
  const live = "desktop-live-map.html";
  const verify = "desktop-verify.html";
  const hazard = "desktop-hazard.html";
  return shell({
    title: "Verify queue · StepSafe",
    bodyClass: "surface-desk",
    main: `${preview("Desktop · Verify queue")}<div class="desktop">${sidebar("verify", live, verify)}<div class="main scroll"><div class="page-head"><h1>Verify queue</h1><div class="actions"><label class="check"><input data-shortcuts type="checkbox" checked> Keyboard shortcuts</label><span class="livebadge" role="status"><i class="live-dot" aria-hidden="true"></i> Live</span></div></div><div class="verify-wrap"><div class="verify-top">${verifyIntro(true)}${countCard()}</div><article class="panel verify-card" aria-labelledby="verify-heading"><div class="verify-main">${verifyIdentity()}</div><div class="verify-side"><div class="mini-map">${campusSvg({ viewBox: CROP, hazardHref: hazard, highlightRamp: true })}${attrib()}</div><dl class="facts"><div><dt>Confidence</dt><dd>1.0</dd></div><div><dt>Clearance</dt><dd>Not measured</dd></div><div><dt>Width left</dt><dd>Not measured</dd></div></dl><a class="textlink" href="${hazard}">Full details and vote history</a>${votes(true)}<div class="btn-row"><button type="button" class="btn btn-quiet">Reclassify…</button><button type="button" class="btn btn-quiet">Report…</button></div></div></article></div></div></div>`,
  });
}

function hazardDesktop() {
  const live = "desktop-live-map.html";
  const verify = "desktop-verify.html";
  const hazard = "desktop-hazard.html";
  return shell({
    title: "Hazard details · StepSafe",
    bodyClass: "surface-desk",
    main: `${preview("Desktop · Hazard details")}<div class="desktop">${sidebar("live", live, verify)}<div class="main scroll"><div class="page-head"><h1>Hazard details</h1><div class="actions"><a class="textlink" href="${live}">← Back to the map</a></div></div><div class="hazard-grid"><div class="panel hazard-body">${hazardBody(live)}</div><div class="mini-map">${campusSvg({ viewBox: CROP, hazardHref: hazard, highlightRamp: true })}${attrib()}</div></div></div></div>`,
  });
}

function liveMapMweb() {
  const live = "mobile-web-live-map.html";
  const verify = "mobile-web-verify.html";
  const hazard = "mobile-web-hazard.html";
  return shell({
    title: "Live map · stepsafe.miami",
    bodyClass: "surface-mweb",
    main: `${preview("Mobile web · stepsafe.miami · Live map")}<div class="mweb">${mwebHead("live", live, verify)}<main><div class="page-head"><h1>Live map</h1><div class="actions"><a class="btn" href="${verify}">Verify hazards</a></div></div><p class="lede">Hazards reported by StepSafe walkers within 5 km of FIU Graham Center. Updates arrive live.</p>${metrics("mweb")}<div class="split"><section class="panel map-panel"><div class="panel-head"><div><h2>Map</h2><p>FIU Graham Center · pin size shows community confidence</p></div><label class="check right"><input data-osm type="checkbox"> OpenStreetMap layer</label></div><div class="map-frame">${campusSvg({ viewBox: MWEB, hazardHref: hazard })}${zoom()}${attrib()}</div></section><aside class="panel feed"><div class="panel-head"><div><h2>Active hazards <span class="count">31</span></h2><p>Most recently seen first. Select one for details.</p></div></div><details class="legend-details"><summary>Map legend</summary>${legendHtml()}</details><div class="feed-list">${feedRows(hazard)}</div></aside></div></main></div>`,
  });
}

function verifyMweb() {
  const live = "mobile-web-live-map.html";
  const verify = "mobile-web-verify.html";
  const hazard = "mobile-web-hazard.html";
  return shell({
    title: "Verify queue · stepsafe.miami",
    bodyClass: "surface-mweb",
    main: `${preview("Mobile web · stepsafe.miami · Verify queue")}<div class="mweb">${mwebHead("verify", live, verify)}<main><div class="page-head wrap"><h1>Verify queue</h1><div class="actions"><label class="check"><input data-shortcuts type="checkbox" checked> Keyboard shortcuts</label><span class="livebadge" role="status"><i class="live-dot" aria-hidden="true"></i> Live</span></div></div><div class="verify-top">${verifyIntro(true)}${countCard()}</div><article class="panel verify-card"><div class="verify-main">${verifyIdentity()}</div><div class="verify-side"><div class="mini-map">${campusSvg({ viewBox: CROP, hazardHref: hazard, highlightRamp: true })}${attrib()}</div><dl class="facts"><div><dt>Confidence</dt><dd>1.0</dd></div><div><dt>Clearance</dt><dd>Not measured</dd></div><div><dt>Width left</dt><dd>Not measured</dd></div></dl><a class="textlink" href="${hazard}">Full details and vote history</a><div class="votes votes-sticky"><button type="button" class="vote vote-up"><span class="vote-title">▲ Still there</span><span class="vote-sub">Upvote</span></button><button type="button" class="vote vote-down"><span class="vote-title">▼ Gone</span><span class="vote-sub">Not a hazard</span></button><button type="button" class="vote vote-skip"><span class="vote-title">Skip</span><span class="vote-sub">Decide later</span></button></div><div class="btn-row"><button type="button" class="btn btn-quiet">Reclassify…</button><button type="button" class="btn btn-quiet">Report…</button></div></div></article></main></div>`,
  });
}

function hazardMweb() {
  const live = "mobile-web-live-map.html";
  const verify = "mobile-web-verify.html";
  const hazard = "mobile-web-hazard.html";
  return shell({
    title: "Hazard details · stepsafe.miami",
    bodyClass: "surface-mweb",
    main: `${preview("Mobile web · stepsafe.miami · Hazard")}<div class="mweb">${mwebHead("live", live, verify)}<main><div class="page-head wrap"><h1>Hazard details</h1><div class="actions"><a class="textlink" href="${live}">← Back to the map</a></div></div><div class="hazard-grid"><div class="panel hazard-body">${hazardBody(live)}<div class="mini-map">${campusSvg({ viewBox: CROP, hazardHref: hazard, highlightRamp: true })}${attrib()}</div></div></div></main></div>`,
  });
}

function phone(active, live, verify, inner, { tabs = true, klass = "" } = {}) {
  return `<div class="stage"><div class="device"><div class="screen ${klass}">${statusBar()}${inner}${tabs ? tabbar(active, live, verify) : ""}${home}</div></div></div>`;
}

function liveMapApp() {
  const live = "mobile-app-live-map.html";
  const verify = "mobile-app-verify.html";
  const hazard = "mobile-app-hazard.html";
  const inner = `<div class="app-col"><div class="app-kicker"><span class="ey">StepSafe</span><button type="button" class="icon-btn" data-theme-toggle aria-pressed="false" aria-label="Dark theme">${sunMoon}</button></div><h1 class="app-title">Live map</h1><p class="app-lede">Hazards within 5 km of FIU Graham Center. Updates arrive live.</p><a class="btn app-cta" href="${verify}">Verify hazards</a>${metrics("scroll")}<div class="app-map map-frame">${campusSvg({ viewBox: APP, hazardHref: hazard })}<label class="map-pill check"><input data-osm type="checkbox"> OSM layer</label><div class="legend-solid"><div class="lg-row"><span class="item">${pinSvg("moving", "ground", 14)} Moving</span><span class="item">${pinSvg("temporary", "ground", 14)} Temporary</span><span class="item">${pinSvg("permanent", "ground", 14)} Permanent</span></div><div class="lg-row">Circle ground · triangle head · square drop-off</div></div></div><section class="sheet" aria-label="Active hazards"><i class="grabber" aria-hidden="true"></i><div class="panel-head"><div><h2>Active hazards <span class="count">31</span></h2><p>Most recently seen first.</p></div></div><div class="sheet-list feed-list">${feedRows(hazard)}</div></section></div>`;
  return shell({
    title: "Live map · StepSafe app",
    bodyClass: "surface-app",
    main: `${preview("Mobile app · Live map")}${phone("live", live, verify, inner)}`,
  });
}

function verifyApp() {
  const live = "mobile-app-live-map.html";
  const verify = "mobile-app-verify.html";
  const hazard = "mobile-app-hazard.html";
  const inner = `<div class="app-col"><div class="app-kicker"><span class="ey">StepSafe</span><span class="kicker-right"><span class="livebadge" role="status"><i class="live-dot" aria-hidden="true"></i> Live</span><button type="button" class="icon-btn" data-theme-toggle aria-pressed="false" aria-label="Dark theme">${sunMoon}</button></span></div><h1 class="app-title">Verify queue</h1><div class="app-scroll">${verifyIntro(false)}${countCard()}<article class="panel verify-card" style="margin-top:12px"><div class="verify-main">${verifyIdentity()}</div><div class="verify-side"><div class="mini-map">${campusSvg({ viewBox: CROP, hazardHref: hazard, highlightRamp: true })}${attrib()}</div><dl class="facts"><div><dt>Confidence</dt><dd>1.0</dd></div><div><dt>Clearance</dt><dd>Not measured</dd></div><div><dt>Width left</dt><dd>Not measured</dd></div></dl><a class="textlink" href="${hazard}">Full details and vote history</a><div class="btn-row"><button type="button" class="btn btn-quiet">Reclassify…</button><button type="button" class="btn btn-quiet">Report…</button></div></div></article></div></div><div class="vote-dock">${votes(false)}</div>`;
  return shell({
    title: "Verify queue · StepSafe app",
    bodyClass: "surface-app",
    main: `${preview("Mobile app · Verify")}${phone("verify", live, verify, inner)}`,
  });
}

function hazardApp() {
  const live = "mobile-app-live-map.html";
  const verify = "mobile-app-verify.html";
  const hazard = "mobile-app-hazard.html";
  const inner = `<div class="app-col"><div class="app-kicker"><a class="back" href="${live}">${I.back} Map</a><button type="button" class="icon-btn" data-theme-toggle aria-pressed="false" aria-label="Dark theme">${sunMoon}</button></div><div class="app-scroll"><div class="hz" style="margin-top:8px"><span class="pin-tile">${pinSvg("moving", "dropoff", 28)}</span><div><h1>drop-off <span class="badge-sample">Sample</span></h1><p>Moving · Drop-off · type “ramp”</p></div></div><div class="notice" role="status">${I.info}<div><strong>Sample hazard</strong><p>Seeded for the demo. It was not reported by a real walker.</p></div></div><div class="nophoto">${I.camera}<span>No photo was sent with this report</span></div>${hazardBody(live).replace(/^[\s\S]*?<dl/, "<dl")}<div class="mini-map" style="margin-top:4px">${campusSvg({ viewBox: CROP, hazardHref: hazard, highlightRamp: true })}${attrib()}</div></div></div>`;
  return shell({
    title: "Hazard · StepSafe app",
    bodyClass: "surface-app",
    main: `${preview("Mobile app · Hazard")}${phone("", live, verify, inner, { tabs: false, klass: "no-tabs" })}`,
  });
}

function index() {
  const card = (file, title, note, wide) => `<a class="shot${wide ? " wide" : ""}" href="${file}"><img class="only-light" src="shots/${file.replace(".html", "")}-light.png" alt="${title}, light theme"><img class="only-dark" src="shots/${file.replace(".html", "")}-dark.png" alt="${title}, dark theme"><span>${title}</span><small>${note}</small></a>`;
  return shell({
    title: "Field Quiet · StepSafe mockups",
    bodyClass: "surface-gallery",
    main: `<div class="wrap gallery"><div class="gallery-top"><div><p class="eyebrow">StepSafe · verifier mockups · no product code</p><h1>Field Quiet</h1><p class="intro">Same jobs as the live site: live map, verify queue, and hazard detail, on the phone app, on stepsafe.miami, and on a 1440 desktop. The chrome is the change. Tesla subtraction, Apple quiet. Orange only where a hazard is speaking.</p></div><div class="switch" role="group" aria-label="Theme"><button type="button" data-set-theme="light">Light</button><button type="button" data-set-theme="dark">Dark</button></div></div><p class="section-note" style="margin-top:18px">The switch updates every still on this page. Open a screen for the in-product toggle, the map layer, and the shortcut checkbox. <a class="readme-link" href="README.md">Direction notes</a></p><h2>Mobile app</h2><p class="section-note">Phone frame, 390-wide screen. Bottom tabs. Hazard is a pushed screen.</p><div class="gallery-grid">${card("mobile-app-live-map.html", "Live map", "Heading, five summaries, map, feed")}${card("mobile-app-verify.html", "Verify queue", "Still there, Gone, Skip")}${card("mobile-app-hazard.html", "Hazard", "Full record for the queued ramp")}</div><h2>Mobile web</h2><p class="section-note">stepsafe.miami at 390. Logo, two tabs, map above the feed.</p><div class="gallery-grid">${card("mobile-web-live-map.html", "Live map", "Top tabs, summary cards, map, feed")}${card("mobile-web-verify.html", "Verify queue", "Single column, sticky vote bar")}${card("mobile-web-hazard.html", "Hazard", "Detail, votes, location")}</div><h2>Desktop</h2><p class="section-note">1440. Left rail, five summaries, map beside the active-hazard feed.</p><div class="stack">${card("desktop-live-map.html", "Live map", "Sidebar, metrics, map | feed", true)}${card("desktop-verify.html", "Verify queue", "Review card, shortcuts, three votes", true)}${card("desktop-hazard.html", "Hazard", "Measurements, history, map", true)}</div></div>`,
  });
}

const files = {
  "mobile-app-live-map.html": liveMapApp(),
  "mobile-app-verify.html": verifyApp(),
  "mobile-app-hazard.html": hazardApp(),
  "mobile-web-live-map.html": liveMapMweb(),
  "mobile-web-verify.html": verifyMweb(),
  "mobile-web-hazard.html": hazardMweb(),
  "desktop-live-map.html": liveMapDesktop(),
  "desktop-verify.html": verifyDesktop(),
  "desktop-hazard.html": hazardDesktop(),
  "index.html": index(),
};

for (const [name, html] of Object.entries(files)) {
  writeFileSync(join(root, name), html);
  console.log(name, html.length);
}
