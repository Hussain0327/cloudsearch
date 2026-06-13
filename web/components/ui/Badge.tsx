import * as React from "react";
import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "accent"
  | "cyan"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "muted";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Show a leading status dot in the tone color. */
  dot?: boolean;
}

const TONES: Record<Tone, { text: string; bg: string; border: string }> = {
  neutral: { text: "var(--text-secondary)", bg: "transparent", border: "var(--hairline)" },
  accent: { text: "var(--accent)", bg: "var(--accent-tint)", border: "var(--accent)" },
  cyan: { text: "var(--cyan)", bg: "var(--cyan-tint)", border: "var(--cyan)" },
  success: { text: "var(--success)", bg: "rgba(70,196,106,0.12)", border: "var(--success)" },
  warning: { text: "var(--warning)", bg: "rgba(232,179,57,0.12)", border: "var(--warning)" },
  error: { text: "var(--error)", bg: "var(--error-tint)", border: "var(--error)" },
  info: { text: "var(--info)", bg: "rgba(91,155,213,0.12)", border: "var(--info)" },
  muted: { text: "var(--text-muted)", bg: "transparent", border: "var(--hairline)" },
};

/**
 * Compact mono pill for metadata, status, cache_hit, service ids, etc.
 * Tabular numerals on; sharp 4px radius (nothing fully rounded but dots).
 */
export function Badge({ tone = "neutral", dot, className, children, style, ...props }: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-1.5 h-5 rounded-[var(--radius-sm)]",
        "font-mono text-[0.6875rem] tracking-[0.02em] leading-none",
        "[font-variant-numeric:tabular-nums] [font-feature-settings:'tnum'_1,'ss01'_1]",
        "border whitespace-nowrap",
        className,
      )}
      style={{ color: t.text, backgroundColor: t.bg, borderColor: t.border, ...style }}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: t.text }}
        />
      )}
      {children}
    </span>
  );
}
