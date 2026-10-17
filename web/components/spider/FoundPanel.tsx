"use client";

import * as React from "react";
import Link from "next/link";
import {
  CATEGORY_LABELS,
  FACT_CATEGORIES,
  type Fact,
  type FactCategory,
  type FilingCounts,
  type FilingLink,
} from "@/lib/filings-types";
import { CATEGORY_COLOR, countByCategory, formatFactValue } from "@/lib/facts-format";
import { cn } from "@/lib/utils";

export interface FoundPanelProps {
  companyName: string;
  ticker: string;
  facts: readonly Fact[];
  links: readonly FilingLink[];
  /** Denominator for "n of N found". */
  total: number;
  activeFact: Fact | null;
  /** Server-side filter currently applied (empty = all). */
  filter: FactCategory[];
  onFilterChange: (next: FactCategory[]) => void;
  onSelect: (fact: Fact) => void;
  className?: string;
}

/**
 * The "Found" ledger: header, category chips with live counts, and one row per
 * fact (newest at the bottom, auto-scrolled). Clicking a row sends the spider
 * back to that fact.
 */
export function FoundPanel({
  companyName,
  ticker,
  facts,
  links,
  total,
  activeFact,
  filter,
  onFilterChange,
  onSelect,
  className,
}: FoundPanelProps) {
  const counts: FilingCounts = React.useMemo(() => countByCategory(facts), [facts]);
  const listRef = React.useRef<HTMLOListElement>(null);
  const linkByIndex = React.useMemo(() => {
    const m = new Map<number, FilingLink>();
    for (const l of links) m.set(l.fact_index, l);
    return m;
  }, [links]);

  // Keep the newest row in view while the crawl runs.
  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [facts.length]);

  const toggle = (cat: FactCategory) => {
    if (filter.includes(cat)) onFilterChange(filter.filter((c) => c !== cat));
    else onFilterChange([...filter, cat]);
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* Header */}
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 pt-3 pb-2">
        <span className="text-h2 font-display font-bold text-success">Found</span>
        <span className="flex items-center gap-1.5 truncate text-small font-semibold text-text-primary">
          <span className="truncate">{companyName}</span>
          <span className="font-mono text-[0.6875rem] text-text-muted">{ticker}</span>
        </span>
        <span className="ml-auto shrink-0 font-mono text-[0.75rem] text-text-secondary [font-variant-numeric:tabular-nums]">
          {facts.length} of {total} found
        </span>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-4 py-2">
        <Chip
          active={filter.length === 0}
          onClick={() => onFilterChange([])}
          label="All"
          count={facts.length}
          color="var(--text-primary)"
          solid
        />
        {FACT_CATEGORIES.map((cat) => (
          <Chip
            key={cat}
            active={filter.includes(cat)}
            onClick={() => toggle(cat)}
            label={CATEGORY_LABELS[cat]}
            count={counts[cat]}
            color={CATEGORY_COLOR[cat]}
          />
        ))}
      </div>

      {/* Rows */}
      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {facts.length === 0 && (
          <li className="px-2 py-6 text-small text-text-muted">
            Nothing found yet. Press play and the spider starts walking the filing.
          </li>
        )}
        {facts.map((f) => {
          const link = linkByIndex.get(f.fact_index);
          const isActive = activeFact?.dom_id === f.dom_id;
          return (
            <li key={f.dom_id}>
              <button
                type="button"
                onClick={() => onSelect(f)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "group grid w-full grid-cols-[3px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors",
                  isActive ? "bg-raised" : "hover:bg-raised/70",
                )}
              >
                <span
                  aria-hidden
                  className="h-full min-h-[26px] w-[3px] rounded-full"
                  style={{ backgroundColor: CATEGORY_COLOR[f.category] }}
                />
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className="min-w-0 shrink truncate font-mono text-[0.9375rem] font-medium text-text-primary [font-variant-numeric:tabular-nums]"
                    title={f.raw_text}
                  >
                    {formatFactValue(f)}
                  </span>
                  <span className="min-w-[30%] truncate text-small text-text-secondary" title={f.label}>
                    {f.label}
                  </span>
                </span>
                <span
                  className="text-micro shrink-0 font-mono"
                  style={{ color: CATEGORY_COLOR[f.category] }}
                >
                  {CATEGORY_LABELS[f.category]}
                </span>
              </button>
              {link && <LinkRow link={link} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
  color,
  solid,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color: string;
  solid?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 text-[0.75rem] transition-colors",
        active
          ? solid
            ? "border-text-primary bg-text-primary text-text-inverse"
            : "border-current bg-raised text-text-primary"
          : "border-hairline text-text-secondary hover:border-[var(--border-strong)] hover:text-text-primary",
      )}
      style={active && !solid ? { borderColor: color } : undefined}
    >
      {!solid && (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      )}
      <span>{label}</span>
      <span className="font-mono text-[0.6875rem] opacity-80 [font-variant-numeric:tabular-nums]">
        {count}
      </span>
    </button>
  );
}

function LinkRow({ link }: { link: FilingLink }) {
  const indexed = link.target_filing_id !== null;
  return (
    <div className="ml-[15px] mb-1 flex items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-cyan/50 bg-cyan-tint px-2 py-1 text-small">
      <span className="text-text-secondary">
        Found <span className="font-semibold text-text-primary">{link.mention_text}</span>
        <span className="mx-1 text-text-muted">&rarr;</span>
        <span className="font-mono text-[0.75rem] text-cyan">{link.target_ticker}</span>
      </span>
      {indexed ? (
        <Link
          href={`/filings/${link.target_filing_id}?autoplay=1`}
          className="ml-auto inline-flex h-6 items-center rounded-[var(--radius-sm)] border border-cyan px-2 font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-cyan hover:bg-cyan hover:text-text-inverse"
        >
          Jump
        </Link>
      ) : (
        <span
          aria-disabled
          className="ml-auto inline-flex h-6 items-center rounded-[var(--radius-sm)] border border-hairline px-2 font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-text-muted"
          title="This company's filing is not indexed yet"
        >
          not indexed
        </span>
      )}
    </div>
  );
}
