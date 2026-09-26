import assert from "node:assert/strict";
import test from "node:test";
import type { HazardSummary } from "./api.ts";
import { hazardAccessibleName } from "./marker.ts";

function pin(over: Partial<HazardSummary> = {}): HazardSummary {
  return {
    id: "h1",
    type: "trash-bin",
    category: "moving",
    lat: 0,
    lng: 0,
    heightBand: "ground",
    confidence: 2,
    lastSeen: "2026-09-26T00:00:00.000Z",
    status: "active",
    label: "trash bin",
    sample: false,
    ...over,
  };
}

test("accessible name starts with the letter drawn on the pin", () => {
  assert.equal(
    hazardAccessibleName(pin()),
    "M, trash bin, moving, ground level, confidence 2.0",
  );
  assert.match(hazardAccessibleName(pin({ category: "temporary", label: "scaffold" })), /^T, /);
  assert.match(hazardAccessibleName(pin({ category: "permanent", label: "curb" })), /^P, /);
});

test("accessible name includes the visible Sample tag", () => {
  const name = hazardAccessibleName(pin({ sample: true, label: "e-scooter" }));
  assert.equal(name.startsWith("M, Sample: e-scooter"), true);
  assert.equal(name.includes("Sample"), true);
});

test("accessible name falls back to the type id when there is no label", () => {
  assert.match(hazardAccessibleName(pin({ label: "", type: "trash-bin" })), /^M, trash-bin, /);
});
