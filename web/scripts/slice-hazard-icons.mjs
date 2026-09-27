/**
 * Crop the locked Quiet Signal sheet 1:1 into hazard icon tiles.
 *
 * Pixels are not redrawn, resized, or recolored. Each tile is the bounding box of its
 * blue hairline; corners of the sheet background outside that rounded square may be
 * made transparent. Anything else is left untouched.
 *
 * Source (not committed): Dev's locked sheet
 *   internal/quiet-signal-redesign/refs/qs-icon-system-LOCKED.png
 *
 * Usage: node scripts/slice-hazard-icons.mjs [path-to-sheet]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC =
  "/cursor/stores/bc-c41b5a77-ceee-49f8-9456-20c06116b45b/internal/quiet-signal-redesign/refs/qs-icon-system-LOCKED.png";
const OUT_DIR = path.join(__dirname, "../public/hazard-icons");

/** Reading order within each panel. Ids match server/src/taxonomy.ts except the three height tiles. */
const GROUPS = {
  height: ["height-ground", "height-head", "height-dropoff"],
  moving: [
    "trash-bin",
    "trash-bags",
    "e-scooter",
    "bicycle",
    "motorcycle",
    "parked-car",
    "open-car-door",
    "delivery-robot",
    "shopping-cart",
    "stroller",
    "person",
    "dog",
    "sandwich-board",
    "chair",
    "table",
    "umbrella",
    "box",
    "open-hatch",
  ],
  temporary: [
    "construction-barrier",
    "construction-fence",
    "cone",
    "scaffolding",
    "ladder",
    "open-trench",
    "open-manhole",
    "fallen-branch",
    "fallen-tree",
    "debris",
    "puddle",
    "flooding",
    "hose-or-cable",
    "wet-floor-sign",
    "obstacle",
  ],
  permanentA: [
    "pole",
    "sign",
    "low-sign",
    "low-branch",
    "overhang",
    "awning",
    "bench",
    "planter",
    "tree",
    "tree-root",
    "fire-hydrant",
    "bollard",
    "bike-rack",
    "mailbox",
    "parking-meter",
    "utility-box",
    "bus-shelter",
    "kiosk",
  ],
  permanentB: [
    "gate",
    "fence",
    "wall",
    "railing",
    "glass-door",
    "grate",
    "pothole",
    "broken-sidewalk",
    "uneven-pavement",
    "curb",
    "ramp-missing",
    "ramp",
    "step-up",
    "step-down",
    "stairs-up",
    "stairs-down",
  ],
};

const EXPECTED = Object.values(GROUPS).reduce((n, ids) => n + ids.length, 0);

function isHairline(r, g, b) {
  // Bright blue stroke on the tile. Dimmer than this connects whole panels together;
  // brighter than this breaks rings whose glow is the only closed edge.
  if (b < 130 || r > 200) return false;
  return b > r + 50 && b > g + 15 && g + 5 > r;
}

function detectTiles(data, width, height, channels) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (isHairline(data[i], data[i + 1], data[i + 2])) mask[y * width + x] = 1;
    }
  }

  // Close small gaps in a ring. Radius 2 stays inside the gutter between tiles.
  const radius = 2;
  const closed = new Uint8Array(width * height);
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (mask[(y + dy) * width + (x + dx)]) {
            on = 1;
            break;
          }
        }
      }
      closed[y * width + x] = on;
    }
  }

  const seen = new Uint8Array(width * height);
  const boxes = [];
  const stack = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (!closed[start] || seen[start]) continue;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      let hair = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop();
        const px = p % width;
        const py = (p - px) / width;
        if (mask[p]) {
          hair++;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        if (px > 0 && closed[p - 1] && !seen[p - 1]) {
          seen[p - 1] = 1;
          stack.push(p - 1);
        }
        if (px + 1 < width && closed[p + 1] && !seen[p + 1]) {
          seen[p + 1] = 1;
          stack.push(p + 1);
        }
        if (py > 0 && closed[p - width] && !seen[p - width]) {
          seen[p - width] = 1;
          stack.push(p - width);
        }
        if (py + 1 < height && closed[p + width] && !seen[p + width]) {
          seen[p + width] = 1;
          stack.push(p + width);
        }
      }
      if (!hair) continue;
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const aspect = w / h;
      if (w < 55 || h < 70 || w > 180 || h > 170) continue;
      if (aspect < 0.6 || aspect > 1.45) continue;
      boxes.push({ left: minX, top: minY, width: w, height: h, cx: minX + w / 2, cy: minY + h / 2, count: hair });
    }
  }
  return boxes;
}

function clusterRows(boxes) {
  const medianH = boxes.map((b) => b.height).sort((a, b) => a - b)[Math.floor(boxes.length / 2)] || 100;
  const band = Math.max(48, medianH * 0.45);
  const sorted = [...boxes].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const rows = [];
  for (const box of sorted) {
    const row = rows.find((r) => Math.abs(r.cy - box.cy) < band);
    if (!row) rows.push({ cy: box.cy, boxes: [box] });
    else {
      row.boxes.push(box);
      row.cy = row.boxes.reduce((sum, b) => sum + b.cy, 0) / row.boxes.length;
    }
  }
  for (const row of rows) row.boxes.sort((a, b) => a.cx - b.cx);
  rows.sort((a, b) => a.cy - b.cy);
  return rows;
}

