"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Crop, HazardHeading, useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { ConnectionBadge, Notice, secondaryButton, primaryButton } from "@/components/ui";
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
  getVotedIds,
  rememberVote,
  type Category,
  type HeightBand,
} from "@/lib/api";
import { announceAction, useLiveHazards } from "@/lib/hooks";

const COMMON_TYPES = ["scooter", "bin", "bike", "construction", "scaffolding", "flooding", "branch", "broken sidewalk", "missing curb ramp", "low sign", "pole", "stairs", "curb"];

type Panel = null | "reclassify" | "report";

const TYPE_RE = /^[a-z0-9 -]{1,40}$/;

const voteButton =
  "flex flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2.5 font-semibold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:px-4 md:py-3";

export default function VerifyPage() {
  const { hazards, connection, loaded, error, detailVersion } = useLiveHazards();
  const [voted, setVoted] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : getVotedIds()));
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [shortcutsOn, setShortcutsOn] = useState(true);

  const all = useMemo(() => [...hazards.values()], [hazards]);
  const queue = useMemo(
    () =>
      all
        .filter((h) => !voted.has(h.id) && !skipped.has(h.id))
        .sort((a, b) => a.confidence - b.confidence || a.lastSeen.localeCompare(b.lastSeen)),
    [all, voted, skipped],
  );

  // Keep the hazard on screen stable while live updates reorder the queue.
  const pinnedValid = pinnedId && hazards.has(pinnedId) && !voted.has(pinnedId) && !skipped.has(pinnedId);
  const currentId = pinnedValid ? pinnedId : (queue[0]?.id ?? null);
  if (currentId !== pinnedId) {
    setPinnedId(currentId);
    setPanel(null);
  }
  const current = currentId ? hazards.get(currentId) : undefined;
  const { detail, error: detailError, loading: detailLoading } = useHazardDetail(currentId, detailVersion(currentId));
  // Nothing can be voted on until its photo and details are on screen.
  const ready = !!detail && detail.id === currentId;

  const skip = useCallback(() => {
    if (!currentId) return;
    setSkipped((s) => new Set(s).add(currentId));
    setMessage(null);
  }, [currentId]);

  const vote = useCallback(
    async (dir: "up" | "down") => {
      if (!currentId || busy || !ready) return;
      setBusy(true);
      setMessage(null);
      try {
        const res = await api.vote(currentId, dir);
        rememberVote(currentId);
        setVoted((s) => new Set(s).add(currentId));
        setMessage({
          tone: "info",
          text: `${dir === "up" ? "Upvoted: still there" : "Downvoted: gone or not a hazard"}. Confidence is now ${res.confidence.toFixed(1)}${res.status === "cleared" ? " and the hazard is cleared" : ""}.`,
        });
        announceAction();
      } catch (e) {
        if (e instanceof ApiError && e.code === "not_found") setSkipped((s) => new Set(s).add(currentId));
        setMessage({ tone: "warn", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    },
    [currentId, busy, ready],
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
    <div className="mx-auto w-full max-w-6xl p-3 lg:p-6">
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="eyebrow">Remote volunteers</p>
          <h1 className="font-display text-4xl font-bold uppercase leading-none tracking-wide text-white">Verify queue</h1>
          <p className="mt-1.5 text-sm text-muted">
            Least-confident hazards first. Is it still there?
            {shortcutsOn && (
              <>
                {" "}Shortcuts: <kbd className="kbd">U</kbd> upvote, <kbd className="kbd">D</kbd> downvote, <kbd className="kbd">S</kbd> skip
                (when no button or link is focused).
              </>
            )}
          </p>
        </div>
        <div className="glass flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
          {loaded && (
            <div className="min-w-40">
              <p className="text-sm font-semibold text-white">
                <span className="font-display text-2xl tabular-nums">{queue.length}</span> left to review
              </p>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-label="Hazards checked from this device"
                aria-valuemin={0}
                aria-valuemax={all.length}
                aria-valuenow={checked}
              >
                <div className="h-full rounded-full bg-signal" style={{ width: `${all.length ? (checked / all.length) * 100 : 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {checked} of {all.length} checked from this device
              </p>
            </div>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              checked={shortcutsOn}
              onChange={(e) => setShortcutsOn(e.target.checked)}
              className="h-4 w-4 accent-[#087ff5]"
            />
            Keyboard shortcuts
          </label>
          <ConnectionBadge connection={connection} />
        </div>
      </div>

      <div aria-live="polite" className="mb-4 empty:hidden">
        {message && <Notice tone={message.tone} title={message.text} />}
      </div>

      {!loaded && connection !== "down" && (
        <p role="status" className="text-muted">
          Loading hazards…
        </p>
      )}
      {!loaded && connection === "down" && (
        <Notice tone="warn" title="Can’t reach the StepSafe server">
          Tried <code className="break-all text-white">{API_URL}</code>. {error && `(${error}) `}Retrying every 5 seconds.
        </Notice>
      )}
      {loaded && all.length === 0 && (
        <Notice tone="info" title="Nothing to verify yet">
          No active hazards within 5 km of the Graham Center. New reports show up here automatically.
        </Notice>
      )}
      {loaded && all.length > 0 && !current && (
        <div className="glass p-6">
          <Notice tone="info" title={skippedLeft ? `You skipped the remaining ${skippedLeft}.` : "You’re all caught up."}>
            {skippedLeft ? (
              <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setSkipped(new Set())}>
                Review skipped hazards
              </button>
            ) : (
              <p>
                This device has voted on every active hazard. New reports appear here live.{" "}
                <Link href="/" className="font-semibold text-signal underline underline-offset-4">
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
          aria-labelledby="verify-heading"
          className="glass grid gap-4 p-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:grid-rows-[auto_auto_1fr] md:gap-x-6 md:p-6"
        >
          <div className="space-y-4 md:row-span-3">
            {detailLoading && <p role="status" className="text-muted">Loading photo and details…</p>}
            {detailError && <Notice tone="warn" title="Couldn’t load details">{detailError}</Notice>}
            {detail && detail.id === current.id && (
              <>
                <div id="verify-heading">
                  <HazardHeading hazard={detail} />
                </div>
                {detail.sample && (
                  <Notice tone="info" title="Sample hazard">
                    Seeded for the demo, not a real report. Votes still count for the demo.
                  </Notice>
                )}
                <Crop hazard={detail} className="max-h-96" />
              </>
            )}
          </div>

          <div className="space-y-3">
            <div className="h-56 overflow-hidden rounded-xl border border-edge md:h-64">
              <Map
                hazards={[current]}
                center={[current.lat, current.lng]}
                zoom={18}
                selectedId={current.id}
                compact
                label={`Location of the hazard under review`}
              />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-sm text-white">
              <div className="well px-3 py-2">
                <dt className="eyebrow">Confidence</dt>
                <dd className="font-display text-xl font-bold tabular-nums">{current.confidence.toFixed(1)}</dd>
              </div>
              <div className="well px-3 py-2">
                <dt className="eyebrow">Clearance</dt>
                <dd className="mt-0.5 font-medium">{ready && detail.measurements?.clearanceM != null ? formatLength(detail.measurements.clearanceM) : "—"}</dd>
              </div>
              <div className="well px-3 py-2">
                <dt className="eyebrow">Width left</dt>
                <dd className="mt-0.5 font-medium">{ready && detail.measurements?.widthM != null ? formatLength(detail.measurements.widthM) : "—"}</dd>
              </div>
            </dl>
            <Link
              href={`/hazard/${encodeURIComponent(current.id)}`}
              className="inline-block text-sm font-semibold text-signal underline underline-offset-4 hover:text-white"
            >
              Full details and vote history
            </Link>
          </div>

          {/* Direct child of the article so it can stick to the bottom of a phone screen. */}
          <div className="sticky bottom-0 z-[1100] -mx-4 grid grid-cols-3 gap-2 border-t border-edge bg-navy-2/95 p-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
            <button type="button" disabled={busy || !ready} aria-keyshortcuts={shortcutsOn ? "U" : undefined} onClick={() => vote("up")} className={`${voteButton} border-blue bg-blue text-navy hover:bg-[#3597f7]`}>
              <span>▲ Still there</span>
              <span className="text-xs font-medium">Upvote{shortcutsOn && <span className="hidden md:inline"> · U</span>}</span>
            </button>
            <button type="button" disabled={busy || !ready} aria-keyshortcuts={shortcutsOn ? "D" : undefined} onClick={() => vote("down")} className={`${voteButton} border-white/70 bg-well text-white hover:bg-white/10`}>
              <span>▼ Gone</span>
              <span className="text-xs font-medium text-muted">Not a hazard{shortcutsOn && <span className="hidden md:inline"> · D</span>}</span>
            </button>
            <button type="button" disabled={busy} aria-keyshortcuts={shortcutsOn ? "S" : undefined} onClick={skip} className={`${voteButton} border-edge bg-well text-white hover:bg-white/10`}>
              <span>Skip</span>
              <span className="text-xs font-medium text-muted">Decide later{shortcutsOn && <span className="hidden md:inline"> · S</span>}</span>
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

            {panel === "reclassify" && <ReclassifyForm key={current.id} hazardId={current.id} current={current} />}
            {panel === "report" && <ReportForm key={current.id} hazardId={current.id} />}
          </div>
        </article>
      )}
    </div>
  );
}

function ReclassifyForm({
  hazardId,
  current,
}: {
  hazardId: string;
  current: { type: string; category: Category; heightBand: HeightBand };
}) {
  const [type, setType] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [heightBand, setHeightBand] = useState<HeightBand | "">("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "warn"; text: string } | null>(null);

  // The server accepts types matching ^[a-z0-9 -]+$ (max 40), so normalize before sending.
  const normalizedType = type.trim().toLowerCase().replace(/\s+/g, " ");
  const typeInvalid = normalizedType !== "" && !TYPE_RE.test(normalizedType);
  const change = {
    ...(normalizedType && normalizedType !== current.type ? { type: normalizedType } : {}),
    ...(category && category !== current.category ? { category } : {}),
    ...(heightBand && heightBand !== current.heightBand ? { heightBand } : {}),
  };
  const empty = Object.keys(change).length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (empty || typeInvalid) return;
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
      setBusy(false);
    }
  };

  const field = "mt-1 block w-full rounded-xl border border-line bg-navy px-3 py-2 text-white";
  return (
    <form id="reclassify-panel" onSubmit={submit} className="well space-y-3 p-4">
      <fieldset className="space-y-3" disabled={busy}>
        <legend className="font-semibold text-white">Propose a correction (change only what’s wrong)</legend>
        <label className="block text-sm font-semibold text-white">
          Type <span className="font-normal text-muted">(now “{current.type}”)</span>
          <input
            list="type-options"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. scooter"
            maxLength={40}
            pattern="[A-Za-z0-9 \-]+"
            title="Letters, numbers, spaces and hyphens only"
            aria-describedby="type-hint"
            aria-invalid={typeInvalid || undefined}
            className={field}
          />
          <span id="type-hint" className={`mt-1 block font-normal ${typeInvalid ? "text-alert" : "text-muted"}`}>
            Letters, numbers, spaces and hyphens, up to 40 characters.
          </span>
          <datalist id="type-options">
            {COMMON_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm font-semibold text-white">
          Category <span className="font-normal text-muted">(now {CATEGORY_META[current.category].label.toLowerCase()})</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")} className={field}>
            <option value="">No change</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label} ({CATEGORY_META[c].lifespan})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold text-white">
          Height band <span className="font-normal text-muted">(now {HEIGHT_META[current.heightBand].label.toLowerCase()})</span>
          <select value={heightBand} onChange={(e) => setHeightBand(e.target.value as HeightBand | "")} className={field}>
            <option value="">No change</option>
            {HEIGHT_BANDS.map((b) => (
              <option key={b} value={b}>
                {HEIGHT_META[b].label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={empty || busy || typeInvalid} className={`${primaryButton}`}>
          {busy ? "Sending…" : "Submit correction"}
        </button>
      </fieldset>
      <div aria-live="polite">{result && <Notice tone={result.tone} title={result.text} />}</div>
    </form>
  );
}

function ReportForm({ hazardId }: { hazardId: string }) {
  const [reason, setReason] = useState<"spam" | "abuse" | "other">("spam");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "warn"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.report(hazardId, reason);
      setResult({ tone: "info", text: "Report sent. Thank you; moderators will review it." });
    } catch (err) {
      setResult({ tone: "warn", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="report-panel" onSubmit={submit} className="well space-y-3 p-4">
      <fieldset className="space-y-2" disabled={busy || result?.tone === "info"}>
        <legend className="font-semibold text-white">Report this hazard</legend>
        {(
          [
            ["spam", "Spam (fake or junk report)"],
            ["abuse", "Abuse (offensive or private image)"],
            ["other", "Other problem"],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex items-center gap-2 text-white">
            <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="h-5 w-5 accent-[#087ff5]" />
            {text}
          </label>
        ))}
        <button type="submit" className={`${primaryButton}`}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </fieldset>
      <div aria-live="polite">{result && <Notice tone={result.tone} title={result.text} />}</div>
    </form>
  );
}
