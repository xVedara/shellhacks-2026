import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

// Server component: the button classes are spelled out here, because constants exported from the client
// module (components/ui.tsx) arrive in a server component as client references, not strings.
export default function NotFound() {
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-4 md:items-center">
      <div className="panel w-full max-w-md p-6">
        <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.03em] text-heading">Page not found</h1>
        <p className="mt-2 text-ink-2">There is nothing at this address. The live map shows every active hazard.</p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-semibold tracking-[-0.02em] text-primary-ink hover:bg-[var(--primary-hover)]"
        >
          Back to the live map
        </Link>
      </div>
    </div>
  );
}
