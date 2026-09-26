"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Live map" },
  { href: "/verify", label: "Verify queue" },
];

export default function Header() {
  const pathname = usePathname();
  const { user, status, deviceId } = useIdentity();
  const initial = user?.displayName?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="relative z-[1200] border-b border-edge bg-[rgb(8_22_36/0.72)] backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 lg:px-5">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg">
          <Image src="/logo.png" width={34} height={34} alt="" priority className="rounded-[10px] shadow-[0_0_18px_rgb(19_185_242/0.35)]" />
          <span className="leading-none">
            <span className="block font-display text-[1.45rem] font-bold uppercase tracking-wide text-white">StepSafe</span>
            <span className="hidden text-[11px] font-medium text-muted sm:block">Community hazard map</span>
          </span>
        </Link>
        <nav aria-label="Main" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex gap-1 rounded-xl border border-edge bg-well p-1">
            {NAV.map((item) => {
              const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href} className="flex-1 sm:flex-none">
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`block rounded-lg px-4 py-1.5 text-center text-sm font-semibold transition-colors ${
                      current ? "bg-blue text-navy" : "text-muted hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2.5 text-sm" title={deviceId ?? undefined}>
          {status === "ok" && user && (
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-signal to-[#0868f8] font-semibold text-navy"
            >
              {initial}
            </span>
          )}
          <p className="leading-tight text-muted">
            {status === "loading" && "Loading your profile…"}
            {status === "ok" && user && (
              <>
                <span className="block font-semibold text-white">{user.displayName}</span>
                <span className="block text-xs">{user.karma} karma · verifier</span>
              </>
            )}
            {status === "unavailable" && "Anonymous verifier (profile unavailable)"}
          </p>
        </div>
      </div>
    </header>
  );
}
