"use client";

import { CATEGORIES, CATEGORY_META, HEIGHT_BANDS, HEIGHT_META, type HazardSummary } from "@/lib/api";
import type { Connection } from "@/lib/hooks";
import { markerSvg } from "@/lib/marker";

/** Top bar of every page: the page title on the left, page-level status or actions on the right. */
export function PageBar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-13 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-page px-4 py-2.5 lg:px-6">
      <h1 className="text-[20px] font-semibold leading-tight text-heading">{title}</h1>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Panel header: title (+ optional count), one line of explanation, optional action on the right. */
export function PanelHead({
  title,
  id,
  count,
  sub,
  action,
  headingRef,
}: {
  title: React.ReactNode;
  id?: string;
  count?: number | null;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 id={id} ref={headingRef} tabIndex={id ? -1 : undefined} className="flex items-center gap-2 text-[15px] font-semibold leading-snug text-heading">
          {title}
          {count != null && <span className="rounded-full bg-sunken px-1.5 text-[12px] font-medium tabular-nums text-ink-2">{count}</span>}
        </h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SampleBadge() {
  return (
    <span
      className="inline-block rounded border border-dashed border-ink-2 px-1.5 align-middle text-[11px] font-medium leading-[18px] text-ink-2"
      title="Demo seed data, not a real report"
    >
      Sample
    </span>
  );
}

export function PinSwatch({ hazard, size = 24 }: { hazard: Pick<HazardSummary, "category" | "heightBand">; size?: number }) {
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: markerSvg(hazard, size) }} />;
}

/** Pin in a small recessed square (list rows, headings). */
export function PinTile({ hazard, size = 36 }: { hazard: Pick<HazardSummary, "category" | "heightBand">; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-md border border-line bg-sunken" style={{ width: size, height: size }}>
      <PinSwatch hazard={hazard} size={Math.round(size * 0.64)} />
    </span>
  );
}

const CONNECTION_META: Record<Connection, { text: string; dot: string }> = {
  loading: { text: "Connecting…", dot: "bg-ink-3" },
  live: { text: "Live", dot: "bg-ok" },
  reconnecting: { text: "Reconnecting…", dot: "bg-alert" },
  down: { text: "Server unreachable", dot: "bg-alert" },
};

export function LiveDot({ connection }: { connection: Connection }) {
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden="true">
      {connection === "live" && <span className="absolute inset-0 rounded-full bg-ok opacity-60 motion-safe:animate-ping" />}
      <span className={`relative h-2 w-2 rounded-full ${CONNECTION_META[connection].dot}`} />
    </span>
  );
}

export function ConnectionBadge({ connection }: { connection: Connection }) {
  return (
    <span role="status" className="inline-flex h-7 items-center gap-2 rounded-md border border-line bg-card px-2.5 text-[13px] font-medium text-ink">
      <LiveDot connection={connection} />
      {CONNECTION_META[connection].text}
    </span>
  );
}

export function Legend() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] text-ink">
      <div>
        <h3 className="label mb-1.5">Color + letter = category</h3>
        <ul className="space-y-1">
          {CATEGORIES.map((c) => (
            <li key={c} className="flex items-center gap-2">
              <PinSwatch hazard={{ category: c, heightBand: "ground" }} size={18} />
              {CATEGORY_META[c].label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="label mb-1.5">Shape = height</h3>
        <ul className="space-y-1">
          {HEIGHT_BANDS.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <PinSwatch hazard={{ category: "temporary", heightBand: b }} size={18} />
              {HEIGHT_META[b].label}
            </li>
          ))}
        </ul>
      </div>
      <p className="col-span-2 mt-1.5 text-[12px] text-ink-3">Bigger pin = higher community confidence.</p>
    </div>
  );
}

/** "warn" is for problems (brand orange = warnings); "info" is neutral. */
export function Notice({ tone, title, children }: { tone: "warn" | "info"; title: string; children?: React.ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] ${
        tone === "warn" ? "border-alert/70 bg-warn-tint" : "border-line bg-sunken"
      }`}
    >
      <svg
        className={`mt-px shrink-0 ${tone === "warn" ? "text-alert" : "text-ink-3"}`}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {tone === "warn" ? <path d="M12 3.5 2.8 19.5h18.4L12 3.5Zm0 6v4.5m0 2.6v.1" /> : <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5m0-8.2v.1" />}
      </svg>
      <div className="min-w-0">
        <p className={`font-medium ${tone === "warn" ? "text-warn-ink" : "text-ink"}`}>{title}</p>
        {children && <div className="mt-0.5 text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

const base =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
/** Primary control: navy fill in light, near-white in dark (16:1 either way). */
export const primaryButton = `${base} bg-primary text-primary-ink hover:opacity-90`;
/** Secondary control: surface with a hairline; the visible label identifies it. */
export const secondaryButton = `${base} border border-line bg-card text-ink hover:bg-hover`;
export const linkClass = "font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent";
