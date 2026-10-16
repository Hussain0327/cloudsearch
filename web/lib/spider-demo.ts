import type { Fact, FilingLink, Filing } from "@/lib/filings-types";

/**
 * Offline fixture for the viewer, enabled with NEXT_PUBLIC_SPIDER_DEMO=1.
 * A short cover-page style document with cs-fact spans plus the matching
 * facts/links, so the spider can be exercised with no backend.
 */

export const DEMO_ENABLED = process.env.NEXT_PUBLIC_SPIDER_DEMO === "1";

export const DEMO_FILING: Filing = {
  id: 0,
  cik: "0000000000",
  ticker: "DEMO",
  company_name: "Demo Holdings Inc.",
  form_type: "10-K",
  accession_number: "0000000000-25-000001",
  filed_at: "2025-10-31",
  period_of_report: "2025-09-27",
  fiscal_year: 2025,
  source_url: "https://www.sec.gov/",
  fact_count: 12,
  counts: { revenue: 2, debt: 6, shares: 1, other: 3 },
  updated_at: "2026-10-16T00:00:00Z",
};

function span(id: string, category: string, kind: string, text: string): string {
  return `<span class="cs-fact" id="${id}" data-fact-id="${id}" data-category="${category}" data-kind="${kind}">${text}</span>`;
}

export const DEMO_HTML = `
<div style="font-family: Georgia, serif; font-size: 14px; line-height: 1.5;">
  <p style="text-align:center;font-weight:bold;font-size:16px;margin:0">UNITED STATES<br/>SECURITIES AND EXCHANGE COMMISSION<br/>Washington, D.C. 20549</p>
  <p style="text-align:center;font-weight:bold;font-size:20px;margin:18px 0 4px">FORM 10-K</p>
  <p style="text-align:center;margin:0">(Mark One)</p>
  <p style="margin:12px 0 0">&#9746; ANNUAL REPORT PURSUANT TO SECTION 13 OR 15(d) OF THE SECURITIES EXCHANGE ACT OF 1934</p>
  <p style="margin:4px 0 0">For the fiscal year ended ${span("f-00000", "other", "date", "September 27, 2025")}</p>
  <p style="text-align:center;font-weight:bold;font-size:22px;margin:28px 0 2px">Demo Holdings Inc.</p>
  <p style="text-align:center;margin:0">(Exact name of Registrant as specified in its charter)</p>
  <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:13px">
    <tr><td style="border-bottom:1px solid #000;padding:4px 6px">Title of each class</td><td style="border-bottom:1px solid #000;padding:4px 6px">Trading symbol(s)</td><td style="border-bottom:1px solid #000;padding:4px 6px">Name of each exchange on which registered</td></tr>
    <tr><td style="padding:4px 6px">Common Stock, $0.00001 par value per share</td><td style="padding:4px 6px">DEMO</td><td style="padding:4px 6px">The Nasdaq Stock Market LLC</td></tr>
    <tr><td style="padding:4px 6px">${span("f-00001", "debt", "percent", "1.375% Notes due 2029")}</td><td style="padding:4px 6px">&mdash;</td><td style="padding:4px 6px">The Nasdaq Stock Market LLC</td></tr>
    <tr><td style="padding:4px 6px">${span("f-00002", "debt", "percent", "3.050% Notes due 2029")}</td><td style="padding:4px 6px">&mdash;</td><td style="padding:4px 6px">The Nasdaq Stock Market LLC</td></tr>
    <tr><td style="padding:4px 6px">${span("f-00003", "debt", "percent", "0.500% Notes due 2031")}</td><td style="padding:4px 6px">&mdash;</td><td style="padding:4px 6px">The Nasdaq Stock Market LLC</td></tr>
    <tr><td style="padding:4px 6px">${span("f-00004", "debt", "percent", "3.600% Notes due 2042")}</td><td style="padding:4px 6px">&mdash;</td><td style="padding:4px 6px">The Nasdaq Stock Market LLC</td></tr>
  </table>
  <p style="margin:28px 0 0">The aggregate market value of the voting and non-voting stock held by non-affiliates of the Registrant, as of March 28, 2025, was approximately ${span("f-00005", "other", "money", "$3,253,431,000,000")}. Solely for purposes of this disclosure, shares of common stock held by executive officers and directors of the Registrant as of such date have been excluded.</p>
  <p style="margin:12px 0 0;text-align:center">${span("f-00006", "shares", "shares", "14,776,353,000 shares")} of common stock were issued and outstanding as of October 17, 2025.</p>
  <p style="text-align:center;font-weight:bold;margin:36px 0 6px">PART II</p>
  <p style="font-weight:bold;margin:0">Item 7. Management&rsquo;s Discussion and Analysis of Financial Condition and Results of Operations</p>
  <p style="margin:8px 0 0">Total net sales for fiscal 2025 were ${span("f-00007", "revenue", "money", "$416.2 billion")}, an increase of 6% compared to fiscal 2024. Services net sales increased to ${span("f-00008", "revenue", "money", "$109.2 billion")} driven by advertising, cloud services and the App Store. The Company competes with ${span("f-00009", "other", "entity", "Microsoft")} and others in several of its markets.</p>
  <p style="margin:8px 0 0">As of September 27, 2025, the Company had outstanding fixed-rate notes with varying maturities and a total carrying amount of ${span("f-00010", "debt", "money", "$91.8 billion")}, of which ${span("f-00011", "debt", "money", "$10.9 billion")} is payable within 12 months.</p>
  <p style="margin:8px 0 0;height:320px"></p>
  <p style="margin:0;color:#666;font-size:12px">End of demo document.</p>
</div>`;

