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

const voteButton =
  "flex flex-col items-center justify-center rounded-lg border-2 px-1 py-2 font-semibold leading-tight disabled:cursor-not-allowed disabled:opacity-50 md:px-4";

export default function VerifyPage() {
  const { hazards, connection, loaded, error } = useLiveHazards();
  const [voted, setVoted] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : getVotedIds()));
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

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
  const { detail, error: detailError, loading: detailLoading } = useHazardDetail(currentId);

  const skip = useCallback(() => {
    if (!currentId) return;
    setSkipped((s) => new Set(s).add(currentId));
    setMessage(null);
  }, [currentId]);

  const vote = useCallback(
    async (dir: "up" | "down") => {
      if (!currentId || busy) return;
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
    [currentId, busy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      const key = e.key.toLowerCase();
      if (key === "u") vote("up");
      else if (key === "d") vote("down");
      else if (key === "s") skip();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vote, skip]);

  const skippedLeft = all.filter((h) => skipped.has(h.id) && !voted.has(h.id)).length;

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Verify queue</h1>
          <p className="text-sm text-muted">
            Least-confident hazards first. Shortcuts: <kbd className="kbd">U</kbd> upvote, <kbd className="kbd">D</kbd> downvote,{" "}
            <kbd className="kbd">S</kbd> skip.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loaded && <span className="text-sm font-semibold text-white">{queue.length} left to review</span>}
          <ConnectionBadge connection={connection} />
        </div>
      </div>

      <div aria-live="polite" className="mb-4 empty:hidden">
        {message && <Notice tone={message.tone} title={message.text} />}
      </div>

      {!loaded && connection !== "down" && <p role="status">Loading hazards…</p>}
      {!loaded && connection === "down" && (
        <Notice tone="warn" title="Can’t reach the StepSafe server">
          Tried <code className="break-all">{API_URL}</code>. {error && `(${error}) `}Retrying every 5 seconds.
        </Notice>
      )}
      {loaded && all.length === 0 && (
        <Notice tone="info" title="Nothing to verify yet">
          No active hazards within 5 km of the Graham Center. New reports show up here automatically.
        </Notice>
      )}
      {loaded && all.length > 0 && !current && (
        <Notice tone="info" title={skippedLeft ? `You skipped the remaining ${skippedLeft}.` : "You’re all caught up."}>
          {skippedLeft ? (
            <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setSkipped(new Set())}>
              Review skipped hazards
            </button>
          ) : (
            <p>
              This device has voted on every active hazard. New reports appear here live. <Link href="/" className="font-semibold text-white underline underline-offset-4">Back to the map</Link>
            </p>
          )}
        </Notice>
      )}

      {current && (
        <article
          aria-labelledby="verify-heading"
          className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-[auto_auto_1fr] md:gap-x-6"
        >
          <div className="space-y-4 md:row-span-3">
            {detailLoading && <p role="status">Loading photo and details…</p>}
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
                <Crop hazard={detail} className="max-h-80" />
                {(detail.measurements?.clearanceM != null || detail.measurements?.widthM != null) && (
                  <dl className="grid grid-cols-2 gap-3 text-sm text-white">
                    {detail.measurements?.clearanceM != null && (
                      <div>
                        <dt className="font-semibold">Clearance</dt>
                        <dd>{formatLength(detail.measurements.clearanceM)}</dd>
                      </div>
                    )}
                    {detail.measurements?.widthM != null && (
                      <div>
                        <dt className="font-semibold">Remaining width</dt>
                        <dd>{formatLength(detail.measurements.widthM)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </>
            )}
          </div>

          <div className="space-y-4">
            <div className="h-56 overflow-hidden rounded-lg border-2 border-line md:h-64">
              <Map
                hazards={[current]}
                center={[current.lat, current.lng]}
                zoom={18}
                selectedId={current.id}
                compact
                label={`Location of the hazard under review`}
              />
            </div>
            <p className="text-sm text-muted">
              Confidence {current.confidence.toFixed(1)} ·{" "}
              <Link href={`/hazard/${encodeURIComponent(current.id)}`} className="font-semibold text-blue underline underline-offset-4">
                Full details and vote history
              </Link>
            </p>
          </div>

          {/* Direct child of the article so it can stick to the bottom of a phone screen. */}
          <div className="sticky bottom-0 z-[1100] -mx-4 grid grid-cols-3 gap-2 border-t-2 border-line bg-navy p-3 md:static md:mx-0 md:border-0 md:p-0">
              <button type="button" disabled={busy} aria-keyshortcuts="U" onClick={() => vote("up")} className={`${voteButton} border-blue bg-blue text-navy hover:bg-[#3597f7]`}>
                <span>▲ Still there</span>
                <span className="text-sm font-normal">Upvote<span className="hidden md:inline"> · U</span></span>
              </button>
              <button type="button" disabled={busy} aria-keyshortcuts="D" onClick={() => vote("down")} className={`${voteButton} border-white bg-navy-2 text-white hover:border-blue`}>
                <span>▼ Gone</span>
                <span className="text-sm font-normal">Not a hazard<span className="hidden md:inline"> · D</span></span>
              </button>
              <button type="button" disabled={busy} aria-keyshortcuts="S" onClick={skip} className={`${voteButton} border-line bg-navy-2 text-white hover:border-blue`}>
                <span>Skip</span>
                <span className="text-sm font-normal">Decide later<span className="hidden md:inline"> · S</span></span>
              </button>
          </div>

          <div className="space-y-4 md:col-start-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-expanded={panel === "reclassify"}
                aria-controls="reclassify-panel"
                onClick={() => setPanel(panel === "reclassify" ? null : "reclassify")}
                className={`${secondaryButton}`}
              >
                Reclassify…
              </button>
              <button
                type="button"
                aria-expanded={panel === "report"}
                aria-controls="report-panel"
                onClick={() => setPanel(panel === "report" ? null : "report")}
                className={`${secondaryButton}`}
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

  const change = {
    ...(type.trim() && type.trim() !== current.type ? { type: type.trim() } : {}),
    ...(category && category !== current.category ? { category } : {}),
    ...(heightBand && heightBand !== current.heightBand ? { heightBand } : {}),
  };
  const empty = Object.keys(change).length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (empty) return;
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

  const field = "mt-1 block w-full rounded-lg border-2 border-line bg-navy px-2 py-2 text-white";
  return (
    <form id="reclassify-panel" onSubmit={submit} className="space-y-3 rounded-lg border-2 border-line p-4">
      <fieldset className="space-y-3" disabled={busy}>
        <legend className="font-semibold text-white">Propose a correction (change only what’s wrong)</legend>
        <label className="block text-sm font-semibold text-white">
          Type <span className="font-normal text-muted">(now “{current.type}”)</span>
          <input list="type-options" value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. scooter" className={field} />
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
        <button type="submit" disabled={empty || busy} className={`${primaryButton}`}>
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
    <form id="report-panel" onSubmit={submit} className="space-y-3 rounded-lg border-2 border-line p-4">
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
