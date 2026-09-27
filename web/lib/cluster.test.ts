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