function fact(
  i: number,
  category: Fact["category"],
  kind: Fact["kind"],
  raw: string,
  label: string,
  value: number | null,
  unit: string | null,
  section: string,
  concept: string | null = null,
): Fact {
  return {
    id: i + 1,
    filing_id: 0,
    fact_index: i,
    dom_id: `f-${String(i).padStart(5, "0")}`,
    category,
    kind,
    raw_text: raw,
    label,
    value_numeric: value,
    unit,
    context: raw,
    section,
    concept,
    source: concept ? "ixbrl" : kind === "entity" ? "entity" : "regex",
  };
}

export const DEMO_FACTS: Fact[] = [
  fact(0, "other", "date", "September 27, 2025", "fiscal year ended", null, null, "Cover", "dei:DocumentPeriodEndDate"),
  fact(1, "debt", "percent", "1.375% Notes due 2029", "Notes due 2029", 1.375, "percent", "Cover", "dei:Security12bTitle"),
  fact(2, "debt", "percent", "3.050% Notes due 2029", "Notes due 2029", 3.05, "percent", "Cover", "dei:Security12bTitle"),
  fact(3, "debt", "percent", "0.500% Notes due 2031", "Notes due 2031", 0.5, "percent", "Cover", "dei:Security12bTitle"),
  fact(4, "debt", "percent", "3.600% Notes due 2042", "Notes due 2042", 3.6, "percent", "Cover", "dei:Security12bTitle"),
  fact(5, "other", "money", "$3,253,431,000,000", "aggregate market value of the voting", 3253431000000, "USD", "Cover", "dei:EntityPublicFloat"),
  fact(6, "shares", "shares", "14,776,353,000 shares", "shares outstanding", 14776353000, "shares", "Cover", "dei:EntityCommonStockSharesOutstanding"),
  fact(7, "revenue", "money", "$416.2 billion", "Total net sales", 416.2e9, "USD", "Item 7"),
  fact(8, "revenue", "money", "$109.2 billion", "Services net sales", 109.2e9, "USD", "Item 7"),
  fact(9, "other", "entity", "Microsoft", "Microsoft", null, null, "Item 7"),
  fact(10, "debt", "money", "$91.8 billion", "notes carrying amount", 91.8e9, "USD", "Item 7"),
  fact(11, "debt", "money", "$10.9 billion", "payable within 12 months", 10.9e9, "USD", "Item 7"),
];

export const DEMO_LINKS: FilingLink[] = [
  {
    id: 1,
    filing_id: 0,
    fact_index: 9,
    dom_id: "f-00009",
    target_ticker: "MSFT",
    target_filing_id: null,
    mention_text: "Microsoft",
  },
];
