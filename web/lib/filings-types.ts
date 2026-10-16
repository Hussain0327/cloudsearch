/**
 * API DTOs for the EDGAR Spider endpoints (Go backend, /api/v1/filings*).
 *
 * These mirror docs/EDGAR_SPIDER.md EXACTLY, including snake_case JSON keys.
 * The browser never calls the Go server directly; requests are proxied via
 * app/api/filings/* Route Handlers.
 */

export type FactCategory = "revenue" | "debt" | "shares" | "other";

export type FactKind = "money" | "percent" | "shares" | "date" | "entity" | "text";

export type FactSource = "ixbrl" | "regex" | "entity";

export const FACT_CATEGORIES: readonly FactCategory[] = [
  "revenue",
  "debt",
  "shares",
  "other",
] as const;

/** Display label per category, as shown in the Found panel chips. */
export const CATEGORY_LABELS: Record<FactCategory, string> = {
  revenue: "Revenue",
  debt: "Debt and financing",
  shares: "Shares",
  other: "Other",
};

/** Per-category fact counts. */
export interface FilingCounts {
  revenue: number;
  debt: number;
  shares: number;
  other: number;
}

/** One indexed Form 10-K (list + detail shape). */
export interface Filing {
  id: number;
  /** Zero-padded 10-digit CIK. */
  cik: string;
  ticker: string;
  company_name: string;
  form_type: string;
  accession_number: string;
  /** YYYY-MM-DD or null. */
  filed_at: string | null;
  /** YYYY-MM-DD or null. */
  period_of_report: string | null;
  fiscal_year: number | null;
  source_url: string;
  fact_count: number;
  counts: FilingCounts;
  /** ISO 8601. */
  updated_at: string;
}

/** One extracted fact, in document order by fact_index. */
export interface Fact {
  id: number;
  filing_id: number;
  /** 0-based document order. */
  fact_index: number;
  /** `f-00042`; equals data-fact-id in the annotated HTML. */
  dom_id: string;
  category: FactCategory;
  kind: FactKind;
  raw_text: string;
  label: string;
  value_numeric: number | null;
  /** "USD" | "percent" | "shares" | null */
  unit: string | null;
  context: string;
  /** "Cover", "Item 1A", ... or "" */
  section: string;
  concept: string | null;
  source: FactSource;
}

/** A company mention inside a filing that points to another filing. */
export interface FilingLink {
  id: number;
  filing_id: number;
  fact_index: number;
  dom_id: string;
  target_ticker: string;
  target_filing_id: number | null;
  mention_text: string;
}

/** GET /api/filings */
export interface FilingListResponse {
  filings: Filing[];
}

/** GET /api/filings/{id} and /api/filings/by-ticker/{ticker} */
export interface FilingDetail {
  filing: Filing;
  facts: Fact[];
  links: FilingLink[];
}

/** `event: start` payload on the crawl stream. */
export interface CrawlStartEvent {
  filing_id: number;
  ticker: string;
  company_name: string;
  /** The filing's fact_count. */
  total: number;
  /** How many facts this stream will emit after filtering. */
  streaming: number;
}

/**
 * Discriminated union of parsed SSE events from GET /api/filings/{id}/crawl.
 * Wire format per event: "event: <name>\n", optional "data: <payload>\n",
 * then a blank line. The "done" event carries no data.
 */
export type CrawlStreamEvent =
  | { type: "start"; data: CrawlStartEvent }
  | { type: "fact"; data: Fact }
  | { type: "link"; data: FilingLink }
  | { type: "error"; data: string }
  | { type: "done" };

/** Shape returned by the proxy route handlers when upstream is unreachable. */
export interface ProxyError {
  error: string;
}
