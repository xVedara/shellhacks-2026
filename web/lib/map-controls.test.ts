import assert from "node:assert/strict";
import test from "node:test";
import { MAP_CONTROLS_CLEARANCE, mapControlsHidden } from "./map-controls.ts";

test("hides zoom and locate when the phone strip is shorter than the controls", () => {
  assert.equal(mapControlsHidden(false, 320, 218), true);
  assert.equal(mapControlsHidden(false, 400, 400 - (MAP_CONTROLS_CLEARANCE - 1)), true);
});

test("leaves the controls when the strip is tall enough", () => {
  assert.equal(mapControlsHidden(false, 780, 530), false);
  assert.equal(mapControlsHidden(false, 900, 900 - MAP_CONTROLS_CLEARANCE), false);
});

test("leaves the controls on the desktop side panel", () => {
  assert.equal(mapControlsHidden(true, 120, 0), false);
});
