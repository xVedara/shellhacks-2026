"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import { ThemeToggle } from "@/components/Header";
import Map from "@/components/Map";
import { Legend, LiveDot, Notice, SampleBadge, TypeIcon, linkClass, primaryButton, secondaryButton } from "@/components/ui";
import { API_URL, CATEGORY_META, GRAHAM_CENTER, HEIGHT_META, relativeTime, typeDisplayName, type HazardSummary } from "@/lib/api";
import { useLiveHazards, useNow, useTaxonomy, type Connection } from "@/lib/hooks";
import { useVotedIds } from "@/lib/use-voted";

type Detent = "peek" | "medium" | "expanded";
type FilterId = "active" | "awaiting" | "cleared";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "awaiting", label: "Awaiting" },
  { id: "cleared", label: "Cleared" },
];

const DETENTS: Detent[] = ["peek", "medium", "expanded"];

function useDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia("(min-width: 768px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => matchMedia("(min-width: 768px)").matches,
    () => false,
  );
}

function selectedFromLocation() {
  return new URLSearchParams(window.location.search).get("selected");
}

function panelHeight(detent: Detent, stage: number) {
  if (detent === "peek") return Math.round(Math.min(230, Math.max(188, stage * 0.24)));
  if (detent === "medium") return Math.round(Math.min(stage - 96, Math.max(280, stage * 0.52)));
  return Math.round(Math.min(stage - 48, Math.max(360, stage * 0.88)));
}

