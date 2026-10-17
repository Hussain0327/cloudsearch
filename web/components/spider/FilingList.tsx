"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import {
  CATEGORY_LABELS,
  FACT_CATEGORIES,
  type Filing,
  type FilingListResponse,
} from "@/lib/filings-types";
import { CATEGORY_COLOR, formatDate } from "@/lib/facts-format";
import { DEMO_ENABLED, DEMO_FILING } from "@/lib/spider-demo";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; filings: Filing[] };

/** Cards for every indexed filing, plus the offline demo card when enabled. */
export function FilingList() {
  const [state, setState] = React.useState<State>({ status: "loading" });

  // Shared fetch; resolves to the next state rather than setting it, so the
  // mount effect can commit asynchronously with a cancel guard.
  const fetchFilings = React.useCallback(async (): Promise<State> => {
    try {
      const res = await fetch("/api/filings", { headers: { Accept: "application/json" } });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) message = j.error;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }
      const body = (await res.json()) as FilingListResponse;
      return { status: "ready", filings: body.filings ?? [] };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load filings",
      };
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    fetchFilings().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchFilings]);

  const retry = () => {
    setState({ status: "loading" });
    void fetchFilings().then(setState);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Filings</h1>
        <p className="max-w-[64ch] text-small text-text-secondary">
          Indexed Form 10-Ks. Open one and the spider walks it, lighting up every revenue,
          debt and financing, and share figure it finds.
        </p>
      </header>

      {state.status === "loading" && (
        <div className="flex items-center gap-2 text-small text-text-muted">
          <Spinner size={14} /> loading filings
        </div>
      )}

      {state.status === "error" && (
        <Card className="flex flex-col gap-2 p-4">
          <span className="font-mono text-[0.75rem] text-error">{state.message}</span>
          <span className="text-small text-text-secondary">
            Is the Go API running on <span className="font-mono">:8080</span>?
          </span>
          <div>
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {state.status === "ready" && state.filings.length === 0 && !DEMO_ENABLED && (
        <Card className="flex flex-col gap-2 p-4">
          <span className="text-small text-text-primary">No filings indexed yet.</span>
          <span className="text-small text-text-secondary">
            Seed the demo set from the repo root with{" "}
            <code className="rounded-[var(--radius-sm)] bg-raised px-1 py-0.5 font-mono text-[0.75rem]">
              make edgar-seed
            </code>{" "}
            or ingest live filings with{" "}
            <code className="rounded-[var(--radius-sm)] bg-raised px-1 py-0.5 font-mono text-[0.75rem]">
              make edgar-ingest TICKERS=&quot;AAPL MSFT&quot;
            </code>
            .
          </span>
        </Card>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DEMO_ENABLED && <FilingCard filing={DEMO_FILING} href="/filings/demo?autoplay=1" demo />}
        {state.status === "ready" &&
          state.filings.map((f) => <FilingCard key={f.id} filing={f} href={`/filings/${f.id}`} />)}
      </ul>
    </div>
  );
}

function FilingCard({ filing, href, demo }: { filing: Filing; href: string; demo?: boolean }) {
  const total = Math.max(1, filing.fact_count);
  return (
    <li>
      <Link href={href} className="block focus-visible:outline-none">
        <Card interactive className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.9375rem] font-semibold text-text-primary">
              {filing.ticker}
            </span>
            <Badge tone="muted">{filing.form_type}</Badge>
            {demo && <Badge tone="warning">demo</Badge>}
            <span className="ml-auto font-mono text-[0.75rem] text-text-secondary [font-variant-numeric:tabular-nums]">
              {filing.fact_count} facts
            </span>
          </div>
          <div className="flex flex-col">
            <span className="truncate text-body font-semibold">{filing.company_name}</span>
            <span className="text-meta text-text-muted">
              {filing.period_of_report ? `FYE ${formatDate(filing.period_of_report)}` : "period n/a"}
              {filing.fiscal_year ? ` · FY${filing.fiscal_year}` : ""}
            </span>
          </div>
          {/* 4-segment category bar */}
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
            {FACT_CATEGORIES.map((cat) => (
              <span
                key={cat}
                style={{
                  width: `${(filing.counts[cat] / total) * 100}%`,
                  backgroundColor: CATEGORY_COLOR[cat],
                }}
              />
            ))}
          </div>
          <dl className="grid grid-cols-4 gap-1 text-[0.6875rem]">
            {FACT_CATEGORIES.map((cat) => (
              <div key={cat} className="flex flex-col">
                <dt className="truncate text-text-muted" title={CATEGORY_LABELS[cat]}>
                  {CATEGORY_LABELS[cat]}
                </dt>
                <dd className="font-mono text-text-primary" style={{ color: CATEGORY_COLOR[cat] }}>
                  {filing.counts[cat]}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </Link>
    </li>
  );
}
