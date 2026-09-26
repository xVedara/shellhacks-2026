"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Map" },
  { href: "/verify", label: "Verify queue" },
];

export default function Header() {
  const pathname = usePathname();
  const { user, status, deviceId } = useIdentity();

  return (
    <header className="relative bg-navy">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg text-lg font-bold tracking-tight text-white">
          <Image src="/logo.png" width={32} height={32} alt="" priority className="rounded-lg" />
          StepSafe
        </Link>
        <nav aria-label="Main">
          <ul className="flex gap-1">
            {NAV.map((item) => {
              const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`block border-b-[3px] px-3 py-2 font-semibold ${
                      current ? "border-blue text-white" : "border-transparent text-muted hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="ml-auto text-sm text-muted" title={deviceId ?? undefined}>
          {status === "loading" && "Loading your profile…"}
          {status === "ok" && user && (
            <>
              <span className="font-semibold text-white">{user.displayName}</span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span>{user.karma} karma</span>
            </>
          )}
          {status === "unavailable" && "Anonymous verifier (profile unavailable)"}
        </p>
      </div>
      {/* Brand gradient rule. */}
      <div className="h-[3px] bg-gradient-to-r from-signal to-[#0868f8]" aria-hidden="true" />
    </header>
  );
}
