import type { HazardEvent, HazardSummary } from "./api";

/** Drop a payload that is not an upsert or remove. A bad frame must not throw the listener. */
export function parseHazardEvent(data: string): HazardEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const evt = body as { op?: unknown; id?: unknown; hazard?: { id?: unknown } };
  if (evt.op === "remove") return typeof evt.id === "string" ? { op: "remove", id: evt.id } : null;
  if (evt.op === "upsert" && evt.hazard && typeof evt.hazard.id === "string") return body as HazardEvent;
  return null;
}

export function hazardEventTargets(evt: HazardEvent, id: string): boolean {
  return evt.op === "remove" ? evt.id === id : evt.hazard.id === id;
}

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

/**
 * `onCleared` fires for a `status: "cleared"` upsert of a hazard that is on the map. Plain removes
 * don't count: TTL expiry and re-seeding send those too. A clear that lands while a snapshot is in
 * flight is checked again against that snapshot, so a hazard the page hadn't loaded yet still counts.
 */
export function createLivePins(onCleared: (id: string) => void = () => {}) {
  let pins = new Map<string, HazardSummary>();
  let eventsForNewestFetch: HazardEvent[] | null = null;
  let newestFetch = 0;

  const apply = (evt: HazardEvent) => {
    if (evt.op === "upsert" && evt.hazard?.status === "cleared" && pins.has(evt.hazard.id)) onCleared(evt.hazard.id);
    return applyEvent(pins, evt);
  };

  return {
    get pins() {
      return pins;
    },
    note(evt: HazardEvent) {
      eventsForNewestFetch?.push(evt);
      return apply(evt);
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
      for (const evt of eventsForThisFetch) apply(evt);
      return "ok";
    },
  };
}
