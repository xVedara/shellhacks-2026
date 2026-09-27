"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import SkipLink from "@/components/SkipLink";
import { Legend, LiveDot, Notice, SampleBadge, TypeIcon, linkClass, primaryButton, secondaryButton } from "@/components/ui";
import { API_URL, CATEGORY_META, GRAHAM_CENTER, HEIGHT_META, relativeTime, typeDisplayName, type HazardSummary } from "@/lib/api";
import { milesFromGraham } from "@/lib/geo";
import { mapControlsHidden } from "@/lib/map-controls";
import { useLiveHazards, useNow, useTaxonomy, type Connection } from "@/lib/hooks";
import { clearedSince, visibleRows, type Show } from "@/lib/filter-rows";
import { useSheetMetrics } from "@/lib/use-sheet";
import { useVotedIds } from "@/lib/use-voted";

type Detent = "peek" | "medium" | "expanded";
const SHOW_OPTIONS: { id: Show; label: string; heading: string }[] = [
  { id: "all", label: "All active", heading: "Active hazards" },
  { id: "awaiting", label: "Awaiting my check", heading: "Hazards you have not checked" },
];

const DETENTS: Detent[] = ["peek", "medium", "expanded"];
/** Below this stage height (a landscape phone) medium could not show a row, so the sheet has only peek and expanded. */
const SHORT_STAGE = 400;
const detentsFor = (stage: number): Detent[] => (stage < SHORT_STAGE ? ["peek", "expanded"] : DETENTS);
/** Below this (a landscape phone at 200% zoom) the open sheet takes the whole stage and its chrome tightens. */
const TINY_STAGE = 240;
/** Map left above a peeking sheet: room for the OpenStreetMap credit. */
const MAP_STRIP = 52;
/** Pins hide in a thin strip of map above the sheet: all but the selected one under 120px, every one under 84px. */
function mapPinsClass(desktop: boolean, strip: number) {
  if (desktop || strip >= 120) return "";
  return strip < 84 ? " map-covered" : " pins-thin";
}

function selectedFromLocation() {
  return new URLSearchParams(window.location.search).get("selected");
}

function panelHeight(detent: Detent, stage: number) {
  // Every detent leaves at least MAP_STRIP of map, so the sheet never grows past the stage (under the header).
  if (detent === "peek") return Math.round(Math.max(0, Math.min(230, Math.max(188, stage * 0.24), stage - MAP_STRIP)));
  if (detent === "medium") return Math.round(Math.min(stage - 96, Math.max(280, stage * 0.52)));
  // On a tiny stage a 52px strip would leave no room for a row: the open sheet covers the map.
  if (stage < TINY_STAGE) return Math.round(stage);
  // Keep a 52px strip of map so the OpenStreetMap credit stays on screen.
  if (stage < SHORT_STAGE) return Math.round(stage - MAP_STRIP);
  return Math.round(Math.min(stage - 48, Math.max(360, stage * 0.88)));
}

function connectionWord(connection: Connection) {
  if (connection === "down") return "Offline";
  if (connection === "live") return "Live";
  if (connection === "reconnecting") return "Paused";
  return "Connecting";
}

/** `count` is null until the first snapshot answers. */
function LiveKicker({ connection, count, compact = false }: { connection: Connection; count: number | null; compact?: boolean }) {
  const word = connectionWord(connection);
  return (
    <div>
      <p className="flex min-h-6 items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
        <LiveDot connection={connection} />
        <span>
          <span role="status">{word}</span>
        </span>
        <span className="font-normal text-ink-3">
          · {connection === "down" ? "retrying" : count === null ? "loading" : `${count} nearby`}
        </span>
      </p>
      <p className={`mt-0.5 text-[13px] text-ink-3 ${compact ? "sr-only" : ""}`}>Within 3 mi of FIU Graham Center</p>
    </div>
  );
}

