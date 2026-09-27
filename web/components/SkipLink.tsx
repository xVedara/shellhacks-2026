"use client";

import type { ReactNode } from "react";

/**
 * A skip link that moves focus itself. Safari and VoiceOver do not reliably focus a fragment target, so the
 * target (tabIndex -1) is focused in script. `onActivate` runs first, e.g. to open a collapsed sheet.
 */
export default function SkipLink({ target, onActivate, children }: { target: string; onActivate?: () => void; children: ReactNode }) {
  return (
    <a
      href={`#${target}`}
      onClick={(e) => {
        const el = document.getElementById(target);
        if (!el) return;
        e.preventDefault();
        onActivate?.();
        el.focus();
      }}
      className="sr-only z-[2000] rounded-md bg-card px-3 py-2 font-medium text-heading focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
    >
      {children}
    </a>
  );
}
