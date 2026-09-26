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
  type HazardDetail as Detail,
} from "@/lib/api";
import { Notice, PinSwatch, SampleBadge } from "./ui";

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

export function HazardHeading({ hazard, as: Tag = "h2" }: { hazard: Detail; as?: "h1" | "h2" }) {
  return (
    <div className="flex items-start gap-3">
      <PinSwatch hazard={hazard} size={28} />
      <div>
        <Tag className="text-xl font-bold leading-tight text-white">
          {hazard.label || hazard.type} {hazard.sample && <SampleBadge />}
        </Tag>
        <p className="text-sm text-muted">
          {CATEGORY_META[hazard.category].label} · {HEIGHT_META[hazard.heightBand].label} · type “{hazard.type}”
          {hazard.status === "cleared" && <strong className="ml-1">· Cleared</strong>}
        </p>
      </div>
    </div>
  );
}

export function Crop({ hazard, className = "" }: { hazard: Detail; className?: string }) {
  if (!hazard.crop)
    return (
      <div className={`flex h-24 w-full items-center sm:aspect-[4/3] sm:h-auto justify-center rounded-lg border-2 border-dashed border-line bg-navy-2 text-sm text-muted ${className}`}>
        No photo was sent with this report
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- base64 data URL, nothing for next/image to optimize
    <img
      src={cropSrc(hazard.crop)}
      alt={`Camera crop of the reported ${hazard.label || hazard.type}`}
      className={`w-full rounded-lg border-2 border-line bg-navy-2 object-contain ${className}`}
    />
  );
}

export default function HazardDetail({ hazard }: { hazard: Detail }) {
  const m = hazard.measurements;
  return (
    <div className="space-y-5 text-white">
      <HazardHeading hazard={hazard} />
      {hazard.sample && (
        <Notice tone="info" title="Sample hazard">
          Seeded for the demo. It was not reported by a real walker.
        </Notice>
      )}
      <Crop hazard={hazard} className="max-h-72" />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="font-semibold">Clearance height</dt>
          <dd>{m?.clearanceM != null ? formatLength(m.clearanceM) : "Not measured"}</dd>
        </div>
        <div>
          <dt className="font-semibold">Remaining sidewalk width</dt>
          <dd>{m?.widthM != null ? formatLength(m.widthM) : "Not measured"}</dd>
        </div>
        <div>
          <dt className="font-semibold">Confidence</dt>
          <dd>{hazard.confidence.toFixed(1)} (cleared below −2)</dd>
        </div>
        <div>
          <dt className="font-semibold">Severity</dt>
          <dd>{hazard.severity} of 3</dd>
        </div>
        <div>
          <dt className="font-semibold">Last seen</dt>
          <dd>
            <When iso={hazard.lastSeen} />
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Expires</dt>
          <dd>
            <When iso={hazard.expiresAt} /> <span className="text-muted">({CATEGORY_META[hazard.category].lifespan} without an upvote)</span>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">First reported</dt>
          <dd>{dateTime(hazard.createdAt)}</dd>
        </div>
        <div>
          <dt className="font-semibold">Spoken in Spanish</dt>
          <dd lang="es">{hazard.spokenLabel_es || "—"}</dd>
        </div>
      </dl>

      <section aria-labelledby={`pending-${hazard.id}`}>
        <h3 id={`pending-${hazard.id}`} className="mb-1 font-semibold">
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
                  {[p.type && `type “${p.type}”`, p.category && CATEGORY_META[p.category].label.toLowerCase(), p.heightBand && HEIGHT_META[p.heightBand].label.toLowerCase()]
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
        <h3 id={`votes-${hazard.id}`} className="mb-1 font-semibold">
          Vote history ({hazard.votes.length})
        </h3>
        {hazard.votes.length === 0 ? (
          <p className="text-sm text-muted">No votes yet.</p>
        ) : (
          <div className="max-h-64 overflow-auto rounded border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-navy-2">
                <tr>
                  <th scope="col" className="px-2 py-1">When</th>
                  <th scope="col" className="px-2 py-1">Vote</th>
                  <th scope="col" className="px-2 py-1">From</th>
                  <th scope="col" className="px-2 py-1 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {[...hazard.votes].reverse().map((v, i) => (
                  <tr key={i} className="border-t border-line">
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
