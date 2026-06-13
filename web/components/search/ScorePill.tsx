import { cn, formatScore, scoreHeatColor } from "@/lib/utils";

export interface ScorePillProps {
  score: number;
  className?: string;
}

/**
 * Mono tabular score colored on the 5-stop heat scale. Tooltip names the metric
 * (RRF fusion score). The 3-decimal value is fixed-width via tnum.
 */
export function ScorePill({ score, className }: ScorePillProps) {
  const color = scoreHeatColor(score);
  return (
    <span
      title="fusion score (RRF)"
      className={cn(
        "inline-flex items-center h-5 px-1.5 rounded-[var(--radius-sm)]",
        "font-mono text-[0.6875rem] leading-none border",
        "[font-variant-numeric:tabular-nums] [font-feature-settings:'tnum'_1,'ss01'_1]",
        className,
      )}
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {formatScore(score)}
    </span>
  );
}
