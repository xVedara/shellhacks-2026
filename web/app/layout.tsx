import type { Metadata, Viewport } from "next";
import { Poppins, Saira_Extra_Condensed } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

// Poppins for UI and body, Saira Extra Condensed for headlines and big numbers.
const body = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const display = Saira_Extra_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display-face" });

export const metadata: Metadata = {
  title: "StepSafe community map",
  description: "Detect. Alert. Move Freely. Live hazards reported by StepSafe walkers, checked by remote volunteers.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#081624" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${body.variable} ${display.variable}`}>
      <body className="flex h-dvh flex-col font-sans text-white antialiased">
        <a
          href="#main"
          className="sr-only z-[2000] rounded bg-white px-3 py-2 font-semibold text-navy focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
