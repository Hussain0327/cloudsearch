"use client";

import { cn } from "@/lib/utils";

export interface TopKStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

/**
 * Compact −/N/+ stepper bound to request.top_k. Clamps to [min,max] (1..20),
 * mono tabular value. Defaults are set by the parent (10).
 */
export function TopKStepper({
  value,
  onChange,
  min = 1,
  max = 20,
  className,
}: TopKStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const set = (n: number) => onChange(clamp(n));

  return (
    <div
      className={cn(
        "inline-flex h-7 items-stretch overflow-hidden rounded-[var(--radius-sm)] border border-hairline bg-raised",
        className,
      )}
      role="group"
      aria-label="Results to retrieve (top_k)"
    >
      <button
        type="button"
        aria-label="Decrease top_k"
        disabled={value <= min}
        onClick={() => set(value - 1)}
        className="flex w-6 items-center justify-center text-text-secondary transition-colors hover:text-accent disabled:opacity-40 disabled:pointer-events-none"
      >
        −
      </button>
      <span
        aria-live="polite"
        className="flex min-w-8 items-center justify-center border-x border-hairline px-1 font-mono text-[0.8125rem] text-text-primary [font-variant-numeric:tabular-nums] [font-feature-settings:'tnum'_1,'ss01'_1]"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase top_k"
        disabled={value >= max}
        onClick={() => set(value + 1)}
        className="flex w-6 items-center justify-center text-text-secondary transition-colors hover:text-accent disabled:opacity-40 disabled:pointer-events-none"
      >
        +
      </button>
    </div>
  );
}
