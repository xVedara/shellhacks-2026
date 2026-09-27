"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
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
  { href: "/verify", label: "Verify", icon: "check" },
] as const;

const subscribeTheme = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
};
const readTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark");

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
      aria-label="Color theme"
      aria-pressed={theme === "dark"}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink ${className}`}
    >
      <Icon name={theme === "dark" ? "moon" : "sun"} />
      {theme === "dark" ? "Dark theme" : "Light theme"}
    </button>
  );
}

function Profile({ user, status, deviceId }: ReturnType<typeof useIdentity>) {
  const initial = user?.displayName?.[0]?.toUpperCase() ?? "?";
  return (
    <div className="flex min-w-0 items-center gap-2.5" title={deviceId ?? undefined}>
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-[12px] font-semibold text-accent"
      >
        {status === "ok" && user ? initial : "?"}
      </span>
      <p className="min-w-0 text-[13px] leading-tight">
        {status === "loading" && <span className="text-ink-3">Loading profile…</span>}
        {status === "ok" && user && (
          <>
            <span className="block truncate font-medium text-ink md:hidden">
              {user.displayName} · {user.karma}
            </span>
            <span className="hidden truncate font-medium text-ink md:block">{user.displayName}</span>
            <span className="hidden text-[12px] tabular-nums text-ink-3 md:block">{user.karma} karma</span>
          </>
        )}
        {status === "unavailable" && (
          <>
            <span className="block truncate font-medium text-ink">Anonymous</span>
            <span className="hidden text-[12px] text-ink-3 md:block">Profile unavailable</span>
          </>
        )}
      </p>
    </div>
  );
}

export default function Header() {
  const pathname = usePathname();
  const identity = useIdentity();

  return (
    <header className="relative z-[1200] flex shrink-0 flex-col border-b border-line bg-[var(--header)] md:w-[248px] md:border-b-0 md:border-r">
      <div className="flex min-h-12 items-center gap-2.5 px-4 md:px-5 md:pb-2 md:pt-4">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-md">
          <Image src="/logo-light.png" width={28} height={28} alt="" priority className="logo-light rounded-md" />
          <Image src="/logo-dark.png" width={28} height={28} alt="" priority className="logo-dark rounded-md" />
          <span className="min-w-0 leading-tight">
            <span className="block text-[16px] font-semibold tracking-[-0.03em] text-heading">StepSafe</span>
            <span className="hidden text-[12px] text-ink-3 md:block">Community hazard map</span>
          </span>
        </Link>
        <div className="ml-auto md:hidden">
          <Profile {...identity} />
        </div>
      </div>

      <nav aria-label="Main" className="px-2 md:mt-2 md:flex-1">
        <ul className="flex gap-1 md:flex-col md:gap-1">
          {NAV.map((item) => {
            const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href} className="flex-1 md:flex-none">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-none border-b-2 px-2.5 text-[14px] font-medium md:justify-start md:rounded-md md:border-b-0 md:px-3 ${
                    current
                      ? "border-[var(--blue)] text-accent md:border-transparent md:bg-raised md:font-semibold md:shadow-[inset_2px_0_0_var(--blue)]"
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

      <div className="mt-auto hidden border-t border-line p-3 md:block">
        <ThemeToggle className="w-full justify-start px-2" />
        <div className="px-2 py-2">
          <Profile {...identity} />
        </div>
      </div>
    </header>
  );
}
