"use client";

import { cn } from "@/lib/utils";

export interface StreamToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/** Switch bound to request.stream (default on). When off uses the JSON path. */
export function StreamToggle({ checked, onChange, className }: StreamToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Stream answer tokens"
      onClick={() => onChange(!checked)}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-[var(--radius-pill)] border transition-colors duration-100",
          checked
            ? "border-accent bg-accent-tint"
            : "border-hairline bg-raised",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute h-2.5 w-2.5 rounded-full transition-all duration-100",
            checked
              ? "left-[14px] bg-accent"
              : "left-[2px] bg-text-muted",
          )}
        />
      </span>
      <span
        className={cn(
          "font-mono text-[0.6875rem] uppercase tracking-[0.06em]",
          checked ? "text-accent" : "text-text-muted",
        )}
      >
        stream
      </span>
    </button>
  );
}
