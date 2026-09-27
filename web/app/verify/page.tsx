"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Crop, HazardHeading, useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { ConnectionBadge, Notice, PageBar, linkClass, primaryButton, secondaryButton } from "@/components/ui";
import {
  API_URL,
  ApiError,
  CATEGORIES,
  CATEGORY_META,
  HEIGHT_BANDS,
  HEIGHT_META,
  RECLASSIFY_THRESHOLD,
  api,
  formatLength,
  rememberVote,
  typeDisplayName,
  applyTypePick,
  type Category,
  type HazardType,
  type HeightBand,
  type ReclassifyPickState,
} from "@/lib/api";
import { announceAction, useLiveHazards, useTaxonomy } from "@/lib/hooks";
import { useVotedIds } from "@/lib/use-voted";

type Panel = null | "reclassify" | "report";

const voteButton =
  // Labels may wrap inside the pill on narrow phones (reflow at 320px); from md up they stay on one line.
  "flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full border px-2 py-2 text-center text-[14px] font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:whitespace-nowrap";

const subscribeLocation = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};
/** `/verify?id=<hazard>` (the Verify button on a hazard) reviews that hazard first. */
const requestedFromLocation = () => new URLSearchParams(window.location.search).get("id");

export default function VerifyPage() {
  const { hazards, connection, loaded, error, detailVersion } = useLiveHazards();
  const { taxonomy, error: taxonomyError, retry: retryTaxonomy } = useTaxonomy();
  const voted = useVotedIds();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [shortcutsOn, setShortcutsOn] = useState(true);
  const requestedId = useSyncExternalStore(subscribeLocation, requestedFromLocation, () => null);

  const all = useMemo(() => [...hazards.values()], [hazards]);
  const queue = useMemo(
    () =>
      all
        .filter((h) => !voted.has(h.id) && !skipped.has(h.id))
        .sort((a, b) => a.confidence - b.confidence || a.lastSeen.localeCompare(b.lastSeen)),
    [all, voted, skipped],
  );

  // Keep the hazard on screen stable while live updates reorder the queue.
  const reviewable = (id: string | null): id is string => !!id && hazards.has(id) && !voted.has(id) && !skipped.has(id);
  const currentId = reviewable(pinnedId) ? pinnedId : reviewable(requestedId) ? requestedId : (queue[0]?.id ?? null);
  // Say why the linked hazard is not the one on screen (a skip is the volunteer's own choice).
  const requestedNote =
    // Hidden while a vote or skip message shows: that message already says what happened.
    loaded && requestedId && currentId !== requestedId && !skipped.has(requestedId) && !message
      ? `${voted.has(requestedId) ? "You already checked that hazard from this device." : "That hazard is no longer active."}${
          currentId ? " Showing the next one in the queue." : ""
        }`
      : null;
  if (currentId !== pinnedId) {
    setPinnedId(currentId);
    setPanel(null);
  }
  const current = currentId ? hazards.get(currentId) : undefined;
  // Bumped by "Try again" so a failed detail request can be re-sent; voting waits for the details.
  const [retryKey, setRetryKey] = useState(0);
  // The empty queue's scroller is focusable (a region to scroll); when a hazard arrives it stops being a tab stop,
  // so focus that was on it moves to the new card instead of resting on a non-focusable node.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hasCard = !!current;
  useLayoutEffect(() => {
    if (hasCard && document.activeElement === scrollerRef.current) document.getElementById("verify-card")?.focus({ preventScroll: true });
  }, [hasCard]);
  const { detail, error: detailError, loading: detailLoading } = useHazardDetail(currentId, `${detailVersion(currentId)}:${retryKey}`);
  // Nothing can be voted on until its photo and details are on screen.
  const ready = !!detail && detail.id === currentId;
  const measured = (m: number | null | undefined) =>
    !ready ? (detailError ? "—" : "Loading…") : m != null ? formatLength(m) : "Not measured";

  const hazardName = useCallback(
    (h: { label: string; type: string; sample: boolean }) =>
      `${h.sample ? "Sample " : ""}${h.label || typeDisplayName(h.type, taxonomy)}`,
    [taxonomy],
  );

  // `busy` flips on the next render, so a second click in the same turn would POST again.
  const voteLock = useRef(false);
  const skip = useCallback(() => {
    if (!currentId || !current || voteLock.current) return;
    const next = queue.find((h) => h.id !== currentId);
    const name = hazardName(current);
    setSkipped((s) => new Set(s).add(currentId));
    // The card swaps in place. A live message is what tells a screen reader it moved.
    setMessage({
      tone: "info",
      text: next ? `Skipped ${name}. Next: ${hazardName(next)}.` : `Skipped ${name}. Nothing left in this pass.`,
    });
  }, [current, currentId, hazardName, queue]);

  const vote = useCallback(
    async (dir: "up" | "down") => {
      if (!currentId || voteLock.current || !ready) return;
      voteLock.current = true;
      setBusy(true);
      setMessage(null);
      try {
        const res = await api.vote(currentId, dir);
        rememberVote(currentId);
        setMessage({
          tone: "info",
          text: `${dir === "up" ? "Upvoted: still there" : "Downvoted: gone or not a hazard"}. Confidence is now ${res.confidence.toFixed(1)}${res.status === "cleared" ? " and the hazard is cleared" : ""}.`,
        });
        announceAction();
      } catch (e) {
        if (e instanceof ApiError && e.code === "not_found") setSkipped((s) => new Set(s).add(currentId));
        setMessage({ tone: "warn", text: e instanceof Error ? e.message : String(e) });
      } finally {
        voteLock.current = false;
        setBusy(false);
      }
    },
    [currentId, ready],
  );

  useEffect(() => {
    if (!shortcutsOn || !ready) return;
    // WCAG 2.1.4: single-key shortcuts only when focus is on the page body or plain content
    // inside the hazard card, never on a link, button or form field, and they can be turned off.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement;
      const onPage = el === document.body || !!el.closest?.("#verify-card");
      if (!onPage || el.closest("a, button, input, textarea, select, summary, label, [contenteditable=true], [role=button], [tabindex]:not(#verify-card)")) return;
      const key = e.key.toLowerCase();
      if (key === "u") vote("up");
      else if (key === "d") vote("down");
      else if (key === "s") skip();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vote, skip, shortcutsOn, ready]);

  const skippedLeft = all.filter((h) => skipped.has(h.id) && !voted.has(h.id)).length;
  const checked = all.filter((h) => voted.has(h.id)).length;

  return (
    // scroll-pb: keyboard focus scrolls clear of the sticky vote bar (WCAG 2.4.11); the bar is static on a
    // landscape phone and from md up. With no hazard card there may be nothing focusable to scroll with, so the
    // region itself takes focus then (axe scrollable-region-focusable).
    <div
      className="min-h-0 flex-1 overflow-y-auto scroll-pb-[88px] short:scroll-pb-0 md:scroll-pb-0"
      ref={scrollerRef}
      tabIndex={current ? undefined : 0}
      role={current ? undefined : "region"}
      aria-label={current ? undefined : "Verify queue"}
    >
      <PageBar title="Verify queue">
        {/* U/D/S still fire when a keyboard is paired with a coarse pointer, so the off switch stays on screen (WCAG 2.1.4). */}
        {current && (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
            <input
              type="checkbox"
              checked={shortcutsOn}
              onChange={(e) => setShortcutsOn(e.target.checked)}
              className="h-4 w-4 accent-[var(--blue)]"
            />
            Keyboard shortcuts
          </label>
        )}
        <ConnectionBadge connection={connection} />
      </PageBar>
      <div className="w-full max-w-[1200px] p-4 lg:px-6 lg:py-5">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <p className="text-ink-2">
            Least-confident hazards first. Is it still there?
            {shortcutsOn && current && (
              <span className="pointer-coarse:hidden">
                {" "}Shortcuts: <kbd className="kbd">U</kbd> upvote, <kbd className="kbd">D</kbd> downvote, <kbd className="kbd">S</kbd> skip
                (when no button or link is focused).
              </span>
            )}
          </p>
          {loaded && (
            <div className="panel min-w-56 px-3.5 py-3">
              <p className="text-[13px] text-ink-2">
                <span className="text-[20px] font-semibold tabular-nums text-heading">{queue.length}</span> left to review
              </p>
              {all.length > 0 && (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-label="Hazards checked from this device"
                  aria-valuemin={0}
                  aria-valuemax={all.length}
                  aria-valuenow={checked}
                >
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(checked / all.length) * 100}%` }} />
                </div>
              )}
              <p className="mt-1 text-[12px] text-ink-3">
                {checked} of {all.length} checked from this device
              </p>
            </div>
          )}
        </div>

        {requestedNote && (
          <div className="mb-4">
            <Notice tone="info" title={requestedNote} />
          </div>
        )}
        <div aria-live="polite" className={message ? "mb-4" : undefined}>
          {message && <Notice tone={message.tone} title={message.text} announce={false} />}
        </div>

        {!loaded && connection !== "down" && (
          <p role="status" className="text-ink-3">
            Loading hazards…
          </p>
        )}
        {!loaded && connection === "down" && (
          <Notice tone="warn" title="Can’t reach the StepSafe server">
            Tried <code className="break-all text-ink">{API_URL}</code>. {error && `(${error}) `}Retrying every 5 seconds.
          </Notice>
        )}
        {loaded && all.length === 0 && (
          <Notice tone="info" title="Nothing to verify yet">
            No active hazards within 3 miles of the Graham Center. New reports show up here automatically.
          </Notice>
        )}
        {loaded && all.length > 0 && !current && (
          <div className="panel p-4">
            <Notice tone="info" title={skippedLeft ? `You skipped the remaining ${skippedLeft}.` : "You’re all caught up."}>
              {skippedLeft ? (
                <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setSkipped(new Set())}>
                  Review skipped hazards
                </button>
              ) : (
                <p>
                  This device has voted on every active hazard. New reports appear here live.{" "}
                  <Link href="/" className={linkClass}>
                    Back to the map
                  </Link>
                </p>
              )}
            </Notice>
          </div>
        )}

        {current && (
          <article
            id="verify-card"
            tabIndex={-1}
            aria-labelledby="verify-heading"
            className="panel grid gap-4 p-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:grid-rows-[auto_auto_1fr] md:gap-x-6 md:p-5"
          >
            {/* With a photo the left column spans the card's rows; without one it would leave an empty band. */}
            <div className={`space-y-4 ${detail?.crop ? "md:row-span-3" : ""}`}>
              {detailLoading && <p role="status" className="text-ink-3">Loading photo and details…</p>}
              {detailError && (
                <Notice tone="warn" title="Couldn’t load details">
                  <p>{detailError} Voting waits for the photo and details; Skip still works.</p>
                  <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setRetryKey((k) => k + 1)}>
                    Try again
                  </button>
                </Notice>
              )}
              {detail && detail.id === current.id && (
                <>
                  <div id="verify-heading">
                    <HazardHeading hazard={detail} taxonomy={taxonomy} />
                  </div>
                  {detail.sample && (
                    <Notice tone="info" title="Sample hazard">
                      Seeded for the demo, not a real report. Votes still count for the demo.
                    </Notice>
                  )}
                  <Crop hazard={detail} className="max-h-96" taxonomy={taxonomy} />
                </>
              )}
            </div>

            <div className="space-y-3">
              <div className="h-56 overflow-hidden rounded-lg border border-line md:h-64">
                <Map
                  hazards={[current]}
                  center={[current.lat, current.lng]}
                  zoom={18}
                  selectedId={current.id}
                  compact
                  label={`Location of the hazard under review`}
                />
              </div>
              <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-line text-[13px] text-ink [&>div+div]:border-l [&>div]:border-line">
                <div className="px-3 py-2">
                  <dt className="label">Confidence</dt>
                  <dd className="text-[16px] font-semibold tabular-nums text-heading">{current.confidence.toFixed(1)}</dd>
                </div>
                <div className="px-3 py-2">
                  <dt className="label">Clearance</dt>
                  <dd className="mt-0.5 font-medium">{measured(detail?.measurements?.clearanceM)}</dd>
                </div>
                <div className="px-3 py-2">
                  <dt className="label">Width left</dt>
                  <dd className="mt-0.5 font-medium">{measured(detail?.measurements?.widthM)}</dd>
                </div>
              </dl>
              <Link
                href={`/hazard/${encodeURIComponent(current.id)}`}
                className={`${linkClass} inline-flex min-h-11 items-center text-[13px]`}
              >
                Full details and vote history
              </Link>
            </div>

            {/* Direct child of the article so it can stick to the bottom of a phone screen. A landscape phone is
                too short for a sticky bar (it would cover most of the card), so there it stays in the flow. */}
            <div className="sticky bottom-0 z-[1100] -mx-4 grid grid-cols-3 gap-2 border-t border-line bg-card p-3 pb-[max(12px,env(safe-area-inset-bottom))] short:static md:static md:mx-0 md:self-start md:border-0 md:bg-transparent md:p-0">
              <button type="button" disabled={busy || !ready} aria-keyshortcuts={shortcutsOn ? "U" : undefined} onClick={() => vote("up")} className={`${voteButton} border-primary bg-primary text-primary-ink hover:bg-[var(--primary-hover)]`}>
                <span><span aria-hidden="true">▲ </span>Still there</span>
                <span className="text-[12px] font-normal">Upvote{shortcutsOn && <span className="hidden xl:inline"> · U</span>}</span>
              </button>
              <button type="button" disabled={busy || !ready} aria-keyshortcuts={shortcutsOn ? "D" : undefined} onClick={() => vote("down")} className={`${voteButton} border-field bg-card text-ink hover:bg-hover`}>
                <span><span aria-hidden="true">▼ </span>Gone</span>
                <span className="text-[12px] font-normal text-ink-3">Not a hazard{shortcutsOn && <span className="hidden xl:inline"> · D</span>}</span>
              </button>
              <button type="button" disabled={busy} aria-keyshortcuts={shortcutsOn ? "S" : undefined} onClick={skip} className={`${voteButton} border-field bg-card text-ink hover:bg-hover`}>
                <span>Skip</span>
                <span className="text-[12px] font-normal text-ink-3">Decide later{shortcutsOn && <span className="hidden xl:inline"> · S</span>}</span>
              </button>
            </div>

            <div className="space-y-3 md:col-start-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-expanded={panel === "reclassify"}
                  aria-controls="reclassify-panel"
                  onClick={() => setPanel(panel === "reclassify" ? null : "reclassify")}
                  className={secondaryButton}
                >
                  Reclassify…
                </button>
                <button
                  type="button"
                  aria-expanded={panel === "report"}
                  aria-controls="report-panel"
                  onClick={() => setPanel(panel === "report" ? null : "report")}
                  className={secondaryButton}
                >
                  Report…
                </button>
              </div>

              {panel === "reclassify" && (
                <ReclassifyForm
                  key={current.id}
                  hazardId={current.id}
                  current={current}
                  taxonomy={taxonomy}
                  taxonomyError={taxonomyError}
                  taxonomyRetry={retryTaxonomy}
                />
              )}
              {panel === "report" && <ReportForm key={current.id} hazardId={current.id} />}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

function ReclassifyForm({
  hazardId,
  current,
  taxonomy,
  taxonomyError,
  taxonomyRetry,
}: {
  hazardId: string;
  current: { type: string; category: Category; heightBand: HeightBand };
  taxonomy: HazardType[] | null;
  taxonomyError: string | null;
  taxonomyRetry: () => void;
}) {
  const [type, setType] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [heightBand, setHeightBand] = useState<HeightBand | "">("");
  const [autoFilled, setAutoFilled] = useState<ReclassifyPickState["autoFilled"]>({ category: false, heightBand: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const submitLock = useRef(false);

  const grouped = useMemo(
    () => CATEGORIES.map((c) => ({ category: c, options: (taxonomy ?? []).filter((t) => t.category === c) })),
    [taxonomy],
  );

  // Picking a type pre-fills its default category/height band only while they're still "No
  // change" (never overwrites a value the volunteer set themselves); picking "No change" for type
  // clears only the fields it had auto-filled. See applyTypePick.
  const onTypeChange = (id: string) => {
    setType(id);
    const entry = taxonomy?.find((t) => t.id === id);
    const next = applyTypePick(id, entry, { category, heightBand, autoFilled });
    setCategory(next.category);
    setHeightBand(next.heightBand);
    setAutoFilled(next.autoFilled);
  };
  const onCategoryChange = (value: Category | "") => {
    setCategory(value);
    setAutoFilled((a) => ({ ...a, category: false }));
  };
  const onHeightBandChange = (value: HeightBand | "") => {
    setHeightBand(value);
    setAutoFilled((a) => ({ ...a, heightBand: false }));
  };

  const change = {
    ...(type && type !== current.type ? { type } : {}),
    ...(category && category !== current.category ? { category } : {}),
    ...(heightBand && heightBand !== current.heightBand ? { heightBand } : {}),
  };
  const empty = Object.keys(change).length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (empty || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    try {
      const res = await api.reclassify(hazardId, change);
      setResult({
        tone: "info",
        text: res.applied
          ? `Applied: ${res.agreeing} of ${RECLASSIFY_THRESHOLD} people agreed, so the hazard now uses your change.`
          : `Proposal recorded: ${res.agreeing} of ${RECLASSIFY_THRESHOLD} agree so far. It applies when ${RECLASSIFY_THRESHOLD} people propose the same change.`,
      });
      announceAction();
    } catch (err) {
      setResult({ tone: "warn", text: err instanceof Error ? err.message : String(err) });
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const field = "mt-1 block min-h-11 w-full rounded-xl border border-field bg-card px-3 text-[13px] font-normal text-ink";
  return (
    <form id="reclassify-panel" onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-sunken p-4">
      <fieldset className="space-y-3" disabled={busy}>
        <legend className="font-semibold text-heading">Propose a correction (change only what’s wrong)</legend>
        <div>
          <label htmlFor="reclassify-type" className="block text-[13px] font-medium text-ink">
            Type <span className="font-normal text-ink-3">(now “{typeDisplayName(current.type, taxonomy)}”)</span>
          </label>
          {taxonomyError ? (
            <p role="alert" className="mt-1 font-normal text-warn-ink">
              Couldn’t load hazard types ({taxonomyError}). Type can’t be changed right now; category and height band still can.{" "}
              <button type="button" onClick={taxonomyRetry} className="font-medium text-ink underline underline-offset-2">
                Retry
              </button>
            </p>
          ) : (
            <>
              <select
                id="reclassify-type"
                value={type}
                onChange={(e) => onTypeChange(e.target.value)}
                disabled={!taxonomy}
                aria-describedby="type-hint"
                className={field}
              >
                <option value="">{taxonomy ? "No change" : "Loading…"}</option>
                {grouped.map(({ category: c, options }) => (
                  <optgroup key={c} label={CATEGORY_META[c].label}>
                    {options.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.en}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span id="type-hint" className="mt-1 block text-[12px] font-normal text-ink-3">
                Choosing a type also sets its usual category and height band below.
              </span>
            </>
          )}
        </div>
        <label className="block text-[13px] font-medium text-ink">
          Category <span className="font-normal text-ink-3">(now {CATEGORY_META[current.category].label.toLowerCase()})</span>
          <select value={category} onChange={(e) => onCategoryChange(e.target.value as Category | "")} className={field}>
            <option value="">No change</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label} ({CATEGORY_META[c].lifespan})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] font-medium text-ink">
          Height band <span className="font-normal text-ink-3">(now {HEIGHT_META[current.heightBand].label.toLowerCase()})</span>
          <select value={heightBand} onChange={(e) => onHeightBandChange(e.target.value as HeightBand | "")} className={field}>
            <option value="">No change</option>
            {HEIGHT_BANDS.map((b) => (
              <option key={b} value={b}>
                {HEIGHT_META[b].label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={empty || busy} className={`${primaryButton}`}>
          {busy ? "Sending…" : "Submit correction"}
        </button>
      </fieldset>
      <div aria-live="polite">{result && <Notice tone={result.tone} title={result.text} announce={false} />}</div>
    </form>
  );
}

function ReportForm({ hazardId }: { hazardId: string }) {
  const [reason, setReason] = useState<"spam" | "abuse" | "other">("spam");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const submitLock = useRef(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    try {
      await api.report(hazardId, reason);
      setResult({ tone: "info", text: "Report sent. Thank you; moderators will review it." });
    } catch (err) {
      setResult({ tone: "warn", text: err instanceof Error ? err.message : String(err) });
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  return (
    <form id="report-panel" onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-sunken p-4">
      <fieldset className="space-y-2" disabled={busy || result?.tone === "info"}>
        <legend className="font-semibold text-heading">Report this hazard</legend>
        {(
          [
            ["spam", "Spam (fake or junk report)"],
            ["abuse", "Abuse (offensive or private image)"],
            ["other", "Other problem"],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex min-h-11 items-center gap-2 text-[13px] text-ink">
            <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="h-4 w-4 accent-[var(--blue)]" />
            {text}
          </label>
        ))}
        <button type="submit" className={`${primaryButton}`}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </fieldset>
      <div aria-live="polite">{result && <Notice tone={result.tone} title={result.text} announce={false} />}</div>
    </form>
  );
}
