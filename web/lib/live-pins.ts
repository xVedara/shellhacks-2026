import type { HazardEvent, HazardSummary } from "./api";

/** Apply one stream event to a pin map. Returns the id when it added a pin that was not there. */
export function applyEvent(pins: Map<string, HazardSummary>, evt: HazardEvent): string | null {
  if (evt.op === "remove") {
    pins.delete(evt.id);
    return null;
  }
  if (evt.op !== "upsert" || !evt.hazard?.id) return null;
  if (evt.hazard.status === "cleared") {
    pins.delete(evt.hazard.id);
    return null;
  }
  const added = !pins.has(evt.hazard.id);
  pins.set(evt.hazard.id, evt.hazard);
  return added ? evt.hazard.id : null;
}

export type SnapshotSettle = "ok" | "fail" | "stale";

/** Pins for one live subscription, plus events that arrived during a /hazards/near fetch. */
export function createLivePins() {
  let pins = new Map<string, HazardSummary>();
  let buffer: HazardEvent[] | null = null;

  return {
    get pins() {
      return pins;
    },
    note(evt: HazardEvent) {
      buffer?.push(evt);
      return applyEvent(pins, evt);
    },
    async load(fetchList: () => Promise<HazardSummary[] | null>): Promise<SnapshotSettle> {
      buffer = [];
      const list = await fetchList();
      const pending = buffer ?? [];
      buffer = null;
      if (!list) return "fail";
      pins = new Map(list.map((h) => [h.id, h]));
      for (const evt of pending) applyEvent(pins, evt);
      return "ok";
    },
  };
}
