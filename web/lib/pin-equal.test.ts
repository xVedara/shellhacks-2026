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

test("a new object with the same fields still skips a redraw", () => {
  assert.equal(sameHazardMarker(props(), props({ confidence: 2 })), true);
});

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
