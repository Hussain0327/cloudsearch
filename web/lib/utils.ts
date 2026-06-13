/**
 * Small, dependency-free utilities shared across the UI.
 */

type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

/** Join conditional class names. Lightweight clsx replacement. */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === "string" || typeof input === "number") {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) out.push(nested);
    } else if (typeof input === "object") {
      for (const [key, value] of Object.entries(input)) {
        if (value) out.push(key);
      }
    }
  }
  return out.join(" ");
}

/**
 * Deterministic per-service accent color. Used for ServiceBadge ticks and the
 * left rail status ticks so a given service id always renders the same hue.
 */
const SERVICE_PALETTE = [
  "#F5A623", // amber
  "#3DD6D0", // cyan
  "#5B9BD5", // info blue
  "#46C46A", // green
  "#E8B339", // warning gold
  "#A78BFA", // violet (used sparingly, ticks only — not UI chrome)
  "#F2545B", // red
  "#FF8C42", // orange
  "#6EE7B7", // mint
  "#7DD3FC", // sky
] as const;

/** Stable hash -> palette index for a service id. */
export function serviceColor(serviceId: string): string {
  let hash = 0;
  for (let i = 0; i < serviceId.length; i++) {
    hash = (hash * 31 + serviceId.charCodeAt(i)) >>> 0;
  }
  return SERVICE_PALETTE[hash % SERVICE_PALETTE.length];
}

/**
 * Map a fusion score (RRF, typically 0..~1) onto the 5-stop heat scale.
 * low -> high relevance: muted, info, cyan, green, amber.
 */
const HEAT_SCALE = [
  "var(--heat-0)",
  "var(--heat-1)",
  "var(--heat-2)",
  "var(--heat-3)",
  "var(--heat-4)",
] as const;

export function scoreHeatColor(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  const idx = Math.min(HEAT_SCALE.length - 1, Math.floor(clamped * HEAT_SCALE.length));
  return HEAT_SCALE[idx];
}

/** Format a score to a fixed 3-decimal tabular string (e.g. "0.842"). */
export function formatScore(score: number): string {
  return score.toFixed(3);
}

/** Compact relative-time formatter for indexed_at ("3m ago", "2h ago"). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffSec = Math.round((now.getTime() - then) / 1000);
  const abs = Math.abs(diffSec);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [2592000, "day"],
    [31536000, "month"],
    [Infinity, "year"],
  ];
  const divisors = [1, 60, 3600, 86400, 2592000, 31536000];
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (let i = 0; i < units.length; i++) {
    if (abs < units[i][0]) {
      const value = Math.round(-diffSec / divisors[i]);
      return fmt.format(value, units[i][1]);
    }
  }
  return fmt.format(0, "second");
}