function milesBetween(lat: number, lng: number) {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat - GRAHAM_CENTER[0]);
  const dLng = toR(lng - GRAHAM_CENTER[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(GRAHAM_CENTER[0])) * Math.cos(toR(lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function connectionWord(connection: Connection) {
  if (connection === "down") return "Offline";
  if (connection === "live") return "Live";
  if (connection === "reconnecting") return "Paused";
  return "Connecting";
}

function LiveKicker({ connection, count }: { connection: Connection; count: number }) {
  const word = connectionWord(connection);
  return (
    <div>
      <p className="flex min-h-6 items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
        <LiveDot connection={connection} />
        <span>
          <span role="status">{word}</span>
          {connection === "down" && <span aria-hidden="true"> failsafe</span>}
        </span>
        {connection !== "down" && <span className="font-normal text-ink-3">· {count} nearby</span>}
      </p>
      <p className="mt-0.5 text-[13px] text-ink-3">Within 3 mi of FIU Graham Center</p>
    </div>
  );
}

export default function MapPage() {
  const { hazards, connection, loaded, error, recentlyAdded, detailVersion, cleared, lastEventAt } = useLiveHazards();
  const { taxonomy } = useTaxonomy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"list" | "detail">("list");
  const [detent, setDetent] = useState<Detent>("peek");
  const [filters, setFilters] = useState<FilterId[]>(["active"]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [showOsm, setShowOsm] = useState(false);
  const [dragH, setDragH] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [measuredSheet, setMeasuredSheet] = useState<number | null>(null);
  const desktop = useDesktop();
  const linkedId = useSyncExternalStore((onChange) => {
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, selectedFromLocation, () => null);
  const voted = useVotedIds();
  const now = useNow(15_000);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const returnFocusTo = useRef<string | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [stageH, setStageH] = useState(700);

  const list = useMemo(() => [...hazards.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)), [hazards]);
  const selected = selectedId ? hazards.get(selectedId) : undefined;
  const { detail, error: detailError, loading: detailLoading } = useHazardDetail(selectedId, detailVersion(selectedId));
  const newest = recentlyAdded ? hazards.get(recentlyAdded) : undefined;

  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const clearedToday = [...cleared.values()].filter((t) => t >= midnight).length;

  const rows = useMemo(() => {
    if (filters.length === 0) return list;
    const active = filters.includes("active");
    const awaiting = filters.includes("awaiting");
    if (!active && !awaiting) return [];
    return awaiting ? list.filter((h) => !voted.has(h.id)) : list;
  }, [filters, list, voted]);

  if (linkedId && selectedId !== linkedId && detent === "peek" && panel === "list") {
    setSelectedId(linkedId);
    setDetent("medium");
  }

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageH(el.getBoundingClientRect().height || 700));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const read = () => {
      const wide = matchMedia("(min-width: 768px)").matches;
      const next = wide ? 0 : Math.round(el.getBoundingClientRect().height);
      setMeasuredSheet((prev) => (prev === next ? prev : next));
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const mq = matchMedia("(min-width: 768px)");
    mq.addEventListener("change", read);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", read);
    };
  }, []);

  const panelPx = dragH ?? panelHeight(detent, stageH);
  const sheet = desktop ? 0 : (measuredSheet ?? panelPx);

  const detailOpen = panel === "detail" && !!selectedId && (desktop || detent !== "peek");
  const showPeek = !desktop && detent === "peek" && !detailOpen;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setPanel("detail");
    setDetent("expanded");
  }, []);

  const closePanel = () => {
    returnFocusTo.current = selectedId;
    setPanel("list");
    setDetent("medium");
  };

  useEffect(() => {
    if (detailOpen) {
      panelHeading.current?.focus();
    } else if (returnFocusTo.current) {
      const row = document.querySelector<HTMLElement>(`[data-hazard-id="${CSS.escape(returnFocusTo.current)}"]`);
      (row ?? document.getElementById("list-heading"))?.focus();
      returnFocusTo.current = null;
    }
  }, [detailOpen]);

  const snap = (height: number) => {
    const options = DETENTS.map((d) => panelHeight(d, stageH));
    let best: Detent = "medium";
    let gap = Infinity;
    DETENTS.forEach((d, i) => {
      const next = Math.abs(options[i] - height);
      if (next < gap) {
        gap = next;
        best = d;
      }
    });
    setDetent(best);
  };

  const onGrabDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { y: e.clientY, h: panelPx, moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGrabMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    setDragH(Math.min(stageH - 48, Math.max(160, drag.current.h + dy)));
  };
  const onGrabUp = () => {
    if (!drag.current) return;
    const moved = drag.current.moved;
    const height = dragH ?? drag.current.h;
    drag.current = null;
    setDragging(false);
    setDragH(null);
    if (!moved) setDetent(DETENTS[(DETENTS.indexOf(detent) + 1) % DETENTS.length]);
    else snap(height);
  };

  const toggleFilter = (id: FilterId) => {
    setFilters((curr) => (curr.includes(id) ? curr.filter((f) => f !== id) : [...curr, id]));
  };

  return (
    <div ref={stageRef} className="relative flex min-h-0 flex-1">
      <div className="map-stage relative min-h-0 min-w-0 flex-1" style={{ ["--sheet" as string]: `${sheet}px` }}>
        <Map
          hazards={list}
          center={GRAHAM_CENTER}
          zoom={17}
          selectedId={selectedId}
          highlightId={recentlyAdded}
          onSelect={select}
          showOsm={showOsm}
          label="Map of reported hazards around FIU Graham Center"
          sheet={sheet}
        />
        {connection === "down" && !loaded && (
          <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-page/85 p-4">
            <div className="max-w-md rounded-xl bg-card shadow-[var(--float-shadow)]">
              <Notice tone="warn" title="Can’t reach the StepSafe server">
                <p>
                  Tried <code className="break-all text-ink">{API_URL}</code>. {error && `(${error}) `}Retrying every 5 seconds; the map fills in as soon
                  as it answers.
                </p>
              </Notice>
            </div>
          </div>
        )}
      </div>

      <aside
        ref={panelRef}
        className={`sheet-panel${dragging ? " is-dragging" : ""}`}
        style={{ ["--panel-h" as string]: `${panelPx}px` }}
        aria-label={showPeek ? "Live status" : detailOpen ? "Hazard details" : "Nearby hazards"}
      >
        <h1 className="sr-only">Live map</h1>
        <button
          type="button"
          className="flex h-11 w-full shrink-0 items-center justify-center md:hidden"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={2}
          aria-valuenow={DETENTS.indexOf(detent)}
          aria-valuetext={detent}
          aria-label="Hazard list size"
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") setDetent(DETENTS[Math.min(2, DETENTS.indexOf(detent) + 1)]);
            if (e.key === "ArrowDown") setDetent(DETENTS[Math.max(0, DETENTS.indexOf(detent) - 1)]);
          }}
        >
          <span className="block h-[5px] w-9 rounded-full bg-[var(--border-strong)]" />
        </button>

        <p className="sr-only" aria-live="polite">
          {newest ? `New hazard reported: ${newest.sample ? "sample, " : ""}${newest.label || typeDisplayName(newest.type, taxonomy)}` : ""}
        </p>

        <div key={showPeek ? "peek" : detailOpen ? "detail" : "list"} className="sheet-face flex min-h-0 flex-1 flex-col">
          {showPeek ? (
            <div>
              <LiveKicker connection={connection} count={loaded ? list.length : 0} />
              <button type="button" className={`${primaryButton} mt-3.5 w-full`} onClick={() => setDetent("medium")}>
                Open list
              </button>
            </div>
          ) : detailOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="sr-only" role="status">
                {connectionWord(connection)}
              </p>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2">
                <button type="button" className={secondaryButton} onClick={closePanel}>
                  All hazards
                </button>
                {selectedId && (
                  <Link href={`/hazard/${encodeURIComponent(selectedId)}`} className={`${linkClass} inline-flex min-h-11 items-center px-1 text-[13px]`}>
                    Open full page
                  </Link>
                )}
              </div>
              <h2 id="panel-heading" ref={panelHeading} tabIndex={-1} className="sr-only">
                Hazard details
              </h2>
              <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto pb-3">
                {(connection === "reconnecting" || (connection === "down" && loaded)) && (
                  <div className="mb-3">
                    {connection === "down" ? (
                      <Notice tone="warn" title="Lost contact with the server">
                        Showing the last hazards received. Reconnecting automatically.
                      </Notice>
                    ) : (
                      <Notice tone="info" title="Live updates paused">
                        The event stream dropped. Reconnecting; the list resyncs when it comes back.
                      </Notice>
                    )}
                  </div>
                )}
                {loaded && !selected && (
                  <Notice tone="info" title="This hazard was cleared or removed">
                    It is no longer on the live map.
                  </Notice>
                )}
                {detailLoading && (
                  <p role="status" className="text-ink-3">
                    Loading hazard details…
                  </p>
                )}
                {detailError && <Notice tone="warn" title="Couldn’t load this hazard">{detailError}</Notice>}
                {detail && <HazardDetail hazard={detail} taxonomy={taxonomy} />}
                <div className="mt-4">
                  <Link href="/verify" className={`${primaryButton} w-full`}>
                    Verify
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0">
                <LiveKicker connection={connection} count={loaded ? list.length : 0} />
                {lastEventAt && connection === "live" && (
                  <p className="sr-only">Updated {relativeTime(new Date(lastEventAt).toISOString(), now)}</p>
                )}
              </div>
              <div className="mt-3 flex shrink-0 flex-wrap gap-2" role="group" aria-label="Filter hazards">
                {FILTERS.map((f) => {
                  const on = filters.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleFilter(f.id)}
                      className={`filter-chip inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium tracking-[-0.011em] ${
                        on ? "border-[var(--signal)] bg-accent-tint text-accent shadow-[0_0_0_3px_var(--signal-soft)]" : "border-[var(--border-strong)] bg-transparent text-ink"
                      }`}
                    >
                      {f.label}
                      {on && <span aria-hidden="true">×</span>}
                    </button>
                  );
                })}
              </div>
              {(connection === "reconnecting" || (connection === "down" && loaded)) && (
                <div className="mt-3 shrink-0">
                  {connection === "down" ? (
                    <Notice tone="warn" title="Lost contact with the server">
                      Showing the last hazards received. Reconnecting automatically.
                    </Notice>
                  ) : (
                    <Notice tone="info" title="Live updates paused">
                      The event stream dropped. Reconnecting; the list resyncs when it comes back.
                    </Notice>
                  )}
                </div>
              )}
              <h2 id="list-heading" tabIndex={-1} className="sr-only">
                Active hazards
              </h2>
              <div className="scroll-quiet mt-1 min-h-0 flex-1 overflow-y-auto">
                {!loaded && connection !== "down" && (
                  <p role="status" className="py-3 text-ink-3">
                    Loading hazards…
                  </p>
                )}
                {!loaded && connection === "down" && <p className="py-3 text-ink-3">Waiting for the server…</p>}
                {loaded && rows.length === 0 && !filters.includes("cleared") && (
                  <div className="py-3">
                    <Notice tone="info" title={list.length === 0 ? "No active hazards yet" : "Nothing matches these filters"}>
                      {list.length === 0
                        ? "Nothing has been reported within 3 miles of the Graham Center. New reports appear here live, no refresh needed."
                        : "Turn a filter off to see the other hazards."}
                    </Notice>
                  </div>
                )}
                {filters.includes("cleared") && (
                  <p className="py-2 text-[13px] text-ink-3">{clearedToday} cleared today on this page.</p>
                )}
                <ul key={filters.join(",")}>
                  {rows.map((h, index) => (
                    <HazardRow
                      key={h.id}
                      index={index}
                      hazard={h}
                      selected={h.id === selectedId}
                      isNew={h.id === recentlyAdded}
                      now={now}
                      taxonomy={taxonomy}
                      onSelect={select}
                    />
                  ))}
                </ul>
              </div>
              <LegendBlock
                open={desktop || legendOpen}
                toggle={!desktop}
                onToggle={() => setLegendOpen((v) => !v)}
                showOsm={showOsm}
                onOsm={setShowOsm}
              />
            </div>
          )}
          {detailOpen && (
            <LegendBlock open={legendOpen} toggle onToggle={() => setLegendOpen((v) => !v)} showOsm={showOsm} onOsm={setShowOsm} />
          )}
        </div>
      </aside>
    </div>
  );
}

