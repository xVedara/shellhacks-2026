"use client";

import dynamic from "next/dynamic";

// Client-only: Leaflet needs `window`.
const Map = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-navy-2 text-muted" role="status">
      Loading map…
    </div>
  ),
});

export default Map;
