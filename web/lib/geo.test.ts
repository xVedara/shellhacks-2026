import assert from "node:assert/strict";
import test from "node:test";
import { GRAHAM_CENTER } from "./api.ts";
import { milesFromGraham } from "./geo.ts";

test("milesFromGraham is zero at the Graham Center", () => {
  assert.equal(milesFromGraham(GRAHAM_CENTER[0], GRAHAM_CENTER[1]), "0.0 mi");
});

test("milesFromGraham labels one mile due north as 1.0 mi", () => {
  const dLat = (1609.344 / 6371000) * (180 / Math.PI);
  assert.equal(milesFromGraham(GRAHAM_CENTER[0] + dLat, GRAHAM_CENTER[1]), "1.0 mi");
});
