"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { Legend, LiveDot, Notice, PinTile, SampleBadge, secondaryButton } from "@/components/ui";
import { API_URL, CATEGORY_META, GRAHAM_CENTER, HEIGHT_META, getVotedIds, relativeTime } from "@/lib/api";
import { useLiveHazards, useNow, type Connection } from "@/lib/hooks";

const HOUR = 3_600_000;

// Small stroke icons for the metric strip (drawn for this app).
const ICONS = {
  hazard: <path d="M12 3.5 2.8 19.5h18.4L12 3.5Zm0 6v4.5m0 2.6v.1" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.6l3 1.8" />,
  eye: <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  check: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9.2 2.7 2.7L16.2 9" />,
};

function Metric({
  icon,
  tint,
  label,
  value,
  note,
}: {
  icon: keyof typeof ICONS;
  tint: string;
  label: string;
  value: React.ReactNode;
  note: string;
}) {
  return (
    <div className="glass flex min-w-0 items-center gap-3 px-3.5 py-2.5 sm:py-3">
      <span
        className="hidden h-10 w-10 shrink-0 sm:flex items-center justify-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint, border: `1px solid color-mix(in srgb, ${tint} 35%, transparent)` }}
        aria-hidden="true"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
      </span>
      <div className="min-w-0">
        <p className="eyebrow truncate">{label}</p>
        <p className="font-display text-[1.75rem] font-bold leading-[1.05] tabular-nums text-white sm:text-[2rem]">{value}</p>
        <p className="text-[11px] leading-snug text-muted sm:truncate">{note}</p>
      </div>
    </div>
  );
}

// One word so the tile never wraps; the note line carries the detail.
const STREAM_WORD: Record<Connection, string> = { loading: "Connecting", live: "Live", reconnecting: "Paused", down: "Offline" };

function LiveMetric({ connection, lastEventAt }: { connection: Connection; lastEventAt: number | null }) {
  return (
    <div className="glass col-span-2 flex min-w-0 items-center gap-3 px-3.5 py-2 sm:col-span-1 sm:py-3">
      <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-signal/35 bg-signal/15 sm:flex" aria-hidden="true">
        <LiveDot connection={connection} />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:block">
        <span className="sm:hidden">
          <LiveDot connection={connection} />
        </span>
        <p className="eyebrow hidden sm:block">Stream</p>
        <p role="status" className="font-display text-2xl font-bold uppercase leading-[1.05] text-white sm:text-[2rem]">
          {STREAM_WORD[connection]}
        </p>
        <p className="ml-auto truncate text-[11px] text-muted sm:ml-0">
          {connection === "down"
            ? "Can’t reach the server · retrying"
            : lastEventAt
              ? `Updated ${relativeTime(new Date(lastEventAt).toISOString())}`
              : "Waiting for first update"}
        </p>
      </div>
    </div>
  );
}

