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
 * With `bounds` (the visible map) and `edge` (the bubble radius), a spot that would leave the map turns
 * around `from` in 22.5° steps, nearest angles first, and takes the first spot inside that still keeps `min`.
 * Only when no angle fits (a map smaller than the gap) is it clamped inside.
 */
export function pushClear(point: Pt, from: Pt, min: number, bounds?: { w: number; h: number }, edge = 0): Pt {
  const inside = (p: Pt) => !bounds || (p.x >= edge && p.x <= bounds.w - edge && p.y >= edge && p.y <= bounds.h - edge);
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d >= min && inside(point)) return { x: point.x, y: point.y };
  const base = d ? Math.atan2(dy, dx) : -Math.PI / 2;
  const steps = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8];
  const tries = steps.map((k) => {
    const a = base + (k * Math.PI) / 8;
    // Rounded to 0.01px so trigonometry noise (6e-17) does not leak into positions.
    return { x: Math.round((from.x + Math.cos(a) * min) * 100) / 100, y: Math.round((from.y + Math.sin(a) * min) * 100) / 100 };
  });
  const fit = tries.find(inside);
  if (fit || !bounds) return fit ?? tries[0];
  return {
    x: Math.min(bounds.w - edge, Math.max(edge, tries[0].x)),
    y: Math.min(bounds.h - edge, Math.max(edge, tries[0].y)),
  };
}
