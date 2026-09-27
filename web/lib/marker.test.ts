import assert from "node:assert/strict";
import test from "node:test";
import type { HazardSummary } from "./api.ts";
import { hazardAccessibleName, markerHtml, pinBox, pinPad } from "./marker.ts";

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
    "M trash bin, moving, ground level, confidence 2.0",
  );
  assert.match(hazardAccessibleName(pin({ category: "temporary", label: "scaffold" })), /^T /);
  assert.match(hazardAccessibleName(pin({ category: "permanent", label: "curb" })), /^P /);
});

test("accessible name contains the visible Sample tag after the letter", () => {
  const name = hazardAccessibleName(pin({ sample: true, label: "e-scooter" }));
  assert.match(name, /^M Sample: e-scooter, /);
});

test("accessible name falls back to the type id when there is no label", () => {
  assert.match(hazardAccessibleName(pin({ label: "", type: "trash-bin" })), /^M trash-bin, /);
});

test("the pin frame keeps the category edge and selected ring inside the box", () => {
  const plain = markerHtml(pin(), 40, false);
  assert.match(plain, /ss-pin-frame/);
  assert.match(plain, new RegExp(`padding:${pinPad(false)}px`));
  assert.equal(pinBox(40, false), 40 + pinPad(false) * 2);
  const selected = markerHtml(pin(), 48, true);
  assert.match(selected, /ss-pin--selected/);
  assert.match(selected, new RegExp(`padding:${pinPad(true)}px`));
  assert.equal(pinBox(48, true), 48 + pinPad(true) * 2);
});
