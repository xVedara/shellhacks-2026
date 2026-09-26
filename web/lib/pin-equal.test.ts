import assert from "node:assert/strict";
import test from "node:test";
import type { HazardSummary } from "./api.ts";
import { sameHazardMarker, type HazardMarkerProps } from "./pin-equal.ts";

function props(over: Partial<HazardSummary> = {}, rest: Partial<HazardMarkerProps> = {}): HazardMarkerProps {
  return {
    hazard: {
      id: "h1",
      type: "trash-bin",
      category: "moving",
      lat: 25.75,
      lng: -80.37,
      heightBand: "ground",
      confidence: 2,
      lastSeen: "2026-09-26T00:00:00.000Z",
      status: "active",
      label: "trash bin",
      sample: false,
      ...over,
    },
    selected: false,
    highlighted: false,
    ...rest,
  };
}

test("same pin data skips a marker redraw", () => {
  assert.equal(sameHazardMarker(props(), props()), true);
});

// Each case changes one field HazardMarker draws or one non-hazard prop.
const hazardChanges: [string, Partial<HazardSummary>][] = [
  ["id", { id: "h2" }],
  ["lat", { lat: 25.76 }],
  ["lng", { lng: -80.38 }],
  ["category", { category: "permanent" }],
  ["heightBand", { heightBand: "head" }],
  ["confidence", { confidence: 3 }],
  ["sample", { sample: true }],
  ["label", { label: "bin" }],
  ["type", { type: "cone" }],
  ["status", { status: "cleared" }],
];

for (const [field, over] of hazardChanges) {
  test(`${field} change forces a redraw`, () => {
    assert.equal(sameHazardMarker(props(), props(over)), false);
  });
}

const markerPropChanges: [string, Partial<HazardMarkerProps>][] = [
  ["selected", { selected: true }],
  ["highlighted", { highlighted: true }],
  ["compact", { compact: true }],
  ["onSelect", { onSelect: () => {} }],
];

for (const [field, rest] of markerPropChanges) {
  test(`${field} change forces a redraw`, () => {
    assert.equal(sameHazardMarker(props(), props({}, rest)), false);
  });
}

test("confidence, selection, and highlight each force a redraw", () => {
  assert.equal(sameHazardMarker(props(), props({ confidence: 3 })), false);
  assert.equal(sameHazardMarker(props(), props({}, { selected: true })), false);
  assert.equal(sameHazardMarker(props(), props({}, { highlighted: true })), false);
});

test("a moved pin or a new click handler forces a redraw", () => {
  assert.equal(sameHazardMarker(props(), props({ lat: 25.76 })), false);
  const onSelect = () => {};
  assert.equal(sameHazardMarker(props({}, { onSelect }), props({}, { onSelect })), true);
  assert.equal(sameHazardMarker(props({}, { onSelect }), props({}, { onSelect: () => {} })), false);
});
