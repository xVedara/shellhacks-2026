"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { ConnectionBadge, Legend, Notice, PinSwatch, SampleBadge, secondaryButton } from "@/components/ui";
import { API_URL, CATEGORY_META, GRAHAM_CENTER, HEIGHT_META, relativeTime } from "@/lib/api";
import { useLiveHazards } from "@/lib/hooks";

export default function MapPage() {
  const { hazards, connection, loaded, error, recentlyAdded, detailVersion } = useLiveHazards();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOsm, setShowOsm] = useState(false);
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const list = useMemo(
    () => [...hazards.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    [hazards],
  );
  const selected = selectedId ? hazards.get(selectedId) : undefined;
  const { detail, error: detailError, loading: detailLoading } = useHazardDetail(selectedId, detailVersion(selectedId));
  const newest = recentlyAdded ? hazards.get(recentlyAdded) : undefined;

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
    <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
      <div className="relative h-[55vh] min-h-72 lg:h-auto lg:flex-1">
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
        {connection === "down" && !loaded && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-navy/85 p-4">
            <div className="max-w-md">
              <Notice tone="warn" title="Can’t reach the StepSafe server">
                <p>
                  Tried <code className="break-all">{API_URL}</code>. {error && `(${error}) `}Retrying every 5 seconds; the map fills in
                  as soon as it answers.
                </p>
              </Notice>
            </div>
          </div>
        )}
      </div>

      <aside
        aria-label="Hazard list and details"
        className="flex flex-col gap-4 border-t-2 border-line bg-navy p-4 lg:w-[420px] lg:overflow-y-auto lg:border-l-2 lg:border-t-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-white">Live hazard map</h1>
          <ConnectionBadge connection={connection} />
        </div>

        <p className="sr-only" aria-live="polite">
          {newest ? `New hazard reported: ${newest.sample ? "sample, " : ""}${newest.label || newest.type}` : ""}
        </p>

        {connection === "down" && loaded && (
          <Notice tone="warn" title="Lost contact with the server">
            Showing the last hazards received. Reconnecting automatically.
          </Notice>
        )}
        {connection === "reconnecting" && (
          <Notice tone="info" title="Live updates paused">
            The event stream dropped. Reconnecting; the list resyncs when it comes back.
          </Notice>
        )}

        {selectedId ? (
          <section aria-labelledby="panel-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`${secondaryButton}`} onClick={closePanel}>
                ← All hazards
              </button>
              <Link href={`/hazard/${encodeURIComponent(selectedId)}`} className="px-2 py-2 font-semibold text-blue underline underline-offset-4">
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
            {detailLoading && <p role="status">Loading hazard details…</p>}
            {detailError && <Notice tone="warn" title="Couldn’t load this hazard">{detailError}</Notice>}
            {detail && <HazardDetail hazard={detail} />}
          </section>
        ) : (
          <>
            <Legend />
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-line p-3 text-sm text-white">
              <input
                type="checkbox"
                checked={showOsm}
                onChange={(e) => setShowOsm(e.target.checked)}
                className="mt-0.5 h-5 w-5 accent-[#087ff5]"
              />
              <span>
                <span className="font-semibold">Show OpenStreetMap reference layer</span>
                <span className="block text-muted">
                  Crossings (white), curbs (grey), tactile paving (yellow) around the Graham Center. Data © OpenStreetMap
                  contributors, ODbL.
                </span>
              </span>
            </label>

            <section aria-labelledby="list-heading">
              <h2 id="list-heading" tabIndex={-1} className="mb-2 font-semibold text-white">
                {loaded ? `${list.length} active ${list.length === 1 ? "hazard" : "hazards"} within 5 km` : "Active hazards"}
              </h2>
              {!loaded && connection !== "down" && <p role="status">Loading hazards…</p>}
              {!loaded && connection === "down" && <p className="text-sm text-muted">Waiting for the server…</p>}
              {loaded && list.length === 0 && (
                <Notice tone="info" title="No active hazards yet">
                  Nothing has been reported within 5 km of the Graham Center. New reports appear here live, no refresh needed.
                </Notice>
              )}
              <ul className="divide-y divide-line">
                {list.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      data-hazard-id={h.id}
                      onClick={() => select(h.id)}
                      className={`flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-navy-2 ${h.id === recentlyAdded ? "bg-navy-2" : ""}`}
                    >
                      <PinSwatch hazard={h} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-white">
                          {h.label || h.type} {h.sample && <SampleBadge />}
                          {h.id === recentlyAdded && <span className="ml-1 text-xs font-bold uppercase text-signal">New</span>}
                        </span>
                        <span className="block text-sm text-muted">
                          {CATEGORY_META[h.category].label} · {HEIGHT_META[h.heightBand].label} · seen {relativeTime(h.lastSeen)}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums text-muted" aria-label={`confidence ${h.confidence.toFixed(1)}`}>
                        {h.confidence.toFixed(1)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
