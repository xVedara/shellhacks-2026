import type { Metadata } from "next";
import type { ReactNode } from "react";

// Until the record loads; the page then names the hazard in document.title (WCAG 2.4.2).
export const metadata: Metadata = { title: "Hazard details" };

export default function HazardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
