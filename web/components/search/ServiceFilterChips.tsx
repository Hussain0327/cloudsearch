"use client";

import * as React from "react";
import { cn, serviceColor } from "@/lib/utils";
import { SERVICE_IDS } from "@/lib/services";

export interface ServiceFilterChipsProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

/**
 * Multi-select service-filter chip list -> request.services[]. Each chip is a
 * 4px-radius mono pill with a leading service-color tick. Roving-tabindex
 * keyboard nav: ↑/↓ (and ←/→) move focus, Space/Enter toggles selection.
 * Includes an "All" clear-all chip and a selected-count badge.
 */
export function ServiceFilterChips({
  selected,
  onChange,
  className,
}: ServiceFilterChipsProps) {
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const clearAll = () => onChange([]);

  const focusAt = (idx: number) => {
    const clamped = Math.max(0, Math.min(SERVICE_IDS.length - 1, idx));
    setFocusIdx(clamped);
    refs.current[clamped]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        focusAt(idx + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        focusAt(idx - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(SERVICE_IDS.length - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        toggle(SERVICE_IDS[idx]);
        break;
      default:
        break;
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-micro text-text-muted">services</span>
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <span className="font-mono text-[0.6875rem] text-accent [font-feature-settings:'tnum'_1,'ss01'_1]">
              {selected.length} selected
            </span>
          )}
          <button
            type="button"
            onClick={clearAll}
            disabled={selected.length === 0}
            className={cn(
              "rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[0.6875rem] transition-colors",
              selected.length === 0
                ? "border-hairline text-text-muted opacity-50"
                : "border-hairline text-text-secondary hover:border-accent hover:text-accent",
            )}
          >
            All
          </button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Filter by service"
        className="flex flex-wrap gap-1.5"
      >
        {SERVICE_IDS.map((id, idx) => {
          const isSelected = selectedSet.has(id);
          const color = serviceColor(id);
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[idx] = el;
              }}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`Filter by ${id}`}
              tabIndex={idx === focusIdx ? 0 : -1}
              onFocus={() => setFocusIdx(idx)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              onClick={() => toggle(id)}
              className={cn(
                "inline-flex items-center gap-1.5 h-6 px-2 rounded-[var(--radius-sm)]",
                "font-mono text-[0.6875rem] leading-none transition-colors duration-100",
                "[font-feature-settings:'tnum'_1,'ss01'_1] border",
                isSelected
                  ? "border-accent bg-accent-tint text-accent"
                  : "border-hairline bg-raised text-text-secondary hover:border-[var(--border-strong)] hover:text-text-primary",
              )}
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: color }}
              />
              {id}
            </button>
          );
        })}
      </div>
    </div>
  );
}
