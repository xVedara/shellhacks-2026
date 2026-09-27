"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { DESKTOP_QUERY } from "./desktop.ts";

const subscribeDesktop = (onChange: () => void) => {
  const mq = matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

/** True on the side-panel layout. Server HTML renders the phone layout. */
export function useDesktop() {
  return useSyncExternalStore(subscribeDesktop, () => matchMedia(DESKTOP_QUERY).matches, () => false);
}

/**
 * The map stage height and the phone sheet height, shared by the live map and the hazard page.
 * `sheet` is 0 on desktop and null until the first measurement.
 */
export function useSheetMetrics(stageRef: RefObject<HTMLElement | null>, panelRef: RefObject<HTMLElement | null>) {
  const desktop = useDesktop();
  const [stageH, setStageH] = useState(700);
  const [sheet, setSheet] = useState<number | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    const panel = panelRef.current;
    if (!stage || !panel) return;
    const read = () => {
      setStageH(stage.getBoundingClientRect().height || 700);
      const next = matchMedia(DESKTOP_QUERY).matches ? 0 : Math.round(panel.getBoundingClientRect().height);
      setSheet((prev) => (prev === next ? prev : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(stage);
    ro.observe(panel);
    const mq = matchMedia(DESKTOP_QUERY);
    mq.addEventListener("change", read);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", read);
    };
  }, [stageRef, panelRef]);
  return { desktop, stageH, sheet };
}
