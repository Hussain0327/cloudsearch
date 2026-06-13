import * as React from "react";
import { cn } from "@/lib/utils";

export type KbdProps = React.HTMLAttributes<HTMLElement>;

/** Keyboard hint chip, e.g. the global ⌘K affordance in the top bar. */
export function Kbd({ className, children, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center gap-0.5 min-w-5 h-5 px-1.5",
        "font-mono text-[0.6875rem] leading-none text-text-secondary",
        "bg-raised border border-hairline rounded-[var(--radius-sm)]",
        "[font-feature-settings:'tnum'_1,'ss01'_1]",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
