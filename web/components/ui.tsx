"use client";

import { CATEGORIES, CATEGORY_META, HEIGHT_BANDS, HEIGHT_META, type HazardSummary } from "@/lib/api";
import type { Connection } from "@/lib/hooks";
import { markerSvg } from "@/lib/marker";

export function SampleBadge() {
  return (
    <span
      className="inline-block rounded-full border border-dashed border-white/80 px-2 py-px align-middle font-sans text-[10px] font-bold uppercase leading-normal tracking-wider text-white"
      title="Demo seed data, not a real report"
    >
      Sample
    </span>
  );
}

export function PinSwatch({ hazard, size = 24 }: { hazard: Pick<HazardSummary, "category" | "heightBand">; size?: number }) {
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: markerSvg(hazard, size) }} />;
}

/** Pin inside a softly tinted tile of its category color (list rows, headings). */
export function PinTile({ hazard, size = 40 }: { hazard: Pick<HazardSummary, "category" | "heightBand">; size?: number }) {
  const color = CATEGORY_META[hazard.category].color;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      <PinSwatch hazard={hazard} size={Math.round(size * 0.62)} />
    </span>
  );
}

const CONNECTION_META: Record<Connection, { text: string; dot: string }> = {
  loading: { text: "Connecting…", dot: "bg-muted" },
  live: { text: "Live", dot: "bg-signal" },
  reconnecting: { text: "Reconnecting…", dot: "bg-alert" },
  down: { text: "Server unreachable", dot: "bg-alert" },
};

export function LiveDot({ connection }: { connection: Connection }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      {connection === "live" && <span className="absolute inset-0 rounded-full bg-signal opacity-60 motion-safe:animate-ping" />}
      <span className={`relative h-2.5 w-2.5 rounded-full ${CONNECTION_META[connection].dot}`} />
    </span>
  );
}

export function ConnectionBadge({ connection }: { connection: Connection }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 rounded-full border border-edge bg-well px-3 py-1 text-sm font-semibold text-white">
      <LiveDot connection={connection} />
      {CONNECTION_META[connection].text}
    </span>
  );
}

export function Legend() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-[13px] text-white">
      <div>
        <h3 className="eyebrow mb-2">Color + letter = category</h3>
        <ul className="space-y-1.5">
          {CATEGORIES.map((c) => (
            <li key={c} className="flex items-center gap-2">
              <PinSwatch hazard={{ category: c, heightBand: "ground" }} size={20} />
              {CATEGORY_META[c].label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="eyebrow mb-2">Shape = height</h3>
        <ul className="space-y-1.5">
          {HEIGHT_BANDS.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <PinSwatch hazard={{ category: "temporary", heightBand: b }} size={20} />
              {HEIGHT_META[b].label}
            </li>
          ))}
        </ul>
      </div>
      <p className="col-span-2 mt-2 text-xs text-muted">Bigger pin = higher community confidence.</p>
    </div>
  );
}

/** "warn" is for problems (brand orange = warnings); "info" is neutral. */
export function Notice({ tone, title, children }: { tone: "warn" | "info"; title: string; children?: React.ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm text-white ${
        tone === "warn" ? "border-alert/60 bg-[rgb(255_121_0/0.10)]" : "border-edge bg-well"
      }`}
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
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
/** Primary control: brand blue with navy text (4.7:1). */
export const primaryButton = `${base} bg-blue text-navy hover:bg-[#3597f7]`;
/** Secondary control: quiet glass, border at 3:1+ so the control edge is visible. */
export const secondaryButton = `${base} border border-control bg-well text-white hover:border-signal/60 hover:bg-white/10`;
export const linkClass = "font-semibold text-signal underline underline-offset-4 hover:text-white";
