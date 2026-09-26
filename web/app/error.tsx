"use client";

import { primaryButton } from "@/components/ui";

// Shown instead of a blank page when a page throws while rendering.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="panel mx-auto mt-8 w-[calc(100%-2rem)] max-w-xl p-6">
      <h1 className="text-[20px] font-semibold text-heading">Something went wrong on this page</h1>
      <p className="mt-2 text-ink-2">
        The map hit an unexpected error: <span className="break-words text-ink">{error.message || "unknown error"}</span>
      </p>
      <button type="button" onClick={reset} className={`${primaryButton} mt-4`}>
        Try again
      </button>
    </div>
  );
}
