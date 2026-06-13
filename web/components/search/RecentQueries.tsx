"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cloudsearch-recent";
const MAX_RECENT = 8;

/** localStorage-backed recent-queries store (most-recent first, de-duped). */
export function useRecentQueries() {
  const [recent, setRecent] = React.useState<string[]>([]);

  // Load once after mount. Deferred to a microtask so the setState is not
  // synchronous within the effect body (avoids cascading-render lint/perf)
  // and runs client-only, keeping the server snapshot empty (no hydration
  // mismatch).
  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setRecent(parsed.filter((x): x is string => typeof x === "string"));
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = React.useCallback((next: string[]) => {
    setRecent(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const add = React.useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) return;
      setRecent((prev) => {
        const next = [q, ...prev.filter((x) => x !== q)].slice(0, MAX_RECENT);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const clear = React.useCallback(() => persist([]), [persist]);

  return { recent, add, clear };
}

export interface RecentQueriesProps {
  queries: string[];
  onSelect: (query: string) => void;
  onClear?: () => void;
  className?: string;
}

/** Rail list of recent queries; click refills the query bar. */
export function RecentQueries({
  queries,
  onSelect,
  onClear,
  className,
}: RecentQueriesProps) {
  if (queries.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-micro text-text-muted">recent</span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="font-mono text-[0.6875rem] text-text-muted transition-colors hover:text-error"
          >
            clear
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {queries.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onSelect(q)}
              title={q}
              className="block w-full truncate rounded-[var(--radius-sm)] px-2 py-1 text-left font-mono text-[0.75rem] text-text-secondary transition-colors hover:bg-raised hover:text-text-primary"
            >
              <span aria-hidden className="mr-1.5 text-text-muted">
                ›
              </span>
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
