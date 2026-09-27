"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { Legend, LiveDot, Notice, PageBar, PanelHead, PinTile, SampleBadge, linkClass, primaryButton, secondaryButton } from "@/components/ui";
import { API_URL, CATEGORY_META, GRAHAM_CENTER, HEIGHT_META, relativeTime, typeDisplayName } from "@/lib/api";
import { useLiveHazards, useNow, useTaxonomy, type Connection } from "@/lib/hooks";
import { useVotedIds } from "@/lib/use-voted";

const HOUR = 3_600_000;

// Small stroke icons for the metric tiles (drawn for this app).
const ICONS = {
  hazard: <path d="M12 3.5 2.8 19.5h18.4L12 3.5Zm0 6v4.5m0 2.6v.1" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.6l3 1.8" />,
  eye: <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  check: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9.2 2.7 2.7L16.2 9" />,
};

/** Tinted icon square; the tint is decoration, the label beside it carries the meaning. */
function IconSquare({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <span
      className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md sm:flex"
      style={{ background: `color-mix(in srgb, ${tint} 14%, var(--card))`, color: tint }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function Metric({ icon, tint, label, value, note }: { icon: keyof typeof ICONS; tint: string; label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="panel flex min-w-0 items-start gap-3 px-3.5 py-3">
      <IconSquare tint={tint}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
      </IconSquare>
      <dl className="min-w-0">
        <dt className="truncate text-[13px] text-ink-2">{label}</dt>
        <dd className="text-[20px] font-semibold leading-tight tabular-nums text-heading">{value}</dd>
        <dd className="line-clamp-2 text-[12px] leading-snug text-ink-3">{note}</dd>
      </dl>
    </div>
  );
}

const STREAM_WORD: Record<Connection, string> = { loading: "Connecting", live: "Live", reconnecting: "Paused", down: "Offline" };

function LiveMetric({ connection, lastEventAt }: { connection: Connection; lastEventAt: number | null }) {
  return (
    <div className="panel col-span-2 flex min-w-0 items-start gap-3 px-3.5 py-3 sm:col-span-1">
      <IconSquare tint="var(--ok)">
        <LiveDot connection={connection} />
      </IconSquare>
      <dl className="flex min-w-0 flex-1 items-center gap-2.5 sm:block">
        <dt className="flex items-center gap-2 text-[13px] text-ink-2">
          <span className="sm:hidden">
            <LiveDot connection={connection} />
          </span>
          <span className="sr-only sm:not-sr-only">Stream</span>
        </dt>
        <dd className="text-[20px] font-semibold leading-tight text-heading">
          <span role="status">{STREAM_WORD[connection]}</span>
        </dd>
        <dd className="ml-auto line-clamp-2 text-[12px] leading-snug text-ink-3 sm:ml-0">
          {connection === "down"
            ? "Can’t reach the server · retrying"
            : lastEventAt
              ? `Updated ${relativeTime(new Date(lastEventAt).toISOString())}`
              : "Waiting for first update"}
        </dd>
      </dl>
    </div>
  );
}

const OSM_KEY = "OpenStreetMap layer: crossings (white), curbs (grey), tactile paving (yellow). Data © OpenStreetMap contributors, ODbL.";

export default function MapPage() {
  const { hazards, connection, loaded, error, recentlyAdded, detailVersion, cleared, lastEventAt } = useLiveHazards();
  const { taxonomy } = useTaxonomy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOsm, setShowOsm] = useState(false);
  const voted = useVotedIds();
  const now = useNow(15_000);
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const list = useMemo(
    () => [...hazards.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    [hazards],
  );
  const selected = selectedId ? hazards.get(selectedId) : undefined;
  const { detail, error: detailError, loading: detailLoading } = useHazardDetail(selectedId, detailVersion(selectedId));
  const newest = recentlyAdded ? hazards.get(recentlyAdded) : undefined;

  // Metric strip, computed from what the page already holds (no extra endpoints).
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const samples = (hs: typeof list) => hs.filter((h) => h.sample).length;
  const sampleCount = samples(list);
  // 0 to 1 h old; a lastSeen in the future (clock skew) doesn't count as recent.
  const lastHour = list.filter((h) => {
    const age = now - new Date(h.lastSeen).getTime();
    return age >= 0 && age <= HOUR;
  });
  const awaiting = list.filter((h) => !voted.has(h.id));
  const clearedToday = [...cleared.values()].filter((t) => t >= midnight).length;
  const show = (n: number) => (loaded ? n : "—");

  const select = useCallback((id: string) => setSelectedId(id), []);
  const returnFocusTo = useRef<string | null>(null);
  const closePanel = () => {
    returnFocusTo.current = selectedId;
    setSelectedId(null);
  };
  useEffect(() => {
    if (selectedId) {
      panelHeading.current?.focus();
    } else if (returnFocusTo.current) {
      // Back to the list row for the hazard that was open (falls back to the list heading).
      const row = document.querySelector<HTMLElement>(`[data-hazard-id="${CSS.escape(returnFocusTo.current)}"]`);
      (row ?? document.getElementById("list-heading"))?.focus();
      returnFocusTo.current = null;
    }
  }, [selectedId]);

  return (
    <>
      <PageBar title="Live map">
        <Link href="/verify" className={primaryButton}>
          Verify hazards
        </Link>
      </PageBar>
      <div className="flex flex-1 flex-col gap-4 p-4 lg:min-h-0 lg:px-6 lg:py-5">
        <p className="text-ink-2">Hazards reported by StepSafe walkers within 3 miles of FIU Graham Center. Updates arrive live.</p>
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            icon="hazard"
            tint="#ff7900"
            label="Active hazards"
            value={show(list.length)}
            note={loaded ? `${sampleCount} sample · ${list.length - sampleCount} real · 3 miles` : "Within 3 miles"}
          />
          <Metric
            icon="clock"
            tint="var(--accent)"
            label="Last hour"
            value={show(lastHour.length)}
            note={loaded ? `Reported or seen again · ${samples(lastHour)} sample` : "Reported or seen again"}
          />
          <Metric
            icon="eye"
            tint="var(--accent)"
            label="Awaiting check"
            value={show(awaiting.length)}
            note={loaded ? `Not yet verified here · ${samples(awaiting)} sample` : "Not yet verified from this device"}
          />
          <Metric icon="check" tint="var(--ink-3)" label="Cleared today" value={show(clearedToday)} note="Seen clearing live on this page" />
          <LiveMetric connection={connection} lastEventAt={lastEventAt} />
        </section>

        <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
          <section aria-labelledby="map-heading" className="panel flex flex-col overflow-hidden lg:min-h-0 lg:flex-1">
            <PanelHead
              title={<span id="map-heading">Map</span>}
              sub="FIU Graham Center · pin size shows community confidence"
              action={
                <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
                  <input type="checkbox" checked={showOsm} onChange={(e) => setShowOsm(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                  OpenStreetMap layer
                </label>
              }
            />
            <div className="relative h-[58vh] min-h-80 lg:h-auto lg:flex-1">
              <Map
                hazards={list}
                center={GRAHAM_CENTER}
                zoom={17}
                selectedId={selectedId}
                highlightId={recentlyAdded}
                onSelect={select}
                showOsm={showOsm}
                label="Map of reported hazards around FIU Graham Center"
              />
              <div className="float absolute bottom-3 left-3 z-[1000] hidden max-w-sm px-3.5 py-3 lg:block">
                <Legend />
                {showOsm && <p className="mt-2 border-t border-line pt-2 text-[12px] text-ink-3">{OSM_KEY}</p>}
              </div>
              {connection === "down" && !loaded && (
                <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-page/85 p-4">
                  <div className="max-w-md rounded-lg bg-card shadow-[var(--float-shadow)]">
                    <Notice tone="warn" title="Can’t reach the StepSafe server">
                      <p>
                        Tried <code className="break-all text-ink">{API_URL}</code>. {error && `(${error}) `}Retrying every 5 seconds; the map fills in
                        as soon as it answers.
                      </p>
                    </Notice>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside aria-label="Hazard feed and details" className="panel flex flex-col overflow-hidden lg:min-h-0 lg:w-[400px] lg:shrink-0">
            <p className="sr-only" aria-live="polite">
              {newest ? `New hazard reported: ${newest.sample ? "sample, " : ""}${newest.label || typeDisplayName(newest.type, taxonomy)}` : ""}
            </p>

            {(connection === "reconnecting" || (connection === "down" && loaded)) && (
              <div className="border-b border-line p-3">
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

            {selectedId ? (
              <section aria-labelledby="panel-heading" className="flex flex-col lg:min-h-0 lg:flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <button type="button" className={secondaryButton} onClick={closePanel}>
                    ← All hazards
                  </button>
                  <Link href={`/hazard/${encodeURIComponent(selectedId)}`} className={`${linkClass} px-1 text-[13px]`}>
                    Open full page
                  </Link>
                </div>
                <h2 id="panel-heading" ref={panelHeading} tabIndex={-1} className="sr-only">
                  Hazard details
                </h2>
                <div className="scroll-quiet flex flex-col gap-3 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {loaded && !selected && (
                    <Notice tone="info" title="This hazard was cleared or removed">
                      It is no longer on the live map.
                    </Notice>
                  )}
                  {detailLoading && <p role="status" className="text-ink-3">Loading hazard details…</p>}
                  {detailError && <Notice tone="warn" title="Couldn’t load this hazard">{detailError}</Notice>}
                  {detail && <HazardDetail hazard={detail} taxonomy={taxonomy} />}
                </div>
              </section>
            ) : (
              <section aria-labelledby="list-heading" className="flex flex-col lg:min-h-0 lg:flex-1">
                <PanelHead id="list-heading" title="Active hazards" count={loaded ? list.length : null} sub="Most recently seen first. Select one for details." />
                <details className="border-b border-line px-4 py-2.5 lg:hidden">
                  <summary className="cursor-pointer text-[13px] font-medium text-ink">Map legend</summary>
                  <div className="mt-3">
                    <Legend />
                    <p className="mt-2 text-[12px] text-ink-3">{OSM_KEY}</p>
                  </div>
                </details>

                <div className="scroll-quiet lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {!loaded && connection !== "down" && (
                    <p role="status" className="p-4 text-ink-3">
                      Loading hazards…
                    </p>
                  )}
                  {!loaded && connection === "down" && <p className="p-4 text-ink-3">Waiting for the server…</p>}
                  {loaded && list.length === 0 && (
                    <div className="p-3">
                      <Notice tone="info" title="No active hazards yet">
                        Nothing has been reported within 3 miles of the Graham Center. New reports appear here live, no refresh needed.
                      </Notice>
                    </div>
                  )}
                  <ul className="divide-y divide-line">
                    {list.map((h) => {
                      const isNew = h.id === recentlyAdded;
                      return (
                        <li key={h.id}>
                          <button
                            type="button"
                            data-hazard-id={h.id}
                            onClick={() => select(h.id)}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-offset-[-2px] ${isNew ? "bg-accent-tint" : ""}`}
                          >
                            <PinTile hazard={h} />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium leading-snug text-ink">
                                {h.label || typeDisplayName(h.type, taxonomy)} {h.sample && <SampleBadge />}
                                {isNew && <span className="rounded bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-card">New</span>}
                              </span>
                              <span className="block truncate text-[12px] text-ink-3">
                                {CATEGORY_META[h.category].label} · {HEIGHT_META[h.heightBand].label} · seen {relativeTime(h.lastSeen, now)}
                              </span>
                            </span>
                            <span className="flex w-10 shrink-0 flex-col items-end gap-1" aria-label={`confidence ${h.confidence.toFixed(1)}`}>
                              <span className="text-[13px] font-semibold leading-none tabular-nums text-ink">{h.confidence.toFixed(1)}</span>
                              <span className="h-1 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                                <span
                                  className="block h-full rounded-full bg-accent"
                                  style={{ width: `${Math.max(6, Math.min(100, ((h.confidence + 2) / 7) * 100))}%` }}
                                />
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
