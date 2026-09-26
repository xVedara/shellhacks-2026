"use client";

import { useEffect, useState } from "react";
import {
  CATEGORY_META,
  HEIGHT_META,
  RECLASSIFY_THRESHOLD,
  api,
  cropSrc,
  formatLength,
  relativeTime,
  typeDisplayName,
  type HazardDetail as Detail,
  type HazardType,
} from "@/lib/api";
import { Notice, PinTile, SampleBadge } from "./ui";

const dateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={dateTime(iso)}>
      {relativeTime(iso)}
    </time>
  );
}

export function useHazardDetail(id: string | null, version?: string) {
  const [state, setState] = useState<{ id: string | null; detail: Detail | null; error: string | null }>({
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
      .catch((e: Error) => live && setState({ id, detail: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [id, version]);
  const current = state.id === id ? state : { id, detail: null, error: null };
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
      <PinTile hazard={hazard} size={48} />
      <div className="min-w-0">
        <Tag className="font-display text-[1.7rem] font-bold uppercase leading-[1.05] tracking-wide text-white">
          {hazard.label || typeDisplayName(hazard.type, taxonomy)} {hazard.sample && <SampleBadge />}
        </Tag>
        <p className="mt-1 text-sm text-muted">
          {CATEGORY_META[hazard.category].label} · {HEIGHT_META[hazard.heightBand].label} · type “{typeDisplayName(hazard.type, taxonomy)}”
          {hazard.status === "cleared" && <strong className="ml-1 text-white">· Cleared</strong>}
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
      <div className={`flex h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge bg-well text-sm text-muted ${className}`}>
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
      className={`w-full rounded-xl border border-edge bg-black/30 object-contain ${className}`}
    />
  );
}

export default function HazardDetail({ hazard, taxonomy }: { hazard: Detail; taxonomy?: readonly HazardType[] | null }) {
  const m = hazard.measurements;
  return (
    <div className="space-y-4 text-white">
      <HazardHeading hazard={hazard} taxonomy={taxonomy} />
      {hazard.sample && (
        <Notice tone="info" title="Sample hazard">
          Seeded for the demo. It was not reported by a real walker.
        </Notice>
      )}
      <Crop hazard={hazard} className="max-h-72" taxonomy={taxonomy} />

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="well px-3 py-2">
          <dt className="eyebrow">Clearance height</dt>
          <dd className="mt-0.5 font-medium">{m?.clearanceM != null ? formatLength(m.clearanceM) : "Not measured"}</dd>
        </div>
        <div className="well px-3 py-2">
          <dt className="eyebrow">Remaining sidewalk width</dt>
          <dd className="mt-0.5 font-medium">{m?.widthM != null ? formatLength(m.widthM) : "Not measured"}</dd>
        </div>
        <div className="well px-3 py-2">
          <dt className="eyebrow">Confidence</dt>
          <dd className="mt-0.5 font-medium">{hazard.confidence.toFixed(1)} (cleared below −2)</dd>
        </div>
        <div className="well px-3 py-2">
          <dt className="eyebrow">Severity</dt>
          <dd className="mt-0.5 font-medium">{hazard.severity} of 3</dd>
        </div>
        <div className="well px-3 py-2">
          <dt className="eyebrow">Last seen</dt>
          <dd className="mt-0.5 font-medium">
            <When iso={hazard.lastSeen} />
          </dd>
        </div>
        <div className="well px-3 py-2">
          <dt className="eyebrow">Expires</dt>
          <dd className="mt-0.5 font-medium">
            <When iso={hazard.expiresAt} /> <span className="text-muted">({CATEGORY_META[hazard.category].lifespan} without an upvote)</span>
          </dd>
        </div>
        <div className="well px-3 py-2">
          <dt className="eyebrow">First reported</dt>
          <dd className="mt-0.5 font-medium">{dateTime(hazard.createdAt)}</dd>
        </div>
        <div className="well px-3 py-2">
          <dt className="eyebrow">Spoken in Spanish</dt>
          <dd lang="es" className="mt-0.5 font-medium">{hazard.spokenLabel_es || "—"}</dd>
        </div>
      </dl>

      <section aria-labelledby={`pending-${hazard.id}`}>
        <h3 id={`pending-${hazard.id}`} className="eyebrow mb-1.5">
          Pending reclassifications
        </h3>
        {hazard.pendingReclassifications.length === 0 ? (
          <p className="text-sm text-muted">None. A change applies when {RECLASSIFY_THRESHOLD} people propose it.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {hazard.pendingReclassifications.map((p, i) => (
              <li key={i}>
                Change to{" "}
                <strong>
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
        <h3 id={`votes-${hazard.id}`} className="eyebrow mb-1.5">
          Vote history ({hazard.votes.length})
        </h3>
        {hazard.votes.length === 0 ? (
          <p className="text-sm text-muted">No votes yet.</p>
        ) : (
          <div className="scroll-quiet max-h-64 overflow-auto rounded-xl border border-edge">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-navy-2 text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-2 py-1">When</th>
                  <th scope="col" className="px-2 py-1">Vote</th>
                  <th scope="col" className="px-2 py-1">From</th>
                  <th scope="col" className="px-2 py-1 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {[...hazard.votes].reverse().map((v, i) => (
                  <tr key={i} className="border-t border-edge">
                    <td className="px-2 py-1">
                      <When iso={v.at} />
                    </td>
                    <td className="px-2 py-1 font-semibold">{v.vote === "up" ? "▲ Still there" : "▼ Gone"}</td>
                    <td className="px-2 py-1 capitalize">{v.source}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{v.weight.toFixed(2)}</td>
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