export default function MapPage() {
  const { hazards, connection, loaded, error, recentlyAdded, detailVersion, cleared, lastEventAt } = useLiveHazards();
  const { taxonomy } = useTaxonomy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"list" | "detail">("list");
  const [detent, setDetent] = useState<Detent>("peek");
  const [show, setShow] = useState<Show>("all");
  const [legendChoice, setLegendChoice] = useState<boolean | null>(null);
  const [showOsm, setShowOsm] = useState(false);
  const [dragH, setDragH] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const linkedId = useSyncExternalStore((onChange) => {
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, selectedFromLocation, () => null);
  const voted = useVotedIds();
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const returnFocusTo = useRef<string | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const { desktop, stageH, sheet: measuredSheet } = useSheetMetrics(stageRef, panelRef);

  const list = useMemo(() => [...hazards.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)), [hazards]);
  const selected = selectedId ? hazards.get(selectedId) : undefined;
  const { detail, error: detailError, loading: detailLoading } = useHazardDetail(selectedId, detailVersion(selectedId));
  const newest = recentlyAdded ? hazards.get(recentlyAdded) : undefined;

  const rows = useMemo(() => visibleRows(list, show, voted), [list, show, voted]);

  if (linkedId && selectedId !== linkedId && detent === "peek" && panel === "list") {
    setSelectedId(linkedId);
    setDetent("medium");
  }

  const detents = detentsFor(stageH);
  // "medium" on a short stage shows as expanded; every step below works on the detents this stage offers.
  const shown: Detent = detents.includes(detent) ? detent : "expanded";
  const step = (to: number) => setDetent(detents[Math.min(detents.length - 1, Math.max(0, to))]);
  const legendOpen = legendChoice ?? desktop;
  const toggleLegend = () => setLegendChoice(!legendOpen);
  const panelPx = dragH ?? panelHeight(shown, stageH);
  const sheet = desktop ? 0 : (measuredSheet ?? panelPx);

  const detailOpen = panel === "detail" && !!selectedId && (desktop || shown !== "peek");
  const showPeek = !desktop && shown === "peek" && !detailOpen;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setPanel("detail");
    setDetent("expanded");
  }, []);

  const mapCovered = mapPinsClass(desktop, stageH - sheet) === " map-covered";
  /** First contact failed: nothing to show, and the offline notice covers the map. */
  const blocking = connection === "down" && !loaded;
  const tiny = !desktop && stageH < TINY_STAGE;
  const showOnMap = () => {
    setDetent("peek");
    // The details close; keep keyboard focus on the button that brings them back.
    requestAnimationFrame(() => (document.getElementById("peek-action") ?? document.querySelector<HTMLElement>("[role=slider]"))?.focus());
  };

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
    const options = detents.map((d) => panelHeight(d, stageH));
    let best: Detent = detents[1];
    let gap = Infinity;
    detents.forEach((d, i) => {
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
    // Floor at this stage's peek. A fixed 160px floor sits above peek on a tiny stage (200% landscape),
    // so a downward drag never leaves the open sheet.
    const minH = panelHeight(detents[0], stageH);
    const maxH = panelHeight(detents[detents.length - 1], stageH);
    setDragH(Math.min(maxH, Math.max(minH, drag.current.h + dy)));
  };
  const onGrabUp = () => {
    if (!drag.current) return;
    const moved = drag.current.moved;
    const height = dragH ?? drag.current.h;
    drag.current = null;
    setDragging(false);
    setDragH(null);
    if (!moved) setDetent(detents[(detents.indexOf(shown) + 1) % detents.length]);
    else snap(height);
  };

  return (
    <div ref={stageRef} className="relative flex min-h-0 flex-1">
      <SkipLink
        target="hazard-panel"
        onActivate={() => {
          if (showPeek) setDetent("medium");
        }}
      >
        Skip to hazard panel
      </SkipLink>
      {/* The zoom and locate buttons need a clear strip of map above the sheet. */}
      <div
        className={`map-stage relative min-h-0 min-w-0 flex-1${mapControlsHidden(desktop, stageH, sheet) ? " controls-hidden" : ""}${mapPinsClass(desktop, stageH - sheet)}`}
        style={{ ["--sheet" as string]: `${sheet}px` }}
      >
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
          blocked={blocking}
        />
        {/* The notice needs about 120px of map; on a thinner strip the sheet's "Offline · retrying" says it. */}
        {blocking && stageH - sheet >= 120 && (
          // Above the tiles and pins, below the map controls, so the OpenStreetMap credit stays readable. It stops
          // at the phone sheet's top edge so the sheet never cuts the notice.
          <div className="absolute inset-x-0 top-0 z-[950] flex items-center justify-center bg-page/85 p-4" style={{ bottom: sheet }}>
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
        id="hazard-panel"
        tabIndex={-1}
        className={`sheet-panel${dragging ? " is-dragging" : ""}${tiny ? " is-tiny" : ""}`}
        style={{ ["--panel-h" as string]: `${panelPx}px` }}
        aria-label={showPeek ? "Live status" : detailOpen ? "Hazard details" : "Nearby hazards"}
      >
        <h1 className="sr-only">Live map</h1>
        <button
          type="button"
          className={`flex w-full shrink-0 items-center justify-center md:hidden ${tiny ? "h-8" : "h-11"}`}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={detents.length - 1}
          aria-valuenow={detents.indexOf(shown)}
          aria-valuetext={shown}
          aria-label="Hazard list size"
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
          // Enter/Space and a screen reader's double-tap arrive as a click with detail 0; a tap is handled on pointer up.
          onClick={(e) => {
            if (e.detail === 0) setDetent(detents[(detents.indexOf(shown) + 1) % detents.length]);
          }}
          onKeyDown={(e) => {
            const i = detents.indexOf(shown);
            const byKey: Record<string, number> = { ArrowUp: i + 1, ArrowRight: i + 1, ArrowDown: i - 1, ArrowLeft: i - 1, Home: 0, End: detents.length - 1 };
            const next = byKey[e.key];
            if (next === undefined) return;
            e.preventDefault();
            step(next);
          }}
        >
          <span className="block h-[5px] w-9 rounded-full bg-ink-3" />
        </button>

        <p className="sr-only" aria-live="polite">
          {newest ? `New hazard reported: ${newest.sample ? "sample, " : ""}${newest.label || typeDisplayName(newest.type, taxonomy)}` : ""}
        </p>

        <div key={showPeek ? "peek" : detailOpen ? "detail" : "list"} className="sheet-face flex min-h-0 flex-1 flex-col">
          {showPeek ? (
            <div>
              <LiveKicker connection={connection} count={loaded ? list.length : null} />
              {/* A tiny peek has room only for the status; the handle above opens the sheet. */}
              {!tiny && (
                <button id="peek-action" type="button" className={`${primaryButton} mt-3.5 w-full`} onClick={() => setDetent("medium")}>
                  {panel === "detail" && selectedId ? "Back to details" : "Open list"}
                </button>
              )}
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
                {/* A landscape phone's expanded sheet leaves no room for even the selected pin: drop to peek to see it. */}
                {mapCovered && !tiny && (
                  <button type="button" className={secondaryButton} onClick={showOnMap}>
                    Show on map
                  </button>
                )}
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
                {connection === "reconnecting" && (
                  <div className="mb-3">
                    <Notice tone="info" title="Live updates paused">
                      The event stream dropped. Reconnecting; the list resyncs when it comes back.
                    </Notice>
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
                {/* A cleared hazard is out of the queue, so there is nothing to verify. */}
                {selected && detail?.status !== "cleared" && (
                  <div className="mt-4">
                    <Link href={`/verify?id=${encodeURIComponent(selectedId ?? "")}`} className={`${primaryButton} w-full`}>
                      Verify this hazard
                    </Link>
                  </div>
                )}
                <div className="mt-4">
                  <LegendBlock open={legendOpen} onToggle={toggleLegend} showOsm={showOsm} onOsm={setShowOsm} />
                </div>
              </div>
            </div>
          ) : (
            <LiveHazardList
              connection={connection}
              loaded={loaded}
              total={list.length}
              rows={rows}
              lastEventAt={lastEventAt}
              show={show}
              onShow={setShow}
              selectedId={selectedId}
              recentlyAdded={recentlyAdded}
              taxonomy={taxonomy}
              onSelect={select}
              cleared={cleared}
              legendOpen={legendOpen}
              onLegend={toggleLegend}
              onShowMap={mapCovered && !tiny ? showOnMap : undefined}
              tiny={tiny}
              showOsm={showOsm}
              onOsm={setShowOsm}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

// The 15s clock stays under the list so a tick does not rebuild the map beside it.
function LiveHazardList({
  connection,
  loaded,
  total,
  rows,
  lastEventAt,
  show,
  onShow,
  selectedId,
  recentlyAdded,
  taxonomy,
  onSelect,
  cleared,
  legendOpen,
  onLegend,
  onShowMap,
  tiny,
  showOsm,
  onOsm,
}: {
  connection: Connection;
  loaded: boolean;
  total: number;
  rows: HazardSummary[];
  lastEventAt: number | null;
  show: Show;
  onShow: (next: Show) => void;
  selectedId: string | null;
  recentlyAdded: string | null;
  taxonomy: ReturnType<typeof useTaxonomy>["taxonomy"];
  onSelect: (id: string) => void;
  cleared: Map<string, number>;
  legendOpen: boolean;
  onLegend: () => void;
  /** Set when the expanded sheet covers every pin: drops the sheet so the map shows. */
  onShowMap?: () => void;
  /** Landscape phone at 200% zoom: the status and filters scroll with the rows, so a row shows. */
  tiny: boolean;
  showOsm: boolean;
  onOsm: (next: boolean) => void;
}) {
  const now = useNow(15_000);
  const clearedToday = clearedSince(cleared.values(), new Date(now).setHours(0, 0, 0, 0));
  const option = SHOW_OPTIONS.find((o) => o.id === show) ?? SHOW_OPTIONS[0];
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${tiny ? "scroll-quiet overflow-y-auto" : ""}`}>
      {/* On a landscape phone the status and the filters share one row to leave room for hazards. */}
      <div className="flex shrink-0 flex-col short:flex-row short:flex-wrap short:items-center short:justify-between short:gap-x-4">
        <div className="shrink-0">
          <LiveKicker connection={connection} count={loaded ? total : null} compact={tiny} />
          {lastEventAt && connection === "live" && (
            <p className="sr-only">Updated {relativeTime(new Date(lastEventAt).toISOString(), now)}</p>
          )}
        </div>
        {/* One choice at a time, so native radios: arrow keys move between them. The API only returns active
            hazards, so cleared ones are a count beside the choice, not a filter. */}
        <fieldset className="mt-3 flex shrink-0 flex-wrap items-center gap-2 short:mt-0">
          <legend className="sr-only">Show</legend>
          {SHOW_OPTIONS.map((o) => {
            const on = show === o.id;
            return (
              <label
                key={o.id}
                className={`filter-chip inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-[14px] font-medium tracking-[-0.011em] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--blue)] has-[:focus-visible]:[outline-style:solid] ${
                  on ? "border-[var(--signal)] bg-accent-tint text-accent" : "border-[var(--border-strong)] bg-transparent text-ink"
                }`}
              >
                <input type="radio" name="show" value={o.id} checked={on} onChange={() => onShow(o.id)} className="sr-only" />
                {o.label}
              </label>
            );
          })}
          {show === "awaiting" && loaded && (
            <span className="text-[13px] text-ink-3">
              {rows.length} of {total}
            </span>
          )}
          {clearedToday > 0 && <span className="text-[13px] text-ink-3">{clearedToday} cleared today</span>}
        </fieldset>
        {onShowMap && (
          <button type="button" className={`${secondaryButton} mt-3 short:mt-0`} onClick={onShowMap}>
            Show on map
          </button>
        )}
        <p className="sr-only" aria-live="polite">
          {show === "awaiting" && loaded ? `Showing ${rows.length} of ${total} hazards you have not checked.` : ""}
        </p>
      </div>
      {connection === "reconnecting" && (
        <div className="mt-3 shrink-0">
          <Notice tone="info" title="Live updates paused">
            The event stream dropped. Reconnecting; the list resyncs when it comes back.
          </Notice>
        </div>
      )}
      <h2 id="list-heading" tabIndex={-1} className="sr-only">
        {option.heading} ({rows.length})
      </h2>
      <div className={tiny ? "mt-1" : "scroll-quiet mt-1 min-h-0 flex-1 overflow-y-auto"}>
        {!loaded && connection !== "down" && (
          <p role="status" className="py-3 text-ink-3">
            Loading hazards…
          </p>
        )}
        {!loaded && connection === "down" && <p className="py-3 text-ink-3">Waiting for the server…</p>}
        {loaded && rows.length === 0 && (
          <div className="py-3">
            <Notice tone="info" title={total === 0 ? "No active hazards yet" : "You have checked every hazard"}>
              {total === 0
                ? "Nothing has been reported within 3 miles of the Graham Center. New reports appear here live, no refresh needed."
                : "Choose All active to see them again."}
            </Notice>
          </div>
        )}
        <ul key={show}>
          {rows.map((h, index) => (
            <HazardRow
              key={h.id}
              index={index}
              hazard={h}
              selected={h.id === selectedId}
              isNew={h.id === recentlyAdded}
              now={now}
              taxonomy={taxonomy}
              onSelect={onSelect}
            />
          ))}
        </ul>
        {/* Inside the scroller so it never takes rows' space on a short screen. */}
        <LegendBlock open={legendOpen} onToggle={onLegend} showOsm={showOsm} onOsm={onOsm} />
      </div>
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
        {/* The selected frame is 4px wider per side; pull it back so the text column does not shift. */}
        <span className={`flex shrink-0 ${selected ? "-m-1" : ""}`}>
          <TypeIcon type={h.type} category={h.category} selected={selected} />
        </span>
        <span className="min-w-0 flex-1">
          {/* Only the name truncates, so a long name cannot push the Sample and New tags out of sight. */}
          <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-medium tracking-[-0.02em] text-ink">
            <span className="truncate">{name}</span>
            {h.sample && <span className="shrink-0"><SampleBadge /></span>}
            {/* Accent blue on this tint over a selected row is 4.33:1; ink clears 4.5 (WCAG 1.4.3). */}
            {isNew && <span className="shrink-0 rounded-full bg-accent-tint px-1.5 text-[11px] font-semibold text-ink">New</span>}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-3">
            <span className="sr-only">{CATEGORY_META[h.category].label} · </span>
            {HEIGHT_META[h.heightBand].label} · {milesFromGraham(h.lat, h.lng)} · {relativeTime(h.lastSeen, now)}
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
  onToggle,
  showOsm,
  onOsm,
}: {
  open: boolean;
  onToggle: () => void;
  showOsm: boolean;
  onOsm: (next: boolean) => void;
}) {
  return (
    <div className="shrink-0 border-t border-line">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[14px] font-medium" aria-expanded={open} onClick={onToggle}>
        <span>Legend</span>
        <span className="text-[12px] font-normal text-ink-3">{open ? "Hide" : "Height and category"}</span>
      </button>
      {open && (
        <div className="legend-fold pb-2">
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
        </div>
      )}
    </div>
  );
}
