"use client";

import { CATEGORIES, CATEGORY_META, HEIGHT_BANDS, HEIGHT_META, type Category, type HeightBand } from "@/lib/api";
import { heightIconSrc, pinPad, typeIconSrc } from "@/lib/marker";
import type { Connection } from "@/lib/hooks";

export function PageBar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="top-bar flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-page px-4 py-2 md:px-6">
      <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.03em] text-heading">{title}</h1>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
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

/** Locked-sheet type glyph with the category edge and M/T/P mark. */
export function TypeIcon({
  type,
  category,
  size = 40,
  selected = false,
}: {
  type: string;
  category: Category;
  size?: number;
  selected?: boolean;
}) {
  const meta = CATEGORY_META[category];
  const pad = pinPad(selected);
  return (
    <span
      className="ss-pin-frame"
      style={{
        padding: pad,
        ["--pin-cat" as string]: meta.color,
        ["--pin-ink" as string]: meta.ink,
      }}
    >
      <span
        className={`ss-pin block ${selected ? "ss-pin--selected" : ""}`}
        style={{ width: size, height: size, ["--pin-cat" as string]: meta.color, ["--pin-ink" as string]: meta.ink }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static crop, sized exactly */}
        <img className="ss-pin__glyph" src={typeIconSrc(type)} alt="" width={size} height={size} draggable={false} />
        <span className="ss-pin__mark">{meta.letter}</span>
      </span>
    </span>
  );
}

export function HeightIcon({ band, size = 28 }: { band: HeightBand; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={heightIconSrc(band)} alt="" width={size} height={size} className="shrink-0 rounded-[18%]" draggable={false} />
  );
}

const CONNECTION_META: Record<Connection, { text: string; dot: string }> = {
  loading: { text: "Connecting…", dot: "bg-ink-3" },
  live: { text: "Live", dot: "bg-ok" },
  reconnecting: { text: "Reconnecting…", dot: "bg-ink-2" },
  down: { text: "Offline", dot: "bg-ink-2" },
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
    <span role="status" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-card px-3 text-[13px] font-medium text-ink">
      <LiveDot connection={connection} />
      {CONNECTION_META[connection].text}
    </span>
  );
}

export function Legend({
  osm,
  onOsm,
}: {
  osm?: boolean;
  onOsm?: (next: boolean) => void;
}) {
  return (
    <div className="text-[14px] text-ink">
      <h3 className="mb-2 text-[13px] font-semibold tracking-[-0.011em]">Legend</h3>
      <ul className="space-y-1">
        {HEIGHT_BANDS.map((b) => (
          <li key={b} className="flex min-h-9 items-center gap-2.5">
            <HeightIcon band={b} />
            <span>{HEIGHT_META[b].label}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-1">
        {CATEGORIES.map((c) => (
          <li key={c} className="flex min-h-9 items-center gap-2.5">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#081624] text-[12px] font-bold"
              style={{ background: CATEGORY_META[c].color, color: CATEGORY_META[c].ink }}
            >
              {CATEGORY_META[c].letter}
            </span>
            <span>{CATEGORY_META[c].label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] leading-4 text-ink-3">Larger mark means higher confidence. A blue ring marks the one you selected.</p>
      {onOsm && (
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={!!osm} onChange={(e) => onOsm(e.target.checked)} className="h-4 w-4 accent-[var(--blue)]" />
          OpenStreetMap layer
        </label>
      )}
    </div>
  );
}

export function Notice({ tone, title, children }: { tone: "warn" | "info"; title: string; children?: React.ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] ${tone === "warn" ? "border-[var(--border-strong)] bg-warn-tint" : "border-line bg-raised"}`}
    >
      <svg
        className={`mt-px shrink-0 ${tone === "warn" ? "text-ink" : "text-ink-3"}`}
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
        <p className={`${tone === "warn" ? "font-semibold text-warn-ink" : "font-medium text-ink"}`}>{title}</p>
        {children && <div className="mt-0.5 text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] tracking-[-0.02em] transition-[opacity,background-color,box-shadow] duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButton = `${base} bg-primary font-semibold text-primary-ink shadow-[var(--elev-hairline)] hover:bg-[var(--primary-hover)]`;
export const secondaryButton = `${base} border border-[var(--border-strong)] bg-transparent font-medium text-ink hover:bg-hover`;
export const linkClass = "font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent";

export { DESKTOP_MIN_WIDTH, DESKTOP_QUERY } from "@/lib/desktop";
