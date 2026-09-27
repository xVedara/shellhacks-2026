/**
 * What the hazard list shows. `/hazards/near` and the live stream carry active hazards only (a cleared
 * upsert removes the pin), so "cleared" is a count, not a filter; see `clearedSince`.
 */
export type Show = "all" | "awaiting";

/** "awaiting": hazards this device has not voted on yet. */
export function visibleRows<T extends { id: string }>(list: readonly T[], show: Show, voted: ReadonlySet<string>): T[] {
  return show === "awaiting" ? list.filter((h) => !voted.has(h.id)) : [...list];
}

/** How many of the clear times (ms) fall on or after `since`. */
export function clearedSince(cleared: Iterable<number>, since: number): number {
  let n = 0;
  for (const t of cleared) if (t >= since) n++;
  return n;
}
