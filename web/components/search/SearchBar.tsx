"use client";

import * as React from "react";
import { Button, Kbd } from "@/components/ui";
import { cn } from "@/lib/utils";
import { TopKStepper } from "./TopKStepper";
import { StreamToggle } from "./StreamToggle";

export interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  topK: number;
  onTopKChange: (n: number) => void;
  stream: boolean;
  onStreamChange: (s: boolean) => void;
  /** Submit. `forceStream` is set by Cmd+Enter. */
  onSubmit: (forceStream: boolean) => void;
  /** Abort the in-flight request. */
  onStop: () => void;
  loading: boolean;
  selectedCount: number;
  /** Open the filter drawer/bottom-sheet (mobile / collapsed rail). */
  onOpenFilters?: () => void;
}

/**
 * Sticky query bar: monospace input with a leading ⌘ glyph and block caret;
 * Enter submits, ⌘+Enter forces stream, ESC clears. Inline top_k stepper +
 * stream toggle, a filter trigger (mobile), and the amber Search/Stop button.
 */
export const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar(
    {
      query,
      onQueryChange,
      topK,
      onTopKChange,
      stream,
      onStreamChange,
      onSubmit,
      onStop,
      loading,
      selectedCount,
      onOpenFilters,
    },
    ref,
  ) {
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // ⌘/Ctrl + Enter forces streaming on for this submit.
        onSubmit(e.metaKey || e.ctrlKey);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (query) {
          onQueryChange("");
        } else {
          (e.currentTarget as HTMLInputElement).blur();
        }
      }
    };

    return (
      <div className="flex flex-col gap-2">
        <div
          className={cn(
            "flex items-center gap-2 rounded-[var(--radius-md)] border bg-raised px-2.5 py-2",
            "border-hairline focus-within:border-accent transition-colors",
          )}
        >
          <span
            aria-hidden
            className="select-none font-mono text-[0.95rem] leading-none text-accent"
          >
            ⌘
          </span>
          <div className="relative flex-1">
            <input
              ref={ref}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="ask about s3, lambda, ec2, iam…"
              aria-label="Search query"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className={cn(
                "w-full bg-transparent font-mono text-[0.9375rem] leading-tight text-text-primary",
                "placeholder:text-text-muted focus:outline-none",
                "[font-feature-settings:'tnum'_1,'ss01'_1]",
              )}
            />
          </div>

          {/* Mobile / collapsed-rail filter trigger. */}
          {onOpenFilters && (
            <button
              type="button"
              onClick={onOpenFilters}
              className="lg:hidden inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hairline bg-app px-2 font-mono text-[0.6875rem] text-text-secondary hover:border-[var(--border-strong)]"
            >
              filters
              {selectedCount > 0 && (
                <span className="rounded-[2px] bg-accent-tint px-1 text-accent">
                  {selectedCount}
                </span>
              )}
            </button>
          )}

          {loading ? (
            <Button variant="danger" size="sm" onClick={onStop} className="shrink-0">
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSubmit(false)}
              disabled={query.trim() === ""}
              className="shrink-0"
            >
              Search
            </Button>
          )}
        </div>

        {/* Controls row: top_k + stream toggle + key hints. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-micro text-text-muted">top_k</span>
            <TopKStepper value={topK} onChange={onTopKChange} />
          </div>
          <StreamToggle checked={stream} onChange={onStreamChange} />
          <div className="ml-auto hidden items-center gap-3 text-meta text-text-muted sm:flex">
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> search
            </span>
            <span className="flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd> stream
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> clear
            </span>
          </div>
        </div>
      </div>
    );
  },
);
