"use client";

import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CitationCard } from "./CitationCard";

export interface CitationListProps {
  citations: Citation[];
  /** Index (1-based) whose prose chips are currently active -> highlight card. */
  highlightIndex?: number | null;
  /** Index (1-based) to flash amber (set on chip click). */
  flashIndex?: number | null;
  /** Bubble card hover/focus so the page highlights matching prose chips. */
  onCardActive?: (index: number, active: boolean) => void;
  className?: string;
}

/**
 * Ordered source list — cards labeled by their [N] (citation array index) and
 * anchored as #cite-N. Used in the right pane (>=1400px) and the Sources tab.
 */
export function CitationList({
  citations,
  highlightIndex,
  flashIndex,
  onCardActive,
  className,
}: CitationListProps) {
  if (citations.length === 0) return null;

  return (
    <ol className={cn("flex list-none flex-col gap-2", className)}>
      {citations.map((citation, i) => {
        const index = i + 1;
        return (
          <li key={`${citation.chunk_id}-${index}`} className={flashIndex === index ? "flash-cite rounded-[var(--radius-md)]" : undefined}>
            <CitationCard
              citation={citation}
              index={index}
              highlighted={highlightIndex === index}
              onActiveChange={onCardActive}
            />
          </li>
        );
      })}
    </ol>
  );
}
