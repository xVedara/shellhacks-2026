import assert from "node:assert/strict";
import test from "node:test";
import { clusterByPixel, pushClear } from "./cluster.ts";

test("nearby pins become one cluster and distant pins stay separate", () => {
  const groups = clusterByPixel(
    [
      { item: "a", x: 0, y: 0 },
      { item: "b", x: 10, y: 8 },
      { item: "c", x: 80, y: 80 },
    ],
    30,
  );
  const sets = groups.map((g) => g.items.slice().sort()).sort((a, b) => a.length - b.length);
  assert.deepEqual(sets, [["c"], ["a", "b"]]);
});

test("pushClear moves a point out to the minimum distance and leaves far points alone", () => {
  assert.deepEqual(pushClear({ x: 10, y: 0 }, { x: 0, y: 0 }, 56), { x: 56, y: 0 });
  assert.deepEqual(pushClear({ x: 0, y: 0 }, { x: 0, y: 0 }, 56), { x: 0, y: -56 });
  assert.deepEqual(pushClear({ x: 100, y: 0 }, { x: 0, y: 0 }, 56), { x: 100, y: 0 });
});

test("pushClear keeps the bubble on the map near an edge", () => {
  const bounds = { w: 300, h: 200 };
  // Pushed up would leave the top edge, so it turns to the nearest angle that stays on the map.
  const up = pushClear({ x: 150, y: 10 }, { x: 150, y: 30 }, 56, bounds, 22);
  assert.ok(up.y >= 22 && up.y <= 178 && up.x >= 22 && up.x <= 278, JSON.stringify(up));
  assert.ok(Math.hypot(up.x - 150, up.y - 30) >= 55.99, JSON.stringify(up));
  // Already far enough but outside: turns around the pin, the first spot inside wins.
  const p = pushClear({ x: 310, y: 100 }, { x: 250, y: 100 }, 56, bounds, 22);
  assert.ok(p.x >= 22 && p.x <= 278 && p.y >= 22 && p.y <= 178);
});

test("pushClear finds a diagonal that keeps the gap when all four sides are off the map", () => {
  const bounds = { w: 100, h: 100 };
  const from = { x: 40, y: 40 };
  const p = pushClear({ x: 40, y: 30 }, from, 50, bounds, 22);
  assert.ok(p.x >= 22 && p.x <= 78 && p.y >= 22 && p.y <= 78, `inside: ${JSON.stringify(p)}`);
  assert.ok(Math.hypot(p.x - from.x, p.y - from.y) >= 50 - 1e-9, `keeps min: ${JSON.stringify(p)}`);
});
