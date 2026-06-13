import * as React from "react";
import { cn } from "@/lib/utils";

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Diameter in px. */
  size?: number;
}

/** Minimal indeterminate ring spinner using currentColor. */
export function Spinner({ size = 16, className, style, ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block animate-spin align-[-0.125em]", className)}
      style={{
        width: size,
        height: size,
        border: `2px solid color-mix(in srgb, currentColor 25%, transparent)`,
        borderTopColor: "currentColor",
        borderRadius: "999px",
        ...style,
      }}
      {...props}
    />
  );
}
