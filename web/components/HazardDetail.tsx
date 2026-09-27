"use client";

import { useEffect, useState } from "react";
import {
  CATEGORY_META,
  HEIGHT_META,
  RECLASSIFY_THRESHOLD,
  ApiError,
  api,
  cropSrc,
  formatLength,
  relativeTime,
  typeDisplayName,
  type HazardDetail as Detail,
  type HazardType,
} from "@/lib/api";
import { useNow } from "@/lib/hooks";
import { Notice, SampleBadge, TypeIcon } from "./ui";

const dateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function When({ iso, now }: { iso: string; now: number }) {
  return (
    <time dateTime={iso} title={dateTime(iso)}>
      {relativeTime(iso, now)}
    </time>
  );
}

export function useHazardDetail(id: string | null, version?: string) {
  const [state, setState] = useState<{ id: string | null; detail: Detail | null; error: string | null; missing?: boolean }>({
    id: null,
    detail: null,
    error: null,
  });
  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .hazard(id)
      .then((detail) => live && setState({ id, detail, error: null }))
      .catch((e: Error) => {
        if (!live) return;
        // A failed refresh should not blank a hazard we already showed.
        // `missing`: the server says the id does not exist, so retrying cannot help.
        const missing = e instanceof ApiError && e.code === "not_found";
        setState((prev) => ({ id, detail: prev.id === id ? prev.detail : null, error: e.message, missing }));
      });
    return () => {
      live = false;
    };
  }, [id, version]);
  const current = state.id === id ? state : { id, detail: null, error: null, missing: false };
  return { ...current, loading: !!id && !current.detail && !current.error };
}

export function HazardHeading({
  hazard,
  as: Tag = "h2",
  taxonomy,
}: {
  hazard: Detail;
  as?: "h1" | "h2";
  taxonomy?: readonly HazardType[] | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <TypeIcon type={hazard.type} category={hazard.category} size={44} />
      <div className="min-w-0">
        <Tag className="text-[18px] font-semibold leading-snug text-heading">
          {hazard.label || typeDisplayName(hazard.type, taxonomy)} {hazard.sample && <SampleBadge />}
        </Tag>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {CATEGORY_META[hazard.category].label} · {HEIGHT_META[hazard.heightBand].label} · type “{typeDisplayName(hazard.type, taxonomy)}”
          {hazard.status === "cleared" && <strong className="ml-1 font-semibold text-ink">· Cleared</strong>}
        </p>
      </div>
    </div>
  );
}

export function Crop({
  hazard,
  className = "",
  taxonomy,
}: {
  hazard: Detail;
  className?: string;
  taxonomy?: readonly HazardType[] | null;
}) {
  if (!hazard.crop)
    return (
      <div className={`flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-sunken text-[13px] text-ink-3 ${className}`}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3l18 18M9.5 5h5l1.5 2H19a2 2 0 0 1 2 2v8.5M17.5 19H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.5M9.9 10.2a3 3 0 0 0 4 4" />
        </svg>
        No photo was sent with this report
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- base64 data URL, nothing for next/image to optimize
    <img
      src={cropSrc(hazard.crop)}
      alt={`Camera crop of the reported ${hazard.label || typeDisplayName(hazard.type, taxonomy)}`}
      className={`w-full rounded-lg border border-line bg-sunken object-contain ${className}`}
    />
  );
}

