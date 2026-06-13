import { cn } from "@/lib/utils";
import { serviceColor } from "@/lib/utils";

export interface ServiceBadgeProps {
  serviceId: string;
  className?: string;
  /** Render only the colored tick (no label). */
  tickOnly?: boolean;
}

/**
 * Small mono pill: a service-color tick + the service id. Color is hashed
 * deterministically per id so a given service always renders the same hue.
 */
export function ServiceBadge({
  serviceId,
  className,
  tickOnly,
}: ServiceBadgeProps) {
  const color = serviceColor(serviceId);
  if (tickOnly) {
    return (
      <span
        aria-hidden
        className={cn("inline-block h-2 w-2 shrink-0 rounded-[2px]", className)}
        style={{ backgroundColor: color }}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-5 px-1.5",
        "rounded-[var(--radius-sm)] border border-hairline bg-raised",
        "font-mono text-[0.6875rem] leading-none text-text-secondary",
        "[font-feature-settings:'tnum'_1,'ss01'_1]",
        className,
      )}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color }}
      />
      {serviceId}
    </span>
  );
}
