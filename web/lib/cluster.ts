export type PixelItem<T> = { item: T; x: number; y: number };

export type PixelGroup<T> = { items: T[]; x: number; y: number };

/** Group items whose container points fall within `radius` px of each other. */
export function clusterByPixel<T>(items: PixelItem<T>[], radius: number): PixelGroup<T>[] {
  const unused = items.map(() => true);
  const radiusSq = radius * radius;
  const groups: PixelGroup<T>[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!unused[i]) continue;
    const bucket = [items[i]];
    unused[i] = false;
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < items.length; j++) {
        if (!unused[j]) continue;
        const near = bucket.some((b) => {
          const dx = b.x - items[j].x;
          const dy = b.y - items[j].y;
          return dx * dx + dy * dy <= radiusSq;
        });
        if (!near) continue;
        unused[j] = false;
        bucket.push(items[j]);
        grew = true;
      }
    }
    const x = bucket.reduce((sum, b) => sum + b.x, 0) / bucket.length;
    const y = bucket.reduce((sum, b) => sum + b.y, 0) / bucket.length;
    groups.push({ items: bucket.map((b) => b.item), x, y });
  }
  return groups;
}

type Pt = { x: number; y: number };

/**
 * `point` moved directly away from `from` until it is at least `min` px away (straight up if they coincide).
 * With `bounds` (the map size) and `edge` (the bubble radius), a spot that would leave the map tries the
 * opposite side, then the two sides at right angles, and is clamped inside as a last resort.
 */
export function pushClear(point: Pt, from: Pt, min: number, bounds?: { w: number; h: number }, edge = 0): Pt {
  const inside = (p: Pt) => !bounds || (p.x >= edge && p.x <= bounds.w - edge && p.y >= edge && p.y <= bounds.h - edge);
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d >= min && inside(point)) return { x: point.x, y: point.y };
  const [ux, uy] = d ? [dx / d, dy / d] : [0, -1];
  const tries = [
    [ux, uy],
    [-ux, -uy],
    [uy, -ux],
    [-uy, ux],
  ].map(([x, y]) => ({ x: from.x + x * min, y: from.y + y * min }));
  const fit = tries.find(inside);
  if (fit || !bounds) return fit ?? tries[0];
  return {
    x: Math.min(bounds.w - edge, Math.max(edge, tries[0].x)),
    y: Math.min(bounds.h - edge, Math.max(edge, tries[0].y)),
  };
}
