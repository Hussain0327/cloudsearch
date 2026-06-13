import * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  // Amber primary action (Search button).
  primary:
    "bg-accent text-text-inverse font-semibold hover:bg-accent-hover active:bg-accent-press border border-transparent",
  // Hairline outline on panel.
  secondary:
    "bg-raised text-text-primary border border-[var(--border-strong)] hover:border-accent hover:text-accent",
  // Bare, for icon/utility buttons in the top bar.
  ghost:
    "bg-transparent text-text-secondary border border-transparent hover:text-text-primary hover:bg-[var(--raised)]",
  danger:
    "bg-[var(--error-tint)] text-error border border-[var(--error)] hover:bg-error hover:text-text-inverse",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[0.8125rem] rounded-[var(--radius-sm)] gap-1.5",
  md: "h-9 px-4 text-[0.875rem] rounded-[var(--radius-sm)] gap-2",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "secondary", size = "md", loading, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap transition-colors duration-100",
          "disabled:opacity-50 disabled:pointer-events-none select-none",
          SIZES[size],
          VARIANTS[variant],
          className,
        )}
        {...props}
      >
        {loading && <Spinner size={size === "sm" ? 12 : 14} />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
