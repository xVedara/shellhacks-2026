import type { HazardEvent, HazardSummary } from "./api";

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

export function createLivePins() {
  let pins = new Map<string, HazardSummary>();
  let eventsForNewestFetch: HazardEvent[] | null = null;
  let newestFetch = 0;

  return {
    get pins() {
      return pins;
    },
    note(evt: HazardEvent) {
      eventsForNewestFetch?.push(evt);
      return applyEvent(pins, evt);
    },
    async load(fetchList: () => Promise<HazardSummary[] | null>): Promise<SnapshotSettle> {
      const fetchId = ++newestFetch;
      const eventsForThisFetch: HazardEvent[] = [];
      eventsForNewestFetch = eventsForThisFetch;
      const list = await fetchList();
      if (eventsForNewestFetch === eventsForThisFetch) eventsForNewestFetch = null;
      if (fetchId !== newestFetch) return "stale";
      if (!list) return "fail";
      pins = new Map(list.map((h) => [h.id, h]));
      for (const evt of eventsForThisFetch) applyEvent(pins, evt);
      return "ok";
    },
  };
}
