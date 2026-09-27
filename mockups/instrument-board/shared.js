/* Instrument board renderer. Static mock — no API, no product code. */
(function () {
  const BOUNDS = { west: -80.3814101852417, east: -80.3663898147583, north: 25.763363842085493, south: 25.74983577263794 };
  const CAT = {
    moving: { label: "Moving", color: "#ffc23d", ink: "#081624", letter: "M", life: "clears after 6 hours" },
    temporary: { label: "Temporary", color: "#ff7900", ink: "#081624", letter: "T", life: "clears after 7 days" },
    permanent: { label: "Permanent", color: "#d93a1e", ink: "#ffffff", letter: "P", life: "clears after 90 days" },
  };
  const HGT = {
    ground: "Ground level",
    head: "Head height",
    dropoff: "Drop-off",
  };
  const SRC = { scout: "Scout", walker: "Walker", sample: "Sample" };

  // east m, north m from FIU Graham Center. sample 1/0. conf, seen minutes.
  const RAW = [
    ["pothole", "drop-off: pothole", "pothole", "permanent", "dropoff", 1, "scout", 1.0, 28, 48, 18, 3, null, 0.73, "desnivel: bache", "Sep 26, 2026, 11:40 PM"],
    ["pole-head", "pole at head height", "pole", "permanent", "head", 0, "walker", 1.0, 120, -78, 96, 2, 1.65, 1.35, "poste a la altura de la cabeza", "Sep 26, 2026, 8:12 PM"],
    ["curb", "curb", "curb", "permanent", "ground", 0, "walker", 1.0, 240, 102, -48, 2, null, null, "bordillo", "Sep 25, 2026, 6:05 PM"],
    ["pole", "pole", "pole", "permanent", "ground", 0, "scout", 1.0, 246, -36, -28, 1, null, null, "poste", "Sep 24, 2026, 3:18 PM"],
    ["step", "drop-off: step down", "step-down", "permanent", "dropoff", 0, "walker", 1.0, 252, -118, -72, 2, null, 1.12, "desnivel: escalón hacia abajo", "Sep 25, 2026, 1:44 PM"],
    ["planter", "planter", "planter", "permanent", "ground", 0, "scout", 1.0, 258, 18, 124, 1, null, null, "jardinera", "Sep 23, 2026, 10:02 AM"],
    ["uneven", "uneven pavement", "uneven-pavement", "permanent", "ground", 0, "walker", 1.0, 264, 136, 8, 2, null, 0.91, "pavimento irregular", "Sep 22, 2026, 4:30 PM"],
    ["trash", "trash bin", "trash-bin", "moving", "ground", 1, "scout", 1.0, 270, -96, 46, 1, null, null, "cubo de basura", "Sep 27, 2026, 6:10 AM"],
    ["scooter", "e-scooter", "e-scooter", "moving", "ground", 1, "scout", 3.0, 300, 64, -88, 2, null, null, "patinete eléctrico", "Sep 27, 2026, 7:02 AM"],
    ["umbrella", "umbrella at head height", "umbrella", "moving", "head", 1, "scout", 1.0, 312, -16, 156, 2, 1.72, null, "sombrilla a la altura de la cabeza", "Sep 26, 2026, 5:40 PM"],
    ["door", "open car door at head height", "open-car-door", "moving", "head", 1, "scout", 1.0, 330, -158, -16, 2, 1.58, null, "puerta de coche abierta a la altura de la cabeza", "Sep 26, 2026, 4:12 PM"],
    ["hatch", "drop-off: open hatch", "open-hatch", "moving", "dropoff", 1, "scout", 2.0, 342, 118, 74, 3, null, 0.84, "desnivel: trampilla abierta", "Sep 26, 2026, 2:20 PM"],
    ["ramp", "drop-off", "ramp", "moving", "dropoff", 1, "scout", 1.0, 520, -46, -148, 2, null, null, "desnivel: rampa", "Sep 26, 2026, 9:15 AM"],
    ["barrier", "construction barrier", "construction-barrier", "temporary", "ground", 1, "scout", 4.0, 360, 82, -128, 2, null, null, "barrera de obra", "Sep 21, 2026, 11:00 AM"],
    ["branch", "fallen branch", "fallen-branch", "temporary", "ground", 1, "scout", 2.0, 372, -176, 22, 1, null, null, "rama caída", "Sep 25, 2026, 8:48 AM"],
    ["scaffold", "scaffolding at head height", "scaffolding", "temporary", "head", 1, "scout", 3.0, 384, 8, 168, 3, 1.55, null, "andamio a la altura de la cabeza", "Sep 20, 2026, 2:15 PM"],
    ["lowbranch", "low branch at head height", "low-branch", "temporary", "head", 1, "scout", 2.0, 396, -104, 138, 2, 1.7, null, "rama baja a la altura de la cabeza", "Sep 22, 2026, 9:30 AM"],
    ["trench", "drop-off: open trench", "open-trench", "temporary", "dropoff", 1, "scout", 3.0, 408, 154, -76, 3, null, 0.62, "desnivel: zanja abierta", "Sep 19, 2026, 3:55 PM"],
    ["manhole", "drop-off: open manhole", "open-manhole", "temporary", "dropoff", 1, "scout", 2.0, 418, -22, 68, 3, null, null, "desnivel: alcantarilla abierta", "Sep 24, 2026, 12:10 PM"],
    ["sidewalk", "broken sidewalk", "broken-sidewalk", "permanent", "ground", 1, "scout", 4.0, 430, 148, 52, 2, null, 0.7, "acera rota", "Sep 12, 2026, 10:18 AM"],
    ["root", "tree root", "tree-root", "permanent", "ground", 1, "scout", 3.0, 442, -188, -96, 2, null, null, "raíz de árbol", "Sep 8, 2026, 4:42 PM"],
    ["lowsign", "low sign at head height", "low-sign", "permanent", "head", 1, "scout", 3.0, 454, 36, 188, 2, 1.62, null, "señal baja a la altura de la cabeza", "Sep 4, 2026, 1:05 PM"],
    ["canopy", "low branch at head height", "low-branch", "permanent", "head", 1, "scout", 2.0, 466, -146, 158, 1, 1.68, null, "rama baja a la altura de la cabeza", "Aug 30, 2026, 11:22 AM"],
    ["rampmiss", "drop-off: missing curb ramp", "ramp-missing", "permanent", "dropoff", 1, "scout", 4.0, 478, 108, -168, 3, null, null, "desnivel: sin rampa de bordillo", "Aug 22, 2026, 9:40 AM"],
    ["bench", "bench", "bench", "permanent", "ground", 0, "scout", 2.2, 286, -58, 42, 1, null, null, "banco", "Sep 18, 2026, 5:16 PM"],
    ["bollard", "bollard", "bollard", "permanent", "ground", 0, "walker", 2.4, 292, 28, -42, 1, null, null, "bolardo", "Sep 17, 2026, 2:08 PM"],
    ["hydrant", "fire hydrant", "fire-hydrant", "permanent", "ground", 0, "scout", 1.8, 304, -128, -44, 1, null, null, "boca de incendios", "Sep 15, 2026, 8:55 AM"],
    ["puddle", "puddle", "puddle", "temporary", "ground", 0, "walker", 2.6, 318, 92, 36, 1, null, null, "charco", "Sep 26, 2026, 7:28 PM"],
    ["cone", "traffic cone", "cone", "temporary", "ground", 0, "scout", 3.2, 348, -72, -112, 1, null, null, "cono", "Sep 26, 2026, 1:02 PM"],
    ["car", "parked car", "parked-car", "moving", "ground", 0, "walker", 1.5, 368, 166, -18, 2, null, 1.05, "coche estacionado", "Sep 27, 2026, 8:46 AM"],
    ["grate", "grate", "grate", "permanent", "ground", 0, "walker", 2.8, 490, -42, 176, 1, null, null, "rejilla", "Sep 2, 2026, 3:33 PM"],
  ];

  const M_LAT = 111320;
  const COS = Math.cos((25.7566 * Math.PI) / 180);
  function project(east, north) {
    const lat = 25.7566 + north / M_LAT;
    const lng = -80.3739 + east / (M_LAT * COS);
    return {
      x: ((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * 100,
      y: ((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * 100,
    };
  }
  function feet(m) {
    return m == null ? null : (m * 3.28084).toFixed(1) + " ft";
  }
  function seenLong(min) {
    if (min < 60) return min + (min === 1 ? " minute ago" : " minutes ago");
    const h = Math.round(min / 60);
    return h + (h === 1 ? " hour ago" : " hours ago");
  }
  function seenShort(min) {
    if (min < 60) return min + " min ago";
    const h = Math.round(min / 60);
    return h + " hr ago";
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Spread pins across the campus underlay so the tape is not one pile.
  const SPREAD = [
    [30, 20], [-150, 160], [190, -70], [-50, -90], [-230, -30],
    [10, 250], [250, 50], [-170, 70], [90, -190], [-30, 310],
    [-280, 10], [210, 160], [-70, -250], [140, -230], [-310, 80],
    [20, 340], [-200, 220], [260, -20], [-40, 110], [230, 120],
    [-330, -90], [70, 370], [-250, 260], [160, -300], [-110, 50],
    [50, -70], [-210, -10], [150, 90], [-130, -190], [280, 30],
    [-20, 290],
  ];
  RAW.forEach((r, i) => { r[9] = SPREAD[i][0]; r[10] = SPREAD[i][1]; });

  const HAZARDS = RAW.map((r) => {
    const [id, label, type, cat, height, sample, source, conf, seenMin, east, north, sev, clearM, widthM, es, reported] = r;
    const p = project(east, north);
    return {
      id, label, type, cat, height, sample: !!sample, source: sample ? "sample" : source,
      conf, seenMin, x: p.x, y: p.y, sev, clearM, widthM, es, reported,
      seen: seenLong(seenMin), seenS: seenShort(seenMin),
    };
  });

  const theme = document.documentElement.dataset.theme;
  const surface = document.documentElement.dataset.surface;
  const screen = document.documentElement.dataset.screen;
  const qid = new URLSearchParams(location.search).get("id");

  const bySeen = [...HAZARDS].sort((a, b) => a.seenMin - b.seenMin);
  const queue = [...HAZARDS].sort((a, b) => a.conf - b.conf || b.seenMin - a.seenMin);
  const samples = HAZARDS.filter((h) => h.sample).length;
  const lastHour = HAZARDS.filter((h) => h.seenMin <= 60);
  const lastHourSamples = lastHour.filter((h) => h.sample).length;

  function href(scr, id) {
    const query = id ? "?id=" + encodeURIComponent(id) : "";
    return scr + "-" + theme + ".html" + query;
  }
  function otherTheme() {
    const next = theme === "dark" ? "light" : "dark";
    const id = qid ? "?id=" + encodeURIComponent(qid) : "";
    return screen + "-" + next + ".html" + id;
  }

  function pinSvg(h, size) {
    const meta = CAT[h.cat];
    const s = size;
    let shape;
    let ty = s / 2;
    if (h.height === "head") {
      shape = `<polygon points="${s / 2},1.6 ${s - 1.6},${s - 2.2} 1.6,${s - 2.2}" fill="${meta.color}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>`;
      ty = s * 0.66;
    } else if (h.height === "dropoff") {
      shape = `<rect x="2" y="2" width="${s - 4}" height="${s - 4}" rx="1.5" fill="${meta.color}" stroke="#fff" stroke-width="2.2"/>`;
    } else {
      shape = `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 2.3}" fill="${meta.color}" stroke="#fff" stroke-width="2.2"/>`;
    }
    const fs = Math.round(s * (h.height === "head" ? 0.34 : 0.42));
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true">${shape}<text x="${s / 2}" y="${ty}" fill="${meta.ink}" font-size="${fs}" font-weight="700" font-family="Inter,system-ui,sans-serif" text-anchor="middle" dominant-baseline="central">${meta.letter}</text></svg>`;
  }
  function pinSize(conf) {
    return Math.round(Math.min(40, Math.max(22, 24 + conf * 3)));
  }
  function confPct(c) {
    return Math.max(8, Math.min(100, ((c + 2) / 7) * 100));
  }

  const I = {
    map: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 4.5h15v15h-15zM8.5 12l2.5 2.5 4.5-5"/></svg>',
    moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
    sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
    hazard: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ff7900" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4L12 3.5Zm0 6v4.5m0 2.6v.1"/></svg>',
    clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.6l3 1.8"/></svg>',
    eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>',
    ok: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9.2 2.7 2.7L16.2 9"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5m0-8.2v.1"/></svg>',
    cam: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M9.5 5h5l1.5 2H19a2 2 0 0 1 2 2v8.5M17.5 19H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.5M9.9 10.2a3 3 0 0 0 4 4"/></svg>',
    sig: '<svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="0.5"/><rect x="4.5" y="5.5" width="3" height="6.5" rx="0.5"/><rect x="9" y="3" width="3" height="9" rx="0.5"/><rect x="13.5" y="0.5" width="3" height="11.5" rx="0.5"/></svg>',
    wifi: '<svg width="15" height="12" viewBox="0 0 15 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M1 4.2C3.2 2.2 5.5 1.2 7.5 1.2S11.8 2.2 14 4.2M3.2 6.6c1.2-1.1 2.6-1.6 4.3-1.6s3.1.5 4.3 1.6"/><circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none"/></svg>',
    bat: '<svg width="25" height="12" viewBox="0 0 25 12" fill="none" aria-hidden="true"><rect x="0.6" y="0.6" width="21" height="10.8" rx="2" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="2" width="16" height="8" rx="1" fill="currentColor"/><path d="M23 4v4a1.5 1.5 0 0 0 0-4Z" fill="currentColor"/></svg>',
  };

  function logos() {
    return `<img class="logo-light" src="../assets/logo-light.png" alt="" width="26" height="26"><img class="logo-dark" src="../assets/logo-dark.png" alt="" width="26" height="26">`;
  }
  function brandLink() {
    return `<a class="brand" href="${href("live-map")}">${logos()}<span class="word"><strong>StepSafe</strong><span>Community hazard map</span></span></a>`;
  }
  function who() {
    return `<div class="who"><span class="avatar" aria-hidden="true">N</span><p class="nm"><b>Neighbor-5ae3</b><span>0 karma · verifier</span></p></div>`;
  }
  function themeControl() {
    const icon = theme === "dark" ? I.moon : I.sun;
    return `<a class="theme-link" href="${otherTheme()}" aria-pressed="${theme === "dark"}">${icon}<span>Dark theme</span></a>`;
  }
  function nav(current) {
    const item = (scr, label, icon) => {
      const on = current === scr ? ' aria-current="page"' : "";
      return `<a href="${href(scr)}"${on}>${icon}${label}</a>`;
    };
    return `<nav class="nav" aria-label="Main">${item("live-map", "Live map", I.map)}${item("verify", "Verify queue", I.check)}</nav>`;
  }
  function sidebar(current) {
    return `<aside class="sidebar">${brandLink()}${nav(current)}<div class="foot">${themeControl()}${who()}</div></aside>`;
  }
  function phoneChrome() {
    if (surface !== "mobile-app") return "";
    return `<div class="status" aria-hidden="true"><span class="time">9:41</span><span class="sigs">${I.sig}${I.wifi}${I.bat}</span></div>`;
  }
  function homeBar() {
    return surface === "mobile-app" ? `<div class="home" aria-hidden="true"><i></i></div>` : "";
  }
  function mobileHead(current) {
    const item = (scr, label, icon) => {
      const on = current === scr ? ' aria-current="page"' : "";
      return `<a href="${href(scr)}"${on}>${icon}${label}</a>`;
    };
    return `${phoneChrome()}<header class="mhead">${brandLink()}<div style="margin-left:auto;display:flex;align-items:center;gap:4px">${who()}${themeControl()}</div></header><nav class="tabs" aria-label="Main">${item("live-map", "Live map", I.map)}${item("verify", "Verify queue", I.check)}</nav>`;
  }

  function pill(kind) {
    const cls = kind === "sample" ? "sample" : kind === "scout" ? "scout" : "walker";
    return `<span class="pill ${cls}">${SRC[kind]}</span>`;
  }
  function metric(icon, label, value, note, extra) {
    return `<div class="metric${extra || ""}"><div class="k">${icon}<span>${label}</span></div><div class="v">${value}</div><div class="n">${note}</div></div>`;
  }
  function metrics(cls) {
    return `<section class="${cls}" aria-label="Summary">
      ${metric(I.hazard, "Active hazards", HAZARDS.length, `${samples} sample · ${HAZARDS.length - samples} real · 5 km`)}
      ${metric(I.clock, "Last hour", lastHour.length, `Reported or seen again · ${lastHourSamples} sample`)}
      ${metric(I.eye, "Awaiting check", HAZARDS.length, `Not yet verified here · ${samples} sample`)}
      ${metric(I.ok, "Cleared today", "0", "Seen clearing live on this page")}
      ${metric(`<span class="dot" aria-hidden="true"></span>`, "Stream", "Live", "Updated just now", " span")}
    </section>`;
  }

  function osmSvg() {
    const dots = window.OSM_DOTS || [];
    const parts = dots.map((d) => {
      const fill = d.t ? "#e2b400" : d.k === "kerb" ? "#8d939c" : "#ffffff";
      const r = d.t ? 0.28 : 0.2;
      return `<circle cx="${d.x * 100}" cy="${d.y * 100}" r="${r}" fill="${fill}"/>`;
    });
    return `<svg class="osm" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${parts.join("")}</svg>`;
  }
  function pinsHtml(list) {
    return list.map((h) => {
      const size = pinSize(h.conf);
      const tag = h.sample ? `<span class="pin-tag">Sample</span>` : "";
      const name = `${CAT[h.cat].letter}${h.sample ? " Sample" : ""} ${h.label}, ${CAT[h.cat].label.toLowerCase()}, ${HGT[h.height].toLowerCase()}, confidence ${h.conf.toFixed(1)}`;
      return `<a class="pin" href="${href("hazard", h.id)}" style="left:${h.x}%;top:${h.y}%;z-index:${Math.round(h.conf * 10)}" aria-label="${esc(name)}">${pinSvg(h, size)}${tag}</a>`;
    }).join("");
  }
  function legendInner() {
    const row = (h, text) => `<li>${pinSvg(h, 16)}<span>${text}</span></li>`;
    return `<div class="legend-grid">
      <div><h3>Color + letter = category</h3><ul>
        ${row({ cat: "moving", height: "ground" }, "Moving")}
        ${row({ cat: "temporary", height: "ground" }, "Temporary")}
        ${row({ cat: "permanent", height: "ground" }, "Permanent")}
      </ul></div>
      <div><h3>Shape = height</h3><ul>
        ${row({ cat: "temporary", height: "ground" }, "Ground level")}
        ${row({ cat: "temporary", height: "head" }, "Head height")}
        ${row({ cat: "temporary", height: "dropoff" }, "Drop-off")}
      </ul></div>
      <p class="fine">Bigger pin = higher community confidence.</p>
    </div>
    <p class="osm-note" id="osm-note" hidden>OpenStreetMap layer: crossings (white), curbs (grey), tactile paving (yellow). Data © OpenStreetMap contributors, <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>.</p>`;
  }
  function mapStage(list, opts) {
    const zoom = opts.zoom || 1;
    const focus = opts.focus;
    const px = focus ? focus.x : 50;
    const py = focus ? focus.y : 50;
    const legend = opts.legend === false ? "" : `<div class="legend">${legendInner()}</div>`;
    return `<div class="map-stage" data-map data-zoom="${zoom}" data-px="${px}" data-py="${py}">
      <div class="frame">
        <img src="../assets/graham-z17.png" alt="">
        <div class="wash"></div>
        ${osmSvg()}
        <div class="pins">${pinsHtml(list)}</div>
      </div>
      ${legend}
      <div class="zoom" aria-hidden="true"><span>+</span><span>−</span></div>
      <a class="attrib" href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>
    </div>`;
  }
  function mapHead() {
    return `<div class="map-head"><div><h2 id="map-heading">Map</h2><p>FIU Graham Center · pin size shows community confidence</p></div>
      <label class="check"><input type="checkbox" id="osm"> OpenStreetMap layer</label></div>`;
  }

  function sheetRows(list) {
    const head = `<div class="tr th" role="row">
      <span></span><span>Hazard</span><span>Class</span><span>Height</span><span>Source</span><span class="num">Conf.</span><span class="num">Seen</span>
    </div>`;
    const rows = list.map((h) => {
      const sub = `${CAT[h.cat].label} · ${HGT[h.height]} · ${SRC[h.source]} · seen ${h.seen}`;
      return `<a class="tr data" role="row" href="${href("hazard", h.id)}">
        <span>${pinSvg(h, 22)}</span>
        <span class="hazard-cell"><span class="name">${esc(h.label)}</span></span>
        <span class="cell">${CAT[h.cat].label}</span>
        <span class="cell" title="${esc(HGT[h.height])}">${h.height === "ground" ? "Ground" : h.height === "head" ? "Head" : "Drop-off"}</span>
        <span class="cell">${pill(h.source)}</span>
        <span class="conf"><b>${h.conf.toFixed(1)}</b><span class="bar" aria-hidden="true"><i style="width:${confPct(h.conf)}%"></i></span></span>
        <span class="cell num" title="seen ${esc(h.seen)}">${h.seenS}</span>
        <span class="subline">${esc(sub)}</span>
      </a>`;
    }).join("");
    return `<div class="sheet" role="table" aria-label="Active hazards">${head}${rows}</div>`;
  }

  function lengthCell(label, m) {
    const v = feet(m);
    return `<div><div class="rk">${label}</div><div class="rv${v ? "" : " quiet"}">${v || "Not measured"}</div></div>`;
  }
  function identity(h, tag) {
    const sample = h.sample ? ` ${pill("sample")}` : "";
    return `<div class="identity"><span class="tile">${pinSvg(h, 26)}</span><div>
      <${tag} class="name-line">${esc(h.label)}${sample}</${tag}>
      <p class="meta">${CAT[h.cat].label} · ${HGT[h.height]} · type “${esc(h.type.replace(/-/g, " "))}”${h.sample ? "" : ""}</p>
    </div></div>`;
  }
  // identity uses h2/h1 via tag but class is on the element through a wrapper. Fix below in markup functions.

  function headingBlock(h, tag) {
    const sample = h.sample ? " " + pill("sample") : "";
    return `<div class="identity"><span class="tile">${pinSvg(h, 26)}</span><div>
      <${tag}>${esc(h.label)}${sample}</${tag}>
      <p class="meta">${CAT[h.cat].label} · ${HGT[h.height]} · type “${esc(h.label === "drop-off" ? "ramp" : h.type.replace(/-/g, " "))}”</p>
    </div></div>`;
  }

  function noticeSample(extra) {
    return `<div class="notice" role="status">${I.info}<div><strong>Sample hazard</strong><p>${extra}</p></div></div>`;
  }
  function photo() {
    return `<div class="photo">${I.cam}<span>No photo was sent with this report</span></div>`;
  }

  function liveDesktop() {
    return `${sidebar("live-map")}<div class="workspace" id="content">
      <header class="pagebar">
        <div class="pagebar-row"><h1>Live map</h1><div class="pagebar-actions"><a class="btn primary" href="${href("verify")}">Verify hazards</a></div></div>
        <p class="lede">Hazards reported by StepSafe walkers within 5 km of FIU Graham Center. Updates arrive live.</p>
      </header>
      ${metrics("metrics")}
      <div class="board">
        <section class="map-col" aria-labelledby="map-heading">${mapHead()}${mapStage(HAZARDS, {})}</section>
        <aside class="ledger" aria-label="Hazard feed">
          <div class="ledger-head"><div><h2 id="list-heading">Active hazards <span class="count">${HAZARDS.length}</span></h2><p>Most recently seen first. Select one for details.</p></div></div>
          ${sheetRows(bySeen)}
        </aside>
      </div>
    </div>`;
  }
  function liveMobile() {
    return `${mobileHead("live-map")}<div class="scroll" id="content">
      <div class="m-page">
        <div class="pagebar-row"><h1>Live map</h1><a class="btn primary" href="${href("verify")}">Verify hazards</a></div>
        <p class="lede">Hazards reported by StepSafe walkers within 5 km of FIU Graham Center. Updates arrive live.</p>
      </div>
      ${metrics("m-metrics")}
      <section class="m-map" aria-labelledby="map-heading">${mapHead()}${mapStage(HAZARDS, { legend: false })}</section>
      <details class="legend-pop"><summary>Map legend</summary><div class="legend-body">${legendInner()}</div></details>
      <section class="m-sheet" aria-labelledby="list-heading">
        <div class="ledger-head"><div><h2 id="list-heading">Active hazards <span class="count">${HAZARDS.length}</span></h2><p>Most recently seen first. Select one for details.</p></div></div>
        ${sheetRows(bySeen)}
      </section>
    </div>${homeBar()}`;
  }

  function verifyForms(h) {
    return `<div class="drawers">
      <form class="drawer" id="reclassify-panel" hidden>
        <fieldset>
          <legend>Propose a correction (change only what’s wrong)</legend>
          <label class="field">Type <span>(now “${esc(h.type.replace(/-/g, " "))}”)</span>
            <select aria-describedby="type-hint"><option>No change</option>
              <optgroup label="Moving"><option>e-scooter</option><option>trash bin</option><option>ramp</option></optgroup>
              <optgroup label="Temporary"><option>construction barrier</option><option>traffic cone</option><option>obstacle</option></optgroup>
              <optgroup label="Permanent"><option>pothole</option><option>curb</option><option>broken sidewalk</option></optgroup>
            </select>
            <span class="hint" id="type-hint">Choosing a type also sets its usual category and height band below.</span>
          </label>
          <label class="field">Category <span>(now ${CAT[h.cat].label.toLowerCase()})</span>
            <select><option>No change</option><option>Moving (clears after 6 hours)</option><option>Temporary (clears after 7 days)</option><option>Permanent (clears after 90 days)</option></select>
          </label>
          <label class="field">Height band <span>(now ${HGT[h.height].toLowerCase()})</span>
            <select><option>No change</option><option>Ground level</option><option>Head height</option><option>Drop-off</option></select>
          </label>
          <button class="btn primary" type="submit">Submit correction</button>
          <p class="form-note" hidden>Proposal recorded: 1 of 3 agree so far. It applies when 3 people propose the same change.</p>
        </fieldset>
      </form>
      <form class="drawer" id="report-panel" hidden>
        <fieldset>
          <legend>Report this hazard</legend>
          <label class="choice"><input type="radio" name="reason" checked> Spam (fake or junk report)</label>
          <label class="choice"><input type="radio" name="reason"> Abuse (offensive or private image)</label>
          <label class="choice"><input type="radio" name="reason"> Other problem</label>
          <button class="btn primary" type="submit">Send report</button>
          <p class="form-note" hidden>Report sent. Thank you; moderators will review it.</p>
        </fieldset>
      </form>
    </div>`;
  }

  function verifyBody(h, next) {
    const measured = (m) => (m == null ? `<div class="rv quiet">Not measured</div>` : `<div class="rv">${feet(m)}</div>`);
    return `<div class="review-main">
        ${headingBlock(h, "h2")}
        ${h.sample ? noticeSample("Seeded for the demo, not a real report. Votes still count for the demo.") : ""}
        ${photo()}
        ${verifyForms(h)}
      </div>
      <div class="review-side">
        ${mapStage([h], { zoom: 2.35, focus: h, legend: false })}
        <div class="readout-row">
          <div><div class="rk">Confidence</div><div class="rv">${h.conf.toFixed(1)}</div></div>
          <div><div class="rk">Clearance</div>${measured(h.clearM)}</div>
          <div><div class="rk">Width left</div>${measured(h.widthM)}</div>
        </div>
        <a class="detail-link" href="${href("hazard", h.id)}">Full details and vote history</a>
      </div>
      <div class="actions">
        <div class="votes">
          <button type="button" class="vote up" data-vote data-msg="Upvoted: still there. Confidence is now ${(h.conf + 0.1).toFixed(1)}."><b>▲ Still there</b><span>Upvote · U</span></button>
          <button type="button" class="vote" data-vote data-msg="Downvoted: gone or not a hazard. Confidence is now ${(h.conf - 1).toFixed(1)}."><b>▼ Gone</b><span>Not a hazard · D</span></button>
          <button type="button" class="vote" data-vote data-msg="${next ? `Skipped ${h.label}. Next: ${next.label}.` : `Skipped ${h.label}. Nothing left in this pass.`}"><b>Skip</b><span>Decide later · S</span></button>
        </div>
        <div class="side-actions">
          <button type="button" class="btn" data-panel="reclassify-panel" aria-expanded="false" aria-controls="reclassify-panel">Reclassify…</button>
          <button type="button" class="btn" data-panel="report-panel" aria-expanded="false" aria-controls="report-panel">Report…</button>
        </div>
        <p id="action-note" hidden></p>
      </div>`;
  }

  function verifyIntro() {
    return `<div class="verify-intro">
      <p class="lede">Least-confident hazards first. Is it still there? Shortcuts: <kbd>U</kbd> upvote, <kbd>D</kbd> downvote, <kbd>S</kbd> skip (when no button or link is focused).</p>
      <div class="queue">
        <p><strong>${queue.length}</strong> left to review</p>
        <div class="track" role="progressbar" aria-label="Hazards checked from this device" aria-valuemin="0" aria-valuemax="${HAZARDS.length}" aria-valuenow="0"><i></i></div>
        <p class="fine">0 of ${HAZARDS.length} checked from this device</p>
      </div>
    </div>`;
  }
  function verifyDesktop() {
    const h = queue[0];
    const next = queue[1];
    return `${sidebar("verify")}<div class="workspace" id="content">
      <header class="pagebar">
        <div class="pagebar-row"><h1>Verify queue</h1>
          <div class="pagebar-actions">
            <label class="check"><input type="checkbox" checked> Keyboard shortcuts</label>
            <span class="live-pill" role="status"><span class="dot" aria-hidden="true"></span> Live</span>
          </div>
        </div>
      </header>
      ${verifyIntro()}
      <article class="review" id="verify-card" aria-labelledby="verify-heading">${verifyBody(h, next).replace("<h2>", '<h2 id="verify-heading">')}</article>
    </div>`;
  }
  function verifyMobile() {
    const h = queue[0];
    const next = queue[1];
    const measured = (m) => (m == null ? `<div class="rv quiet">Not measured</div>` : `<div class="rv">${feet(m)}</div>`);
    return `${mobileHead("verify")}<div class="scroll" id="content">
      <div class="m-page">
        <div class="pagebar-row"><h1>Verify queue</h1></div>
        <div class="pagebar-actions" style="margin:8px 0 0">
          <label class="check"><input type="checkbox" checked> Keyboard shortcuts</label>
          <span class="live-pill" role="status"><span class="dot" aria-hidden="true"></span> Live</span>
        </div>
        <p class="lede">Least-confident hazards first. Is it still there? Shortcuts: <kbd>U</kbd> upvote, <kbd>D</kbd> downvote, <kbd>S</kbd> skip (when no button or link is focused).</p>
      </div>
      <div class="m-verify">
        <div class="queue"><p><strong>${queue.length}</strong> left to review</p>
          <div class="track" role="progressbar" aria-label="Hazards checked from this device" aria-valuemin="0" aria-valuemax="${HAZARDS.length}" aria-valuenow="0"><i></i></div>
          <p class="fine">0 of ${HAZARDS.length} checked from this device</p>
        </div>
        <article class="m-card" id="verify-card">
          <div class="pad">
            ${headingBlock(h, "h2").replace("<h2>", '<h2 id="verify-heading">')}
            ${h.sample ? noticeSample("Seeded for the demo, not a real report. Votes still count for the demo.") : ""}
            ${photo()}
          </div>
          ${mapStage([h], { zoom: 2.5, focus: h, legend: false })}
          <div class="readout-row">
            <div><div class="rk">Confidence</div><div class="rv">${h.conf.toFixed(1)}</div></div>
            <div><div class="rk">Clearance</div>${measured(h.clearM)}</div>
            <div><div class="rk">Width left</div>${measured(h.widthM)}</div>
          </div>
          <a class="detail-link" href="${href("hazard", h.id)}">Full details and vote history</a>
          <div style="padding:0 12px 12px;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn" data-panel="reclassify-panel" aria-expanded="false" aria-controls="reclassify-panel">Reclassify…</button>
            <button type="button" class="btn" data-panel="report-panel" aria-expanded="false" aria-controls="report-panel">Report…</button>
          </div>
          ${verifyForms(h)}
        </article>
      </div>
    </div>
    <div class="vote-dock">
      <p id="action-note" hidden></p>
      <div class="votes">
        <button type="button" class="vote up" data-vote data-msg="Upvoted: still there. Confidence is now ${(h.conf + 0.1).toFixed(1)}."><b>▲ Still there</b><span>Upvote</span></button>
        <button type="button" class="vote" data-vote data-msg="Downvoted: gone or not a hazard. Confidence is now ${(h.conf - 1).toFixed(1)}."><b>▼ Gone</b><span>Not a hazard</span></button>
        <button type="button" class="vote" data-vote data-msg="${next ? `Skipped ${h.label}. Next: ${next.label}.` : "Skipped."}"><b>Skip</b><span>Decide later</span></button>
      </div>
    </div>${homeBar()}`;
  }

  function votesFor(h) {
    if (h.id === "pole-head") {
      return [
        ["2 hours ago", "▲ Still there", "Walker", "1.00"],
        ["Yesterday", "▲ Still there", "Scout", "1.00"],
      ];
    }
    const n = Math.max(1, Math.round(h.conf));
    const rows = [];
    for (let i = 0; i < Math.min(n, 4); i++) {
      rows.push([i === 0 ? h.seen : seenLong(h.seenMin + (i + 1) * 40), "▲ Still there", i % 2 ? "Walker" : "Scout", "1.00"]);
    }
    return rows;
  }
  function expiresLine(h) {
    if (h.cat === "moving") return `in 5 hours <span class="rv quiet" style="font-size:12px">(${CAT.moving.life} without an upvote)</span>`;
    if (h.cat === "temporary") return `in 6 days <span class="rv quiet" style="font-size:12px">(${CAT.temporary.life} without an upvote)</span>`;
    return `in 87 days <span class="rv quiet" style="font-size:12px">(${CAT.permanent.life} without an upvote)</span>`;
  }
  function hazardMain(h) {
    const cells = [
      lengthCell("Clearance height", h.clearM),
      lengthCell("Remaining sidewalk width", h.widthM),
      `<div><div class="rk">Confidence</div><div class="rv">${h.conf.toFixed(1)}</div><div class="rk" style="margin-top:3px;letter-spacing:0">Cleared below −2</div></div>`,
      `<div><div class="rk">Severity</div><div class="rv">${h.sev} of 3</div></div>`,
      `<div><div class="rk">Last seen</div><div class="rv" style="font-size:14px">${esc(h.seen)}</div></div>`,
      `<div><div class="rk">Expires</div><div class="rv" style="font-size:14px">${expiresLine(h)}</div></div>`,
      `<div><div class="rk">First reported</div><div class="rv quiet">${esc(h.reported)}</div></div>`,
      `<div><div class="rk">Spoken in Spanish</div><div class="rv quiet" lang="es">${esc(h.es)}</div></div>`,
    ];
    const pending = h.id === "pole-head"
      ? `<div class="pending"><span>Change to <b>type “broken sidewalk”, ground level</b></span><span>1 of 3 agree</span></div>`
      : `<p>None. A change applies when 3 people propose it.</p>`;
    const vrows = votesFor(h).map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="num">${r[3]}</td></tr>`).join("");
    return `<div class="panel pad">
      ${headingBlock(h, "h2")}
      <div class="pills">${h.sample ? "" : pill(h.source)}<span class="pill">${CAT[h.cat].label}</span><span class="pill">${HGT[h.height]}</span><span class="pill">Active</span></div>
      ${h.sample ? `<div style="margin-top:12px">${noticeSample("Seeded for the demo. It was not reported by a real walker.")}</div>` : ""}
      <div style="margin-top:12px">${photo()}</div>
      <div class="readouts" style="margin-top:12px">${cells.join("")}</div>
      <section class="block"><h3>Pending reclassifications</h3>${pending}</section>
      <section class="block"><h3>Vote history (${votesFor(h).length})</h3>
        <div class="table-wrap"><table class="votes-table"><thead><tr><th>When</th><th>Vote</th><th>From</th><th class="num">Weight</th></tr></thead><tbody>${vrows}</tbody></table></div>
      </section>
    </div>
    <aside class="panel map-panel" aria-label="Location">
      <div class="map-head"><div><h2>Location</h2><p>FIU Graham Center · this hazard</p></div></div>
      ${mapStage([h], { zoom: 2.2, focus: h, legend: false })}
    </aside>`;
  }
  function hazardDesktop() {
    const h = HAZARDS.find((x) => x.id === qid) || HAZARDS[0];
    return `${sidebar("hazard")}<div class="workspace" id="content">
      <header class="pagebar"><div class="pagebar-row"><h1>Hazard details</h1><div class="pagebar-actions"><a class="btn quiet" href="${href("live-map")}">← Back to the map</a></div></div></header>
      <div class="hazard-wrap">${hazardMain(h)}</div>
    </div>`;
  }
  function hazardMobile() {
    const h = HAZARDS.find((x) => x.id === qid) || HAZARDS[0];
    return `${mobileHead("live-map")}<div class="scroll" id="content">
      <div class="m-page"><div class="pagebar-row"><h1>Hazard details</h1></div>
        <p class="lede"><a href="${href("live-map")}">← Back to the map</a></p>
      </div>
      <div class="m-hazard">
        <div class="m-card"><div class="pad">
          ${headingBlock(h, "h2")}
          <div class="pills">${h.sample ? "" : pill(h.source)}<span class="pill">${CAT[h.cat].label}</span><span class="pill">${HGT[h.height]}</span><span class="pill">Active</span></div>
          ${h.sample ? noticeSample("Seeded for the demo. It was not reported by a real walker.") : ""}
          ${photo()}
          <div class="readouts">${[
            lengthCell("Clearance height", h.clearM),
            lengthCell("Remaining sidewalk width", h.widthM),
            `<div><div class="rk">Confidence</div><div class="rv">${h.conf.toFixed(1)}</div></div>`,
            `<div><div class="rk">Severity</div><div class="rv">${h.sev} of 3</div></div>`,
            `<div><div class="rk">Last seen</div><div class="rv quiet">${esc(h.seen)}</div></div>`,
            `<div><div class="rk">Expires</div><div class="rv quiet">${h.cat === "moving" ? "in 5 hours" : h.cat === "temporary" ? "in 6 days" : "in 87 days"}</div></div>`,
            `<div><div class="rk">First reported</div><div class="rv quiet">${esc(h.reported)}</div></div>`,
            `<div><div class="rk">Spoken in Spanish</div><div class="rv quiet" lang="es">${esc(h.es)}</div></div>`,
          ].join("")}</div>
          <section class="block"><h3>Pending reclassifications</h3>${h.id === "pole-head" ? `<div class="pending"><span>Change to <b>type “broken sidewalk”, ground level</b></span><span>1 of 3 agree</span></div>` : `<p>None. A change applies when 3 people propose it.</p>`}</section>
          <section class="block"><h3>Vote history (${votesFor(h).length})</h3>
            <div class="table-wrap"><table class="votes-table"><thead><tr><th>When</th><th>Vote</th><th>From</th><th class="num">Weight</th></tr></thead><tbody>${votesFor(h).map((r) => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td><td>${r[2]}</td><td class="num">${r[3]}</td></tr>`).join("")}</tbody></table></div>
          </section>
        </div></div>
        ${mapStage([h], { zoom: 2.2, focus: h, legend: false })}
      </div>
    </div>${homeBar()}`;
  }

  function markup() {
    const mobile = surface !== "desktop";
    if (screen === "live-map") return mobile ? liveMobile() : liveDesktop();
    if (screen === "verify") return mobile ? verifyMobile() : verifyDesktop();
    return mobile ? hazardMobile() : hazardDesktop();
  }

  function fitMaps() {
    document.querySelectorAll("[data-map]").forEach((stage) => {
      const frame = stage.querySelector(".frame");
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!frame || !w || !h) return;
      const zoom = Number(stage.dataset.zoom || 1);
      const px = Number(stage.dataset.px || 50);
      const py = Number(stage.dataset.py || 50);
      const size = Math.max(w, h) * zoom;
      frame.style.width = size + "px";
      frame.style.height = size + "px";
      if (zoom > 1) {
        frame.style.left = w / 2 - (px / 100) * size + "px";
        frame.style.top = h / 2 - (py / 100) * size + "px";
      } else {
        frame.style.left = (w - size) / 2 + "px";
        frame.style.top = (h - size) / 2 + "px";
      }
    });
  }

  function bind() {
    const osm = document.getElementById("osm");
    if (osm) {
      osm.addEventListener("change", () => {
        document.querySelectorAll("[data-map]").forEach((m) => m.classList.toggle("show-osm", osm.checked));
        const note = document.getElementById("osm-note");
        if (note) note.hidden = !osm.checked;
      });
    }
    document.querySelectorAll("[data-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-panel");
        const panel = document.getElementById(id);
        const willOpen = panel.hasAttribute("hidden");
        document.querySelectorAll(".drawer").forEach((d) => d.setAttribute("hidden", ""));
        document.querySelectorAll("[data-panel]").forEach((b) => b.setAttribute("aria-expanded", "false"));
        if (willOpen) {
          panel.removeAttribute("hidden");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });
    document.querySelectorAll("form.drawer").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const note = form.querySelector(".form-note");
        if (note) note.hidden = false;
      });
    });
    document.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const note = document.getElementById("action-note");
        if (!note) return;
        note.hidden = false;
        note.textContent = btn.getAttribute("data-msg");
      });
    });
  }

  const root = document.getElementById("app");
  root.innerHTML = `<a class="skip" href="#content">Skip to content</a>` + markup();
  bind();
  const refit = () => requestAnimationFrame(() => requestAnimationFrame(fitMaps));
  refit();
  window.addEventListener("resize", fitMaps);
  window.addEventListener("load", refit);
})();
