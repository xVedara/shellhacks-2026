import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "StepSafe community map",
  description: "Detect. Alert. Move Freely. Live hazards reported by StepSafe walkers, checked by remote volunteers.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

// Runs before first paint so the page never flashes the wrong theme. Stored choice wins,
// otherwise the OS setting. Storage can throw (private mode, blocked site data).
const THEME_BOOT = `(function(){var t;try{t=localStorage.getItem("stepsafe.theme")}catch(e){}if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="flex min-h-dvh flex-col font-sans text-[14px] text-ink antialiased lg:h-dvh lg:flex-row">
        <a
          href="#main"
          className="sr-only z-[2000] rounded-md bg-card px-3 py-2 font-medium text-heading focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
