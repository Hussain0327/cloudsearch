import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Use the slightly lighter raised surface instead of the flat panel. */
  raised?: boolean;
  /** Render an interactive (focusable, hover) card. */
  interactive?: boolean;
}

/**
 * Flat, hairline-bordered surface — the spec favors 1px dividers over heavy
 * cards, so this stays sharp (md radius) with no shadow by default.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, raised, interactive, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "border border-hairline rounded-[var(--radius-md)]",
          raised ? "bg-raised" : "bg-panel",
          interactive &&
            "transition-colors duration-100 hover:border-[var(--border-strong)] focus-within:border-cyan cursor-pointer",
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";
