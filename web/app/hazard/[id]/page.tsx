"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { Notice, PageBar, linkClass } from "@/components/ui";
import { typeDisplayName } from "@/lib/api";
import { useLiveHazards, useTaxonomy } from "@/lib/hooks";

export default function HazardPage() {
  const { id } = useParams<{ id: string }>();
  const hazardId = decodeURIComponent(id);
  // Subscribed only so the detail re-fetches when this hazard changes on the server.
  const { detailVersion } = useLiveHazards();
  const { detail, error, loading } = useHazardDetail(hazardId, detailVersion(hazardId));
  const { taxonomy } = useTaxonomy();

  return (
    <>
      <PageBar title="Hazard details">
        <Link href="/" className={`${linkClass} text-[13px]`}>
          ← Back to the map
        </Link>
      </PageBar>
      <div className="w-full max-w-[1200px] p-4 lg:px-6 lg:py-5">
        {loading && <p role="status" className="text-ink-3">Loading hazard details…</p>}
        {error && <Notice tone="warn" title="Couldn’t load this hazard">{error}</Notice>}
        {detail && (
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
            <div className="panel p-5">
              <HazardDetail hazard={detail} taxonomy={taxonomy} />
            </div>
            <div className="panel h-80 overflow-hidden md:sticky md:top-4">
              <Map
                hazards={[detail]}
                center={[detail.lat, detail.lng]}
                zoom={18}
                selectedId={detail.id}
                compact
                label={`Location of ${detail.label || typeDisplayName(detail.type, taxonomy)}`}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
