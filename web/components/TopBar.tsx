"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge, Kbd } from "@/components/ui";
import { ThemeToggle } from "./ThemeToggle";

const BUILD_TAG = process.env.NEXT_PUBLIC_BUILD_TAG ?? "v0.1.0";

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Search" },
  { href: "/stats", label: "Stats" },
];

/**
 * Fixed 56px top bar: wordmark (display font) + mono build pill, global ⌘K
 * hint, nav tabs, and theme toggle. Bottom hairline divider.
 */
export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-hairline bg-app/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4">
        {/* Wordmark + build tag */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 rounded-[2px] bg-accent"
            style={{ boxShadow: "0 0 0 3px var(--accent-tint)" }}
          />
          <span className="text-h2 font-display font-bold tracking-[-0.01em] leading-none">
            CloudSearch
          </span>
          <Badge tone="muted" className="hidden sm:inline-flex">
            {BUILD_TAG}
          </Badge>
        </Link>

        {/* Nav tabs */}
        <nav className="ml-2 flex items-center gap-1" aria-label="Primary">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative h-14 inline-flex items-center px-3 text-small transition-colors",
                  active
                    ? "text-text-primary"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-0.5 bg-accent"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Global command-palette hint */}
        <div className="hidden items-center gap-1.5 text-meta text-text-muted md:flex">
          <span>search</span>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </div>

        <ThemeToggle />
      </div>
    </header>
  );
}
