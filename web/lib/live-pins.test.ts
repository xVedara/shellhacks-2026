import assert from "node:assert/strict";
import test from "node:test";
import type { HazardSummary } from "./api";
import { createLivePins } from "./live-pins.ts";

function hazard(id: string, type: string): HazardSummary {
  return {
    id,
    type,
    category: "temporary",
    lat: 25.7566,
    lng: -80.3739,
    heightBand: "ground",
    confidence: 1,
    lastSeen: "2026-09-26T00:00:00.000Z",
    status: "active",
    label: id,
    sample: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("a slower earlier snapshot does not undo a newer snapshot or live events", async () => {
  const session = createLivePins();
  const older = deferred<HazardSummary[] | null>();
  const newer = deferred<HazardSummary[] | null>();
  const loadOlder = session.load(() => older.promise);
  const loadNewer = session.load(() => newer.promise);
  session.note({ op: "upsert", hazard: hazard("c", "live") });
  session.note({ op: "remove", id: "b" });

  newer.resolve([hazard("a", "new"), hazard("b", "new")]);
  assert.equal(await loadNewer, "ok");
  older.resolve([hazard("a", "old"), hazard("b", "old")]);
  assert.equal(await loadOlder, "stale");

  assert.deepEqual(
    [...session.pins.values()].map((h) => [h.id, h.type]).sort(),
    [
      ["a", "new"],
      ["c", "live"],
    ],
  );
});

test("events that arrive during one snapshot stay on top of it", async () => {
  const session = createLivePins();
  const shot = deferred<HazardSummary[] | null>();
  const pending = session.load(() => shot.promise);
  session.note({ op: "upsert", hazard: hazard("a", "live") });
  session.note({ op: "remove", id: "gone" });
  shot.resolve([hazard("a", "snap"), hazard("gone", "snap")]);
  assert.equal(await pending, "ok");
  assert.equal(session.pins.get("a")?.type, "live");
  assert.equal(session.pins.has("gone"), false);
});

test("a failed snapshot leaves events that already arrived", async () => {
  const session = createLivePins();
  const shot = deferred<HazardSummary[] | null>();
  const pending = session.load(() => shot.promise);
  session.note({ op: "upsert", hazard: hazard("a", "live") });
  shot.resolve(null);
  assert.equal(await pending, "fail");
  assert.equal(session.pins.get("a")?.type, "live");
});
