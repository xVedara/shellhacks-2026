import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page is a client component, so its title comes from this segment (WCAG 2.4.2).
export const metadata: Metadata = { title: "Verify queue" };

export default function VerifyLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
