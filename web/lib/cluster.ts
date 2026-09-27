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
