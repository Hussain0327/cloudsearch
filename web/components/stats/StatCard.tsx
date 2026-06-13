import * as React from "react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  /** Uppercase micro label, e.g. "TOTAL DOCUMENTS". */
  label: string;
  /** Big display value (number formatted, relative time, etc). */
  value: React.ReactNode;
  /** Optional mono sub-line shown under the value (units, ISO tooltip text). */
  hint?: React.ReactNode;
  /** Native title attribute (e.g. exact ISO timestamp on indexed_at). */
  title?: string;
  /** Optional accent tick color for the left edge. */
  tickColor?: string;
  className?: string;
}

/**
 * One tile of the stats band. Flat, hairline, sharp — a display-font number
 * over a mono micro label, with a thin color-coded left tick per the
 * "rail of color-coded service ticks" motif.
 */
export function StatCard({
  label,
  value,
  hint,
  title,
  tickColor = "var(--accent)",
  className,
}: StatCardProps) {
  return (
    <div
      title={title}
      className={cn(
        "relative overflow-hidden border border-hairline bg-panel",
        "rounded-[var(--radius-md)] px-4 py-3.5",
        "flex flex-col gap-1.5",
        className,
      )}
    >
      {/* Left color tick */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: tickColor }}
      />
      <span className="text-micro text-text-muted">{label}</span>
      <span className="font-display text-h1 leading-none tabular-nums [font-feature-settings:'tnum'_1,'ss01'_1] text-text-primary">
        {value}
      </span>
      {hint != null && (
        <span className="text-meta text-text-muted">{hint}</span>
      )}
    </div>
  );
}