function HazardRow({
  hazard: h,
  selected,
  isNew,
  now,
  taxonomy,
  onSelect,
  index,
}: {
  hazard: HazardSummary;
  selected: boolean;
  isNew: boolean;
  now: number;
  taxonomy: ReturnType<typeof useTaxonomy>["taxonomy"];
  onSelect: (id: string) => void;
  index: number;
}) {
  const name = h.label || typeDisplayName(h.type, taxonomy);
  return (
    <li className="hazard-row" style={{ animationDelay: `${Math.min(index, 5) * 28}ms` }}>
      <button
        type="button"
        data-hazard-id={h.id}
        onClick={() => onSelect(h.id)}
        aria-current={selected ? "true" : undefined}
        className={`flex min-h-[60px] w-full items-center gap-3 border-t border-line py-2 text-left transition-[background-color,box-shadow] duration-200 ease-out ${selected ? "-mx-2 w-[calc(100%+16px)] rounded-xl bg-raised px-2 shadow-[inset_0_0_0_1px_var(--signal)]" : ""}`}
      >
        <TypeIcon type={h.type} category={h.category} selected={selected} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium tracking-[-0.02em] text-ink">
            {name} {h.sample && <SampleBadge />}
            {isNew && <span className="ml-1.5 rounded-full bg-accent-tint px-1.5 text-[11px] font-semibold text-accent">New</span>}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-3">
            {CATEGORY_META[h.category].label} · {HEIGHT_META[h.heightBand].label} · {milesBetween(h.lat, h.lng)} · {relativeTime(h.lastSeen, now)}
          </span>
        </span>
        <span className="w-16 shrink-0 text-right">
          <span className="block text-[15px] font-semibold tabular-nums tracking-[-0.02em]">{h.confidence.toFixed(1)}</span>
          <span className="block text-[11px] text-ink-3">confidence</span>
        </span>
      </button>
    </li>
  );
}

function LegendBlock({
  open,
  toggle,
  onToggle,
  showOsm,
  onOsm,
}: {
  open: boolean;
  toggle: boolean;
  onToggle: () => void;
  showOsm: boolean;
  onOsm: (next: boolean) => void;
}) {
  return (
    <div className="shrink-0 border-t border-line">
      {toggle && (
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[14px] font-medium" aria-expanded={open} onClick={onToggle}>
          <span>Legend</span>
          <span className="text-[12px] font-normal text-ink-3">{open ? "Hide" : "Height and category"}</span>
        </button>
      )}
      {open && (
        <div className="legend-fold pb-2">
          {!toggle && <div className="pt-3" />}
          <Legend osm={showOsm} onOsm={onOsm} />
          {showOsm && (
            <p className="mt-2 text-[12px] text-ink-3">
              OpenStreetMap layer: crossings (white), curbs (grey), tactile paving (yellow). Data © OpenStreetMap contributors,{" "}
              <a href="https://opendatacommons.org/licenses/odbl/1-0/" className="underline">
                ODbL
              </a>
              .
            </p>
          )}
          <div className="md:hidden">
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
  );
}