export default function MapPage() {
  const { hazards, connection, loaded, error, recentlyAdded, detailVersion, cleared, lastEventAt } = useLiveHazards();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOsm, setShowOsm] = useState(false);
  const [voted] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : getVotedIds()));
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
  const sampleCount = list.filter((h) => h.sample).length;
  const lastHour = list.filter((h) => now - new Date(h.lastSeen).getTime() < HOUR).length;
  const awaiting = list.filter((h) => !voted.has(h.id)).length;
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
    <div className="flex flex-1 flex-col gap-3 p-3 lg:min-h-0 lg:p-4">
      <h1 className="sr-only">Live hazard map</h1>
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          icon="hazard"
          tint="#ff7900"
          label="Active hazards"
          value={show(list.length)}
          note={loaded ? `${sampleCount} sample · ${list.length - sampleCount} real · 5 km` : "Within 5 km"}
        />
        <Metric icon="clock" tint="#13b9f2" label="Last hour" value={show(lastHour)} note="Reported or seen again" />
        <Metric icon="eye" tint="#5aa7ff" label="Awaiting check" value={show(awaiting)} note="Not yet verified from this device" />
        <Metric icon="check" tint="#9fb3c8" label="Cleared today" value={show(clearedToday)} note="Seen clearing live on this page" />
        <LiveMetric connection={connection} lastEventAt={lastEventAt} />
      </section>

      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
        <div className="glass relative h-[58vh] min-h-80 overflow-hidden p-0 lg:h-auto lg:flex-1">
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
          <div className="glass-float pointer-events-none absolute left-3 top-3 z-[1000] hidden px-3.5 py-2 sm:block">
            <p className="eyebrow">FIU Graham Center</p>
            <p className="font-display text-lg font-bold uppercase leading-tight tracking-wide text-white">Live hazard map</p>
          </div>
          <label className="glass-float absolute right-3 top-3 z-[1000] flex max-w-[15rem] sm:max-w-[15rem] cursor-pointer items-start gap-2.5 px-3 py-2 text-sm text-white">
            <input
              type="checkbox"
              checked={showOsm}
              onChange={(e) => setShowOsm(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#087ff5]"
            />
            <span>
              <span className="font-semibold">OpenStreetMap layer</span>
              <span className="hidden text-xs text-muted sm:block">Crossings (white), curbs (grey), tactile paving (yellow). © OSM contributors, ODbL.</span>
            </span>
          </label>
          <div className="glass-float absolute bottom-3 left-3 z-[1000] hidden px-4 py-3 lg:block">
            <Legend />
          </div>
          {connection === "down" && !loaded && (
            <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-navy/80 p-4 backdrop-blur-sm">
              <div className="max-w-md rounded-xl bg-navy-2 shadow-2xl">
                <Notice tone="warn" title="Can’t reach the StepSafe server">
                  <p>
                    Tried <code className="break-all text-white">{API_URL}</code>. {error && `(${error}) `}Retrying every 5 seconds; the map
                    fills in as soon as it answers.
                  </p>
                </Notice>
              </div>
            </div>
          )}
        </div>

        <aside aria-label="Hazard feed and details" className="glass flex flex-col lg:min-h-0 lg:w-[420px] lg:shrink-0">
          <p className="sr-only" aria-live="polite">
            {newest ? `New hazard reported: ${newest.sample ? "sample, " : ""}${newest.label || newest.type}` : ""}
          </p>

          {(connection === "reconnecting" || (connection === "down" && loaded)) && (
            <div className="px-4 pt-4">
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
            <section aria-labelledby="panel-heading" className="scroll-quiet flex flex-col gap-3 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className={secondaryButton} onClick={closePanel}>
                  ← All hazards
                </button>
                <Link href={`/hazard/${encodeURIComponent(selectedId)}`} className="px-2 py-2 text-sm font-semibold text-signal underline underline-offset-4 hover:text-white">
                  Open full page
                </Link>
              </div>
              <h2 id="panel-heading" ref={panelHeading} tabIndex={-1} className="sr-only">
                Hazard details
              </h2>
              {loaded && !selected && (
                <Notice tone="info" title="This hazard was cleared or removed">
                  It is no longer on the live map.
                </Notice>
              )}
              {detailLoading && <p role="status" className="text-muted">Loading hazard details…</p>}
              {detailError && <Notice tone="warn" title="Couldn’t load this hazard">{detailError}</Notice>}
              {detail && <HazardDetail hazard={detail} />}
            </section>
          ) : (
            <section aria-labelledby="list-heading" className="flex flex-col lg:min-h-0 lg:flex-1">
              <div className="flex items-end justify-between gap-2 border-b border-edge px-4 pb-3 pt-4">
                <div>
                  <p className="eyebrow">Hazard feed</p>
                  <h2 id="list-heading" tabIndex={-1} className="font-display text-2xl font-bold uppercase leading-tight tracking-wide text-white">
                    {loaded ? `${list.length} active ${list.length === 1 ? "hazard" : "hazards"}` : "Active hazards"}
                  </h2>
                </div>
                <Link href="/verify" className="mb-1 text-sm font-semibold text-signal underline underline-offset-4 hover:text-white">
                  Verify queue →
                </Link>
              </div>
              <details className="border-b border-edge px-4 py-3 lg:hidden">
                <summary className="cursor-pointer text-sm font-semibold text-white">Map legend</summary>
                <div className="mt-3">
                  <Legend />
                  <p className="mt-2 text-xs text-muted">
                    OpenStreetMap layer: crossings (white), curbs (grey), tactile paving (yellow). Data © OpenStreetMap contributors, ODbL.
                  </p>
                </div>
              </details>

              <div className="scroll-quiet p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {!loaded && connection !== "down" && (
                  <p role="status" className="p-3 text-muted">
                    Loading hazards…
                  </p>
                )}
                {!loaded && connection === "down" && <p className="p-3 text-sm text-muted">Waiting for the server…</p>}
                {loaded && list.length === 0 && (
                  <div className="p-2">
                    <Notice tone="info" title="No active hazards yet">
                      Nothing has been reported within 5 km of the Graham Center. New reports appear here live, no refresh needed.
                    </Notice>
                  </div>
                )}
                <ul className="space-y-1">
                  {list.map((h) => {
                    const isNew = h.id === recentlyAdded;
                    return (
                      <li key={h.id}>
                        <button
                          type="button"
                          data-hazard-id={h.id}
                          onClick={() => select(h.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06] ${
                            isNew ? "border-signal/60 bg-signal/10" : "border-transparent"
                          }`}
                        >
                          <PinTile hazard={h} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[15px] font-semibold leading-snug text-white">
                              {h.label || h.type} {h.sample && <SampleBadge />}
                              {isNew && (
                                <span className="rounded-full bg-signal px-2 py-px text-[10px] font-bold uppercase tracking-wider text-navy">New</span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-muted">
                              {CATEGORY_META[h.category].label} · {HEIGHT_META[h.heightBand].label} · seen {relativeTime(h.lastSeen, now)}
                            </span>
                          </span>
                          <span className="flex w-10 shrink-0 flex-col items-end gap-1" aria-label={`confidence ${h.confidence.toFixed(1)}`}>
                            <span className="font-display text-lg font-bold leading-none tabular-nums text-white">{h.confidence.toFixed(1)}</span>
                            <span className="h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                              <span
                                className="block h-full rounded-full bg-signal"
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
  );
}