export default function HazardDetail({
  hazard,
  taxonomy,
  hideHeading = false,
  now: nowFromParent,
}: {
  hazard: Detail;
  taxonomy?: readonly HazardType[] | null;
  hideHeading?: boolean;
  /** Parent clock. When set, this panel does not start a second interval. */
  now?: number;
}) {
  const ticking = useNow(15_000, nowFromParent === undefined);
  const now = nowFromParent ?? ticking;
  const m = hazard.measurements;
  // Under the page's h1 (the /hazard card) the sections are h2; under a hazard h2 they are h3.
  const Section = hideHeading ? "h2" : "h3";
  return (
    <div className="space-y-4 text-ink">
      {!hideHeading && <HazardHeading hazard={hazard} taxonomy={taxonomy} />}
      {hazard.sample && (
        <Notice tone="info" title="Sample hazard">
          Seeded for the demo. It was not reported by a real walker.
        </Notice>
      )}
      <Crop hazard={hazard} className="max-h-72" taxonomy={taxonomy} />

      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line text-[13px] [&>div:nth-child(odd)]:border-r [&>div]:border-line [&>div:nth-child(n+3)]:border-t">
        <div className="px-3 py-2">
          <dt className="label">Clearance height</dt>
          <dd className="mt-0.5 font-medium text-ink">{m?.clearanceM != null ? formatLength(m.clearanceM) : "Not measured"}</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="label">Remaining sidewalk width</dt>
          <dd className="mt-0.5 font-medium text-ink">{m?.widthM != null ? formatLength(m.widthM) : "Not measured"}</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="label">Confidence</dt>
          <dd className="mt-0.5 font-medium text-ink">{hazard.confidence.toFixed(1)} (cleared below −2)</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="label">Severity</dt>
          <dd className="mt-0.5 font-medium text-ink">{hazard.severity} of 3</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="label">Last seen</dt>
          <dd className="mt-0.5 font-medium text-ink">
            <When iso={hazard.lastSeen} now={now} />
          </dd>
        </div>
        <div className="px-3 py-2">
          <dt className="label">Expires</dt>
          <dd className="mt-0.5 font-medium text-ink">
            <When iso={hazard.expiresAt} now={now} /> <span className="font-normal text-ink-3">({CATEGORY_META[hazard.category].lifespan} without an upvote)</span>
          </dd>
        </div>
        <div className="px-3 py-2">
          <dt className="label">First reported</dt>
          <dd className="mt-0.5 font-medium text-ink">{dateTime(hazard.createdAt)}</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="label">Spoken in Spanish</dt>
          <dd lang="es" className="mt-0.5 font-medium text-ink">{hazard.spokenLabel_es || "—"}</dd>
        </div>
      </dl>

      <section aria-labelledby={`pending-${hazard.id}`}>
        <Section id={`pending-${hazard.id}`} className="mb-1.5 text-[13px] font-semibold text-heading">
          Pending reclassifications
        </Section>
        {hazard.pendingReclassifications.length === 0 ? (
          <p className="text-[13px] text-ink-3">None. A change applies when {RECLASSIFY_THRESHOLD} people propose it.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {hazard.pendingReclassifications.map((p, i) => (
              <li key={i}>
                Change to{" "}
                <strong className="font-semibold">
                  {[p.type && `type “${typeDisplayName(p.type, taxonomy)}”`, p.category && CATEGORY_META[p.category].label.toLowerCase(), p.heightBand && HEIGHT_META[p.heightBand].label.toLowerCase()]
                    .filter(Boolean)
                    .join(", ")}
                </strong>
                : {p.count} of {RECLASSIFY_THRESHOLD} agree
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`votes-${hazard.id}`}>
        <Section id={`votes-${hazard.id}`} className="mb-1.5 text-[13px] font-semibold text-heading">
          Vote history ({hazard.votes.length})
        </Section>
        {hazard.votes.length === 0 ? (
          <p className="text-[13px] text-ink-3">No votes yet.</p>
        ) : (
          <div className="scroll-quiet max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-sunken text-[12px] text-ink-2">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">When</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">Vote</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">From</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody>
                {[...hazard.votes].reverse().map((v, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-1.5 text-ink-2">
                      <When iso={v.at} now={now} />
                    </td>
                    <td className="px-3 py-1.5 font-medium">{v.vote === "up" ? "▲ Still there" : "▼ Gone"}</td>
                    <td className="px-3 py-1.5 capitalize">{v.source}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v.weight.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
