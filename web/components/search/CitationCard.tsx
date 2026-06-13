"use client";

import * as React from "react";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ServiceBadge } from "./ServiceBadge";
import { ScorePill } from "./ScorePill";

export interface CitationCardProps {
  citation: Citation;
  /** 1-indexed [N] label that anchors prose chips to this card. */
  index: number;
  /** True while any matching [N] chip in the prose is hovered/focused. */
  highlighted?: boolean;
  /** Notify parent to highlight matching prose chips on hover/focus. */
  onActiveChange?: (index: number, active: boolean) => void;
}

function openDoc(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Hairline source card. Anchored as #cite-N so prose [N] chips can smooth-scroll
 * to it and flash it amber. Whole card is focusable and opens document_url on
 * Enter/Space; hovering it highlights every matching [N] chip in the answer.
 */
export function CitationCard({
  citation,
  index,
  highlighted,
  onActiveChange,
}: CitationCardProps) {
  const sections = citation.section_path
    ? citation.section_path.split(/\s*>\s*/).filter(Boolean)
    : [];

  const setActive = (active: boolean) => onActiveChange?.(index, active);

  return (
    <article
      id={`cite-${index}`}
      tabIndex={0}
      role="link"
      aria-label={`Source ${index}: ${citation.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDoc(citation.document_url);
        }
      }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      className={cn(
        "group flex scroll-mt-20 flex-col gap-2 rounded-[var(--radius-md)] border p-3",
        "bg-panel transition-colors duration-100",
        highlighted
          ? "border-[var(--border-strong)]"
          : "border-hairline hover:border-[var(--border-strong)]",
      )}
    >
      {/* row1: service badge + score + [N] */}
      <div className="flex items-center gap-2">
        <ServiceBadge serviceId={citation.service_name} />
        <ScorePill score={citation.score} />
        <span className="ml-auto font-mono text-[0.6875rem] leading-none text-text-muted [font-feature-settings:'tnum'_1,'ss01'_1]">
          [{index}]
        </span>
      </div>

      {/* row2: title -> document_url (new tab) */}
      <a
        href={citation.document_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-start gap-1 text-[0.9375rem] font-semibold leading-snug text-text-primary hover:text-cyan hover:underline underline-offset-2"
      >
        <span className="min-w-0">{citation.title}</span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted group-hover:text-cyan"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 17 17 7" />
          <path d="M8 7h9v9" />
        </svg>
      </a>

      {/* row3: section_path mono with ' > ' separators */}
      {sections.length > 0 && (
        <div className="font-mono text-[0.75rem] leading-tight text-text-muted [font-feature-settings:'tnum'_1,'ss01'_1]">
          {sections.map((s, i) => (
            <React.Fragment key={`${s}-${i}`}>
              {i > 0 && <span className="px-1 text-text-muted/60">{">"}</span>}
              <span className={i === sections.length - 1 ? "text-text-secondary" : ""}>
                {s}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* row4: 2-line clamped snippet */}
      {citation.text && (
        <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-text-secondary">
          {citation.text}
        </p>
      )}
    </article>
  );
}
