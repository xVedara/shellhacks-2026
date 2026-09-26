"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { useIdentity } from "@/lib/hooks";

const THEME_KEY = "stepsafe.theme";

const ICON = {
  map: <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14" />,
  check: <path d="M4.5 4.5h15v15h-15zM8.5 12l2.5 2.5 4.5-5" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  sun: <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICON; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[name]}
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Live map", icon: "map" },
  { href: "/verify", label: "Verify queue", icon: "check" },
] as const;

// The theme lives on <html data-theme>, set before paint by the boot script in app/layout.tsx.
const subscribeTheme = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
};
const readTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => null);

  // With no saved choice, keep following the OS if it flips while the page is open.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (!storedTheme()) document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === "dark"}
      className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
    >
      <Icon name={theme === "dark" ? "moon" : "sun"} />
      <span className="sr-only lg:not-sr-only">Dark theme</span>
    </button>
  );
}

function Profile({ user, status, deviceId }: ReturnType<typeof useIdentity>) {
  const initial = user?.displayName?.[0]?.toUpperCase() ?? "?";
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 lg:mt-1" title={deviceId ?? undefined}>
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-[12px] font-semibold text-accent"
      >
        {status === "ok" && user ? initial : "?"}
      </span>
      <p className="min-w-0 text-[13px] leading-tight">
        {status === "loading" && <span className="text-ink-3">Loading your profile…</span>}
        {status === "ok" && user && (
          <>
            <span className="block truncate font-medium text-ink">{user.displayName}</span>
            <span className="block whitespace-nowrap text-[12px] tabular-nums text-ink-3">{user.karma} karma · verifier</span>
          </>
        )}
        {status === "unavailable" && (
          <>
            <span className="block whitespace-nowrap font-medium text-ink">Anonymous verifier</span>
            <span className="block whitespace-nowrap text-[12px] text-ink-3">(profile unavailable)</span>
          </>
        )}
      </p>
    </div>
  );
}

export default function Header() {
  const pathname = usePathname();
  const identity = useIdentity(); // once: each call polls the server

  return (
    <header className="relative z-[1200] flex shrink-0 flex-col border-b border-line bg-sunken lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2.5 px-4 py-2.5 lg:px-3 lg:pb-2 lg:pt-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-md">
          <Image src="/logo-light.png" width={28} height={28} alt="" priority className="logo-light rounded-md" />
          <Image src="/logo-dark.png" width={28} height={28} alt="" priority className="logo-dark rounded-md" />
          <span className="min-w-0 leading-tight">
            <span className="block text-[15px] font-semibold text-heading">StepSafe</span>
            <span className="hidden truncate text-[12px] text-ink-3 sm:block">Community hazard map</span>
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          <Profile {...identity} />
          <ThemeToggle />
        </div>
      </div>

      <nav aria-label="Main" className="px-2 lg:mt-2 lg:flex-1">
        <ul className="flex gap-1 lg:flex-col lg:gap-0.5">
          {NAV.map((item) => {
            const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href} className="flex-1 lg:flex-none">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex h-9 items-center justify-center gap-2.5 border-b-2 px-2.5 text-[14px] font-medium lg:h-8 lg:justify-start lg:rounded-md lg:border-b-0 ${
                    current
                      ? "border-accent text-accent lg:bg-accent-tint lg:font-semibold lg:shadow-[inset_2px_0_0_var(--accent)]"
                      : "border-transparent text-ink-2 hover:bg-hover hover:text-ink"
                  }`}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="hidden border-t border-line p-2 lg:block">
        <ThemeToggle />
        <Profile {...identity} />
      </div>
    </header>
  );
}
