"use client";

import * as React from "react";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ServiceBadge } from "./ServiceBadge";
import { ScorePill } from "./ScorePill";

export interface CitationChipProps {
  /** 1-indexed citation marker as written in the answer. */
  index: number;
  /** Resolved citation (citations[index-1]) or null if not yet/never present. */
  citation: Citation | null;
  /** True when the matching SourceCard is hovered/focused (bidirectional). */
  active?: boolean;
  /** Activate: smooth-scroll to + flash the matching card. */
  onActivate?: (index: number) => void;
  /** Hover/focus on the chip -> highlight matching card. */
  onHoverChange?: (index: number, hovering: boolean) => void;
}

/**
 * Inline superscript-style [N] marker. When resolved it is an interactive
 * <button> (cyan) with a hover popover (title, service, section_path, score);
 * click scrolls/flashes the source card. Unresolved indices render as muted,
 * non-interactive text and upgrade live once the citations event arrives.
 */
export function CitationChip({
  index,
  citation,
  active,
  onActivate,
  onHoverChange,
}: CitationChipProps) {
  const [open, setOpen] = React.useState(false);

  if (!citation) {
    // Unresolved — muted, non-interactive, will upgrade when citations land.
    return (
      <sup
        aria-hidden
        className="mx-px font-mono text-[0.7em] text-text-muted [font-feature-settings:'tnum'_1,'ss01'_1]"
      >
        [{index}]
      </sup>
    );
  }

  const sectionSnippet = citation.section_path
    ? citation.section_path.split(/\s*>\s*/).filter(Boolean).slice(-2).join(" > ")
    : "";

  return (
    <span className="relative inline-block align-baseline">
      <button
        type="button"
        aria-label={`Citation ${index}: ${citation.title}`}
        aria-describedby={open ? `cite-pop-${index}` : undefined}
        onClick={() => onActivate?.(index)}
        onMouseEnter={() => {
          setOpen(true);
          onHoverChange?.(index, true);
        }}
        onMouseLeave={() => {
          setOpen(false);
          onHoverChange?.(index, false);
        }}
        onFocus={() => {
          setOpen(true);
          onHoverChange?.(index, true);
        }}
        onBlur={() => {
          setOpen(false);
          onHoverChange?.(index, false);
        }}
        className={cn(
          "mx-px inline-flex -translate-y-[0.35em] items-center rounded-[2px] px-[3px]",
          "font-mono text-[0.7em] leading-none transition-colors duration-100",
          "[font-feature-settings:'tnum'_1,'ss01'_1]",
          "text-cyan hover:bg-[var(--cyan-tint)]",
          active && "bg-[var(--cyan-tint)] ring-1 ring-cyan/50",
        )}
      >
        [{index}]
      </button>

      {open && (
        <span
          id={`cite-pop-${index}`}
          role="tooltip"
          className={cn(
            "absolute bottom-full left-0 z-30 mb-1 w-72 max-w-[80vw]",
            "flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-strong)]",
            "bg-raised p-2.5 text-left shadow-lg",
          )}
        >
          <span className="flex items-center gap-2">
            <ServiceBadge serviceId={citation.service_name} />
            <ScorePill score={citation.score} />
            <span className="ml-auto font-mono text-[0.6875rem] text-text-muted">
              [{index}]
            </span>
          </span>
          <span className="text-[0.8125rem] font-semibold leading-snug text-text-primary">
            {citation.title}
          </span>
          {sectionSnippet && (
            <span className="font-mono text-[0.6875rem] leading-tight text-text-muted">
              {sectionSnippet}
            </span>
          )}
          {citation.text && (
            <span className="line-clamp-2 text-[0.75rem] leading-snug text-text-secondary">
              {citation.text}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
