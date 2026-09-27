import assert from "node:assert/strict";
import test from "node:test";
import { applyTypePick, getVotedIds, isTaxonomyArray, relativeTime, rememberVote, typeDisplayName, type HazardType, type ReclassifyPickState } from "./api.ts";

const trashBin: HazardType = { id: "trash-bin", en: "trash bin", es: "cubo de basura", category: "moving", defaultHeightBand: "ground" };
const ladder: HazardType = { id: "ladder", en: "ladder", es: "escalera de mano", category: "temporary", defaultHeightBand: "head" };
const taxonomy: HazardType[] = [trashBin, ladder];

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

test("isTaxonomyArray accepts a well-formed list, including empty", () => {
  assert.equal(isTaxonomyArray(taxonomy), true);
  assert.equal(isTaxonomyArray([]), true);
});

test("isTaxonomyArray rejects non-arrays and malformed entries", () => {
  assert.equal(isTaxonomyArray(null), false);
  assert.equal(isTaxonomyArray(undefined), false);
  assert.equal(isTaxonomyArray({ error: "bad_request" }), false);
  assert.equal(isTaxonomyArray("trash-bin"), false);
  assert.equal(isTaxonomyArray([{ en: "trash bin" }]), false); // missing id
  assert.equal(isTaxonomyArray([{ id: 1 }]), false); // id not a string
  assert.equal(isTaxonomyArray([trashBin, null]), false); // one bad entry spoils the list
});

const empty: ReclassifyPickState = { category: "", heightBand: "", autoFilled: { category: false, heightBand: false } };

test("applyTypePick pre-fills category and height band from the chosen type's defaults", () => {
  assert.deepEqual(applyTypePick("ladder", ladder, empty), {
    category: "temporary",
    heightBand: "head",
    autoFilled: { category: true, heightBand: true },
  });
});

test("applyTypePick never overwrites a field the volunteer already set", () => {
  const userSetCategory: ReclassifyPickState = { category: "permanent", heightBand: "", autoFilled: { category: false, heightBand: false } };
  assert.deepEqual(applyTypePick("ladder", ladder, userSetCategory), {
    category: "permanent", // untouched
    heightBand: "head", // still pre-filled
    autoFilled: { category: false, heightBand: true },
  });
});

test("applyTypePick picking a different type does not re-fill a field that already has a value", () => {
  const afterFirstPick = applyTypePick("ladder", ladder, empty);
  const afterSecondPick = applyTypePick("trash-bin", trashBin, afterFirstPick);
  assert.deepEqual(afterSecondPick, afterFirstPick); // category/heightBand are non-empty, so untouched
});

test("applyTypePick resetting type to 'No change' clears only the fields it auto-filled", () => {
  const filled = applyTypePick("ladder", ladder, empty);
  assert.deepEqual(applyTypePick("", undefined, filled), empty);
});

test("relativeTime uses minutes, hours, and days, and rejects a bad timestamp", () => {
  const now = Date.parse("2026-09-26T12:00:00.000Z");
  assert.equal(relativeTime("2026-09-26T11:59:30.000Z", now), "just now");
  assert.equal(relativeTime("2026-09-26T11:58:00.000Z", now), "2 minutes ago");
  assert.equal(relativeTime("2026-09-26T10:00:00.000Z", now), "2 hours ago");
  assert.equal(relativeTime("2026-09-25T12:00:00.000Z", now), "yesterday");
  assert.equal(relativeTime("2026-09-26T12:00:30.000Z", now), "in under a minute");
  assert.equal(relativeTime("not-a-date", now), "unknown");
});

test("getVotedIds returns the same set until a vote is remembered", () => {
  const before = getVotedIds();
  assert.equal(getVotedIds(), before);
  rememberVote("vote-queue-test-id");
  const after = getVotedIds();
  assert.equal(after.has("vote-queue-test-id"), true);
  assert.notEqual(after, before);
  assert.equal(getVotedIds(), after);
});

test("applyTypePick resetting type to 'No change' leaves a manually-set field alone", () => {
  const userSetCategory: ReclassifyPickState = { category: "permanent", heightBand: "", autoFilled: { category: false, heightBand: false } };
  const filled = applyTypePick("ladder", ladder, userSetCategory); // heightBand auto-fills to "head"
  assert.deepEqual(applyTypePick("", undefined, filled), {
    category: "permanent", // never touched, so it survives the reset
    heightBand: "",
    autoFilled: { category: false, heightBand: false },
  });
});
