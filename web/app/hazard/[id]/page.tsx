"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { Notice } from "@/components/ui";
import { useLiveHazards } from "@/lib/hooks";

export default function HazardPage() {
  const { id } = useParams<{ id: string }>();
  const hazardId = decodeURIComponent(id);
  // Subscribed only so the detail re-fetches when this hazard changes on the server.
  const { detailVersion } = useLiveHazards();
  const { detail, error, loading } = useHazardDetail(hazardId, detailVersion(hazardId));

  return (
    <div className="mx-auto w-full max-w-6xl p-3 lg:p-6">
      <Link href="/" className="text-sm font-semibold text-signal underline underline-offset-4 hover:text-white">
        ← Back to the map
      </Link>
      <h1 className="sr-only">Hazard details</h1>
      <div className="mt-4">
        {loading && <p role="status" className="text-muted">Loading hazard details…</p>}
        {error && <Notice tone="warn" title="Couldn’t load this hazard">{error}</Notice>}
        {detail && (
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
            <div className="glass p-5">
              <HazardDetail hazard={detail} />
            </div>
            <div className="glass h-80 overflow-hidden md:sticky md:top-4">
              <Map
                hazards={[detail]}
                center={[detail.lat, detail.lng]}
                zoom={18}
                selectedId={detail.id}
                compact
                label={`Location of ${detail.label || detail.type}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
