"use client";

import { CATEGORIES, CATEGORY_META, HEIGHT_BANDS, HEIGHT_META, type HazardSummary } from "@/lib/api";
import type { Connection } from "@/lib/hooks";
import { markerSvg } from "@/lib/marker";

export function SampleBadge() {
  return (
    <span
      className="inline-block rounded border border-dashed border-white px-1.5 py-px align-middle text-xs font-bold uppercase tracking-wide text-white"
      title="Demo seed data, not a real report"
    >
      Sample
    </span>
  );
}

export function PinSwatch({ hazard, size = 24 }: { hazard: Pick<HazardSummary, "category" | "heightBand">; size?: number }) {
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: markerSvg(hazard, size) }} />;
}

export function ConnectionBadge({ connection }: { connection: Connection }) {
  const meta = {
    loading: { text: "Connecting…", dot: "bg-muted" },
    live: { text: "Live", dot: "bg-signal" },
    reconnecting: { text: "Reconnecting…", dot: "bg-alert" },
    down: { text: "Server unreachable", dot: "bg-alert" },
  }[connection];
  return (
    <span role="status" className="inline-flex items-center gap-2 rounded-full border border-line bg-navy-2 px-3 py-1 text-sm font-semibold text-white">
      <span className={`h-2.5 w-2.5 rounded-full ${meta.dot} ${connection === "live" ? "motion-safe:animate-pulse" : ""}`} aria-hidden="true" />
      {meta.text}
    </span>
  );
}

export function Legend() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-white">
      <div>
        <h3 className="mb-1.5 font-semibold">Color and letter = category</h3>
        <ul className="space-y-1.5">
          {CATEGORIES.map((c) => (
            <li key={c} className="flex items-center gap-2">
              <PinSwatch hazard={{ category: c, heightBand: "ground" }} size={22} />
              {CATEGORY_META[c].label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1.5 font-semibold">Shape = height</h3>
        <ul className="space-y-1.5">
          {HEIGHT_BANDS.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <PinSwatch hazard={{ category: "temporary", heightBand: b }} size={22} />
              {HEIGHT_META[b].label}
            </li>
          ))}
        </ul>
      </div>
      <p className="col-span-2 mt-1 text-muted">Bigger pin = higher community confidence.</p>
    </div>
  );
}

/** "warn" is for problems (brand orange = warnings); "info" is neutral. */
export function Notice({ tone, title, children }: { tone: "warn" | "info"; title: string; children?: React.ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`rounded-lg border-2 bg-navy-2 p-3 text-sm text-white ${tone === "warn" ? "border-alert" : "border-line"}`}
    >
      <p className="font-semibold">
        {tone === "warn" && (
          <span className="mr-1.5 text-alert" aria-hidden="true">
            ▲
          </span>
        )}
        {title}
      </p>
      {children && <div className="mt-1 text-muted">{children}</div>}
    </div>
  );
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50";
/** Primary control: brand blue with navy text (4.7:1). */
export const primaryButton = `${base} bg-blue text-navy hover:bg-[#3597f7]`;
/** Secondary control: outlined on navy. */
export const secondaryButton = `${base} border-2 border-line bg-navy-2 text-white hover:border-blue`;
export const linkClass = "font-semibold text-blue underline underline-offset-4 hover:text-[#3597f7]";
