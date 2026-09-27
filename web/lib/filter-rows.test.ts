import assert from "node:assert/strict";
import test from "node:test";
import { clearedSince, visibleRows } from "./filter-rows.ts";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("all shows every active hazard, voted or not", () => {
  assert.deepEqual(visibleRows(list, "all", new Set(["b"])).map((h) => h.id), ["a", "b", "c"]);
});

test("awaiting hides the hazards this device already voted on", () => {
  assert.deepEqual(visibleRows(list, "awaiting", new Set(["b"])).map((h) => h.id), ["a", "c"]);
  assert.deepEqual(visibleRows(list, "awaiting", new Set(["a", "b", "c"])), []);
});

test("visibleRows never hands back the caller's array", () => {
  assert.notEqual(visibleRows(list, "all", new Set()), list);
});

test("clearedSince counts only clears at or after the cutoff", () => {
  assert.equal(clearedSince([100, 200, 300], 200), 2);
  assert.equal(clearedSince(new Map([["x", 50]]).values(), 100), 0);
});
