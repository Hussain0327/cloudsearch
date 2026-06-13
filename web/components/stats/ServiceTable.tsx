"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ServiceStats } from "@/lib/types";
import { cn, serviceColor } from "@/lib/utils";

type SortKey = "service_name" | "documents" | "chunks" | "share";
type SortDir = "asc" | "desc";

interface Row extends ServiceStats {
  /** Fraction of total chunks (0..1). */
  share: number;
}

const nf = new Intl.NumberFormat("en-US");

const COLUMNS: {
  key: SortKey;
  label: string;
  numeric: boolean;
}[] = [
  { key: "service_name", label: "service", numeric: false },
  { key: "documents", label: "documents", numeric: true },
  { key: "chunks", label: "chunks", numeric: true },
  { key: "share", label: "share", numeric: true },
];

/**
 * Dense, sortable per-service breakdown. Each row carries a service-color tick,
 * tabular counts, and an inline bar-meter for that service's share of total
 * chunks. Clicking a row jumps to the search page (/) with the service prefilled.
 */
export function ServiceTable({ services }: { services: ServiceStats[] }) {
  const router = useRouter();
  const [sortKey, setSortKey] = React.useState<SortKey>("chunks");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const totalChunks = React.useMemo(
    () => services.reduce((sum, s) => sum + s.chunks, 0),
    [services],
  );

  const rows: Row[] = React.useMemo(() => {
    const withShare = services.map((s) => ({
      ...s,
      share: totalChunks > 0 ? s.chunks / totalChunks : 0,
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    return withShare.sort((a, b) => {
      if (sortKey === "service_name") {
        return a.service_name.localeCompare(b.service_name) * dir;
      }
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [services, totalChunks, sortKey, sortDir]);

  const maxShare = React.useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.share), 0) || 1,
    [rows],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns default to descending (biggest first); name ascending.
      setSortDir(key === "service_name" ? "asc" : "desc");
    }
  }

  function openSearch(serviceName: string) {
    const params = new URLSearchParams({ services: serviceName });
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="overflow-x-auto border border-hairline rounded-[var(--radius-md)] bg-panel">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Per-service document and chunk counts, sortable.
        </caption>
        <thead>
          <tr className="border-b border-hairline">
            {COLUMNS.map((col) => {
              const active = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={cn(
                    "px-4 py-2.5",
                    col.numeric ? "text-right" : "text-left",
                    col.key === "share" && "w-[34%] min-w-[160px]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 text-micro transition-colors",
                      col.numeric && "flex-row-reverse",
                      active
                        ? "text-text-primary"
                        : "text-text-muted hover:text-text-secondary",
                    )}
                  >
                    {col.label}
                    <span
                      aria-hidden
                      className={cn(
                        "font-mono text-[0.625rem] leading-none",
                        active ? "opacity-100 text-accent" : "opacity-30",
                      )}
                    >
                      {active ? (sortDir === "asc" ? "▲" : "▼") : "▾"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tick = serviceColor(row.service_name);
            const barPct = (row.share / maxShare) * 100;
            return (
              <tr
                key={row.service_name}
                tabIndex={0}
                role="link"
                aria-label={`Search ${row.service_name} documentation`}
                onClick={() => openSearch(row.service_name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openSearch(row.service_name);
                  }
                }}
                className={cn(
                  "group border-b border-hairline last:border-b-0 cursor-pointer outline-none",
                  "transition-colors hover:bg-raised focus-visible:bg-raised",
                )}
              >
                {/* Service id with color tick */}
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-[2px] shrink-0"
                      style={{ backgroundColor: tick }}
                    />
                    <span className="font-mono text-small text-text-primary group-hover:text-accent transition-colors">
                      {row.service_name}
                    </span>
                  </span>
                </td>
                {/* Documents */}
                <td className="px-4 py-2.5 text-right font-mono text-small text-text-secondary tabular-nums [font-feature-settings:'tnum'_1,'ss01'_1]">
                  {nf.format(row.documents)}
                </td>
                {/* Chunks */}
                <td className="px-4 py-2.5 text-right font-mono text-small text-text-secondary tabular-nums [font-feature-settings:'tnum'_1,'ss01'_1]">
                  {nf.format(row.chunks)}
                </td>
                {/* Share — inline bar meter + % */}
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="relative h-1.5 flex-1 overflow-hidden rounded-[var(--radius-sm)] bg-raised border border-hairline"
                      role="meter"
                      aria-valuenow={Math.round(row.share * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.service_name} chunk share`}
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-[var(--radius-sm)]"
                        style={{ width: `${barPct}%`, backgroundColor: tick }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono text-meta text-text-muted tabular-nums [font-feature-settings:'tnum'_1,'ss01'_1]">
                      {(row.share * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