function take(row, ids, fromLeft) {
  const slice = fromLeft ? row.boxes.slice(0, ids.length) : row.boxes.slice(-ids.length);
  if (slice.length !== ids.length) {
    throw new Error(`Expected ${ids.length} tiles, found ${slice.length}`);
  }
  return ids.map((id, i) => ({ id, box: slice[i] }));
}

/**
 * Sheet geometry (1536×1024, 1.5× the 1024×683 reference):
 * top band is height (3) beside moving (2×9), then one temporary row,
 * then permanent A (2×9) beside permanent B (9 then 7).
 * Rows are clustered from the detected borders; this only names them.
 */
function assign(boxes) {
  const rows = clusterRows(boxes);
  const counts = rows.map((r) => r.boxes.length);
  const known = [
    [12, 9, 15, 18, 16],
    [3, 9, 9, 15, 18, 16],
  ];
  const key = counts.join(",");
  if (!known.some((pattern) => pattern.join(",") === key)) {
    throw new Error(
      `Tile rows ${key} do not match the locked sheet (got ${boxes.length} tiles). Refusing to guess names.`,
    );
  }

  let heightRow;
  let movingTop;
  let movingBot;
  let temporary;
  let permTop;
  let permBot;

  if (counts.length === 5 && counts[0] === 12) {
    heightRow = { boxes: rows[0].boxes.slice(0, 3) };
    movingTop = { boxes: rows[0].boxes.slice(3) };
    movingBot = rows[1];
    temporary = rows[2];
    permTop = rows[3];
    permBot = rows[4];
  } else {
    heightRow = rows[0];
    movingTop = rows[1];
    movingBot = rows[2];
    temporary = rows[3];
    permTop = rows[4];
    permBot = rows[5];
  }

  const height = take(heightRow, GROUPS.height, true);
  const moving = [...take(movingTop, GROUPS.moving.slice(0, 9), true), ...take(movingBot, GROUPS.moving.slice(9), true)];
  const temporaryTiles = take(temporary, GROUPS.temporary, true);
  const permanentA = [
    ...take({ boxes: permTop.boxes.slice(0, 9) }, GROUPS.permanentA.slice(0, 9), true),
    ...take({ boxes: permBot.boxes.slice(0, 9) }, GROUPS.permanentA.slice(9), true),
  ];
  const permanentB = [
    ...take({ boxes: permTop.boxes.slice(9) }, GROUPS.permanentB.slice(0, 9), true),
    ...take({ boxes: permBot.boxes.slice(9) }, GROUPS.permanentB.slice(9), true),
  ];

  return { tiles: [...height, ...moving, ...temporaryTiles, ...permanentA, ...permanentB], counts };
}

/** Clear only the sheet showing through the rounded corners. Abort if the fill leaks inside. */
function punchCorners(raw, width, height, channels) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = raw[p * channels];
    rgba[p * 4 + 1] = raw[p * channels + 1];
    rgba[p * 4 + 2] = raw[p * channels + 2];
    rgba[p * 4 + 3] = 255;
  }
  const outside = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (outside[p]) return;
    if (isHairline(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2])) return;
    outside[p] = 1;
    stack.push(p);
  };
  push(0, 0);
  push(width - 1, 0);
  push(0, height - 1);
  push(width - 1, height - 1);
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  let cleared = 0;
  for (let p = 0; p < outside.length; p++) {
    if (!outside[p]) continue;
    rgba[p * 4 + 3] = 0;
    cleared++;
  }
  const ratio = cleared / (width * height);
  // Rounded-square corners are well under this. A leak into the tile is not.
  if (ratio > 0.34) return null;
  return rgba;
}

async function main() {
  const src = process.argv[2] || DEFAULT_SRC;
  if (!fs.existsSync(src)) {
    console.error(`Locked sheet not found: ${src}`);
    process.exit(1);
  }
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const boxes = detectTiles(data, info.width, info.height, info.channels);
  const { tiles, counts } = assign(boxes);
  if (tiles.length !== EXPECTED) {
    throw new Error(`Expected ${EXPECTED} tiles, assigned ${tiles.length}`);
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifestTiles = [];
  for (const tile of tiles) {
    const { left, top, width, height } = tile.box;
    const cropped = await sharp(src)
      .extract({ left, top, width, height })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const punched = punchCorners(cropped.data, cropped.info.width, cropped.info.height, cropped.info.channels);
    const file = `${tile.id}.png`;
    const out = path.join(OUT_DIR, file);
    if (punched) {
      await sharp(punched, { raw: { width, height, channels: 4 } }).png().toFile(out);
    } else {
      await sharp(src).extract({ left, top, width, height }).png().toFile(out);
    }
    manifestTiles.push({
      id: tile.id,
      file,
      left,
      top,
      width,
      height,
      transparentCorners: Boolean(punched),
    });
  }

  const manifest = {
    source: path.basename(src),
    sourceSha256: "56b966cf16c6e4264b09bdd0cc7de0d19ac4c77aab87a6d32e6476f724e615fb",
    image: { width: info.width, height: info.height },
    rows: counts,
    count: manifestTiles.length,
    note: "Crops of the locked sheet. Pixels inside each tile are unchanged. Corners outside the blue hairline may be transparent.",
    tiles: manifestTiles,
  };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestTiles.length} tiles (${counts.join(", ")} rows) to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
