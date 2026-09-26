import assert from "node:assert/strict";
import test from "node:test";
import { typeDisplayName, type HazardType } from "./api.ts";

const taxonomy: HazardType[] = [
  { id: "trash-bin", en: "trash bin", es: "cubo de basura", category: "moving", defaultHeightBand: "ground" },
];

test("typeDisplayName resolves a known id to its English name", () => {
  assert.equal(typeDisplayName("trash-bin", taxonomy), "trash bin");
});

test("typeDisplayName falls back to the raw id when the id is unknown", () => {
  assert.equal(typeDisplayName("mystery-object", taxonomy), "mystery-object");
});

test("typeDisplayName falls back to the raw id when the taxonomy hasn't loaded", () => {
  assert.equal(typeDisplayName("trash-bin", null), "trash-bin");
  assert.equal(typeDisplayName("trash-bin", undefined), "trash-bin");
});
