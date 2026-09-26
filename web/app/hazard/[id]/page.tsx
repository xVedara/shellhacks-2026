"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import HazardDetail, { useHazardDetail } from "@/components/HazardDetail";
import Map from "@/components/Map";
import { Notice } from "@/components/ui";

export default function HazardPage() {
  const { id } = useParams<{ id: string }>();
  const { detail, error, loading } = useHazardDetail(decodeURIComponent(id));

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <Link href="/" className="font-semibold text-blue underline underline-offset-4">
        ← Back to the map
      </Link>
      <h1 className="sr-only">Hazard details</h1>
      <div className="mt-4">
        {loading && <p role="status">Loading hazard details…</p>}
        {error && <Notice tone="warn" title="Couldn’t load this hazard">{error}</Notice>}
        {detail && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
            <HazardDetail hazard={detail} />
            <div className="h-72 overflow-hidden rounded-lg border-2 border-line md:sticky md:top-4">
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
