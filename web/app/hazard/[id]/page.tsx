"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { Notice, TypeIcon, primaryButton } from "@/components/ui";
import { CATEGORY_META, HEIGHT_META, relativeTime, typeDisplayName, type HazardDetail as Detail } from "@/lib/api";
import { milesFromGraham } from "@/lib/geo";
import { useHazardRevision, useNow, useTaxonomy } from "@/lib/hooks";

export default function HazardPage() {
  const { id } = useParams<{ id: string }>();
  const hazardId = decodeURIComponent(id);
  const revision = useHazardRevision(hazardId);
  const { detail, error, loading } = useHazardDetail(hazardId, String(revision));
  const { taxonomy } = useTaxonomy();
  const panelRef = useRef<HTMLElement>(null);
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const read = () => {
      const desktop = matchMedia("(min-width: 768px)").matches;
      setSheet(desktop ? 0 : el.getBoundingClientRect().height);
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const mq = matchMedia("(min-width: 768px)");
    mq.addEventListener("change", read);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", read);
    };
  }, [detail]);

  const name = detail ? detail.label || typeDisplayName(detail.type, taxonomy) : "Hazard";
  const miles = detail ? milesFromGraham(detail.lat, detail.lng) : "";

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="map-stage relative min-h-0 min-w-0 flex-1" style={{ ["--sheet" as string]: `${sheet}px` }}>
        {detail ? (
          <Map
            hazards={[detail]}
            center={[detail.lat, detail.lng]}
            zoom={18}
            selectedId={detail.id}
            label={`Location of ${name}`}
            sheet={sheet}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-3" role="status">
            {loading ? "Loading map…" : "Map unavailable"}
          </div>
        )}
      </div>
      <aside ref={panelRef} className="sheet-panel instrument-card" aria-label="Hazard status">
        <div className="sheet-face scroll-quiet min-h-0 flex-1 overflow-y-auto pb-2">
          <Link href={`/?selected=${encodeURIComponent(hazardId)}`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-accent">
            Live map
          </Link>
          {loading && (
            <p role="status" className="text-ink-3">
              Loading hazard details…
            </p>
          )}
          {error && <Notice tone="warn" title="Couldn’t load this hazard">{error}</Notice>}
          {detail && <HazardRecord detail={detail} taxonomy={taxonomy} name={name} miles={miles} />}
        </div>
      </aside>
    </div>
  );
}

function HazardRecord({
  detail,
  taxonomy,
  name,
  miles,
}: {
  detail: Detail;
  taxonomy: ReturnType<typeof useTaxonomy>["taxonomy"];
  name: string;
  miles: string;
}) {
  const now = useNow(15_000);
  const updated = relativeTime(detail.lastSeen, now).replace(" ago", "");
  return (
    <>
      <p className="mt-1 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
        <span className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
        {detail.status === "cleared" ? "Cleared" : "Hazard"}
      </p>
      <div className="mt-2 flex items-start gap-3">
        <TypeIcon type={detail.type} category={detail.category} size={48} selected />
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-6 tracking-[-0.03em] text-heading">{name}</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            {CATEGORY_META[detail.category].label} · {HEIGHT_META[detail.heightBand].label}
          </p>
          <p className="text-[13px] text-ink-3">FIU Graham Center · {miles}</p>
        </div>
      </div>
      <dl className="mt-3.5 grid grid-cols-3 overflow-hidden rounded-xl bg-raised shadow-[var(--elev-hairline)]">
        <div className="px-3 py-2.5">
          <dt className="text-[11px] text-ink-3">Confidence</dt>
          <dd className="mt-1 text-[18px] font-semibold tabular-nums tracking-[-0.03em]">{detail.confidence.toFixed(1)}</dd>
        </div>
        <div className="border-l border-line px-3 py-2.5">
          <dt className="text-[11px] text-ink-3">Updated</dt>
          <dd className="mt-1 text-[18px] font-semibold tracking-[-0.03em]">
            <time dateTime={detail.lastSeen}>{updated}</time>
          </dd>
        </div>
        <div className="border-l border-line px-3 py-2.5">
          <dt className="text-[11px] text-ink-3">Distance</dt>
          <dd className="mt-1 text-[18px] font-semibold tabular-nums tracking-[-0.03em]">{miles}</dd>
        </div>
      </dl>
      <p className="mt-2.5 text-[13px] text-ink-3">
        {detail.sample ? "Sample hazard, seeded for the demo." : "Reported by a StepSafe walker."}
      </p>
      <Link href="/verify" className={`${primaryButton} mt-3 w-full`}>
        Verify
      </Link>
      <details className="mt-4 border-t border-line pt-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-medium">History and measurements</summary>
        <div className="pb-2 pt-2">
          <HazardDetail hazard={detail} taxonomy={taxonomy} hideHeading now={now} />
        </div>
      </details>
    </>
  );
}
