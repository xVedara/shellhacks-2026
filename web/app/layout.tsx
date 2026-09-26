import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "StepSafe community map",
  description: "Detect. Alert. Move Freely. Live hazards reported by StepSafe walkers, checked by remote volunteers.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#081624" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="flex h-dvh flex-col bg-navy font-sans text-white antialiased">
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
