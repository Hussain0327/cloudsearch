import type { Fact, FactCategory, FilingCounts } from "@/lib/filings-types";

/** CSS color per category (tokens defined in app/globals.css). */
export const CATEGORY_COLOR: Record<FactCategory, string> = {
  revenue: "var(--cat-revenue)",
  debt: "var(--cat-debt)",
  shares: "var(--cat-shares)",
  other: "var(--cat-other)",
};

export const EMPTY_COUNTS: FilingCounts = { revenue: 0, debt: 0, shares: 0, other: 0 };

/** Count facts per category. */
export function countByCategory(facts: readonly Fact[]): FilingCounts {
  const counts: FilingCounts = { ...EMPTY_COUNTS };
  for (const f of facts) counts[f.category] += 1;
  return counts;
}

/** $3.25T / $391.0B / $12.4M / $950K / $42 */
export function formatMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const scaled = abs / div;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${sign}$${scaled.toFixed(digits)}${suffix}`;
    }
  }
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** 3.600% — keep three decimals like the filings print them. */
export function formatPercent(value: number): string {
  return `${value.toFixed(3)}%`;
}

/** 14,776,353,000 */
export function formatShares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * The mono "value" cell for a Found row. Prefers the parsed numeric value in
 * its unit; falls back to the raw span text when there is nothing to format.
 */
export function formatFactValue(fact: Fact): string {
  const v = fact.value_numeric;
  if (v === null || v === undefined || Number.isNaN(v)) return fact.raw_text;
  switch (fact.kind) {
    case "money":
      return formatMoney(v);
    case "percent":
      return formatPercent(v);
    case "shares":
      return formatShares(v);
    default:
      if (fact.unit === "USD") return formatMoney(v);
      if (fact.unit === "percent") return formatPercent(v);
      if (fact.unit === "shares") return formatShares(v);
      return fact.raw_text;
  }
}

/** "2025-09-27" -> "Sep 27, 2025"; null -> "". */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
