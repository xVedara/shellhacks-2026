import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Header from "@/components/Header";
import SkipLink from "@/components/SkipLink";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "StepSafe community map",
  description: "Travel safe. Together. Live hazards reported by StepSafe walkers, checked by remote volunteers.",
  // Blue logo in light mode, navy in dark (brandguide/README.md).
  icons: {
    icon: [
      { url: "/icon-light.png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark.png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#081624" },
  ],
};

// Dark-first. A stored choice wins; otherwise the canvas stays navy. Storage can throw.
const THEME_BOOT = `(function(){var t;try{t=localStorage.getItem("stepsafe.theme")}catch(e){}if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t})()`;

// Typed by hand, not with the generated LayoutProps, so `tsc --noEmit` passes on a fresh clone before any build.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden font-sans text-[14px] text-ink antialiased md:flex-row">
        <SkipLink target="main">Skip to content</SkipLink>
        <Header />
        {/* tabIndex -1: the skip link focuses it; a ring shows only for keyboard focus (:focus-visible). */}
        <main id="main" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </main>
      </body>
    </html>
  );
}
