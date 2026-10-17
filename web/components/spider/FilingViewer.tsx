"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/facts-format";
import type { Fact, FactCategory, Filing, FilingDetail, FilingLink } from "@/lib/filings-types";
import {
  apiCrawlSource,
  mockCrawlSource,
  useCrawlStream,
  type CrawlSource,
} from "@/lib/useCrawlStream";
import { DEMO_ENABLED, DEMO_FACTS, DEMO_FILING, DEMO_HTML, DEMO_LINKS } from "@/lib/spider-demo";
import { useIsClient } from "@/lib/useIsClient";
import { SpiderStage } from "./SpiderStage";
import { FoundPanel } from "./FoundPanel";

type Speed = "slow" | "normal" | "fast";
const SPEED_MS: Record<Speed, number> = { slow: 400, normal: 120, fast: 30 };

interface Loaded {
  filing: Filing;
  html: string;
  /** Pre-known links (used for the "not indexed" state before the stream reaches them). */
  links: FilingLink[];
}

/**
 * The /filings/[id] experience: loads filing metadata and the annotated
 * document, then drives the crawl stream, the spider stage, and the Found
 * panel. `id === "demo"` with NEXT_PUBLIC_SPIDER_DEMO=1 runs offline.
 */
export function FilingViewer({ id }: { id: string }) {
  const isDemo = id === "demo" && DEMO_ENABLED;
  const searchParams = useSearchParams();
  const autoplay = searchParams.get("autoplay") === "1";

  // Fetch result keyed by id so a stale result for a previous id reads as
  // "still loading" instead of flashing the old filing.
  const [fetched, setFetched] = React.useState<{
    id: string;
    loaded: Loaded | null;
    error: string | null;
    notFound: boolean;
  } | null>(null);

  const [speed, setSpeed] = React.useState<Speed>("normal");
  const [follow, setFollow] = React.useState(true);
  // A row click pins the spider to a fact until the stream delivers a new one.
  const [pin, setPin] = React.useState<{ fact: Fact; at: Fact | null } | null>(null);

  // The document is prepared with DOMParser, so only render it on the client.
  const isClient = useIsClient();
  const demoLoaded = React.useMemo<Loaded | null>(
    () =>
      isDemo && isClient ? { filing: DEMO_FILING, html: DEMO_HTML, links: DEMO_LINKS } : null,
    [isDemo, isClient],
  );

  // Load metadata + document.
  React.useEffect(() => {
    if (isDemo) return;
    let cancelled = false;

    (async () => {
      try {
        const [metaRes, docRes] = await Promise.all([
          fetch(`/api/filings/${id}`, { headers: { Accept: "application/json" } }),
          fetch(`/api/filings/${id}/document`, { headers: { Accept: "text/html" } }),
        ]);
        if (metaRes.status === 404 || docRes.status === 404) {
          if (!cancelled) setFetched({ id, loaded: null, error: null, notFound: true });
          return;
        }
        if (!metaRes.ok) throw new Error(await errorMessage(metaRes));
        if (!docRes.ok) throw new Error(await errorMessage(docRes));
        const detail = (await metaRes.json()) as FilingDetail;
        const html = await docRes.text();
        if (!cancelled) {
          setFetched({
            id,
            loaded: { filing: detail.filing, html, links: detail.links ?? [] },
            error: null,
            notFound: false,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setFetched({
            id,
            loaded: null,
            error: err instanceof Error ? err.message : "Failed to load filing",
            notFound: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, isDemo]);

  const current = fetched && fetched.id === id ? fetched : null;
  const loaded = demoLoaded ?? current?.loaded ?? null;
  const loadError = current?.error ?? null;
  const notFound = current?.notFound ?? false;

  const source = React.useMemo<CrawlSource>(
    () =>
      isDemo
        ? mockCrawlSource({
            start: {
              filing_id: DEMO_FILING.id,
              ticker: DEMO_FILING.ticker,
              company_name: DEMO_FILING.company_name,
              total: DEMO_FILING.fact_count,
            },
            facts: DEMO_FACTS,
            links: DEMO_LINKS,
          })
        : apiCrawlSource(id),
    [id, isDemo],
  );

  const crawl = useCrawlStream(source, { paceMs: SPEED_MS[speed] });

  // Autoplay once the document is in the DOM.
  const autoStarted = React.useRef(false);
  React.useEffect(() => {
    if (!loaded || !autoplay || autoStarted.current) return;
    autoStarted.current = true;
    const t = window.setTimeout(() => crawl.play(), 250);
    return () => window.clearTimeout(t);
  }, [loaded, autoplay, crawl]);

  const onSpeed = (next: Speed) => {
    setSpeed(next);
    crawl.setPace(SPEED_MS[next]);
  };

  const onFilter = (cats: FactCategory[]) => crawl.setCategories(cats);

  const playing = crawl.status === "playing" || crawl.status === "loading";
  const activeFact = pin && pin.at === crawl.currentFact ? pin.fact : crawl.currentFact;
  const total = crawl.start?.total ?? loaded?.filing.fact_count ?? 0;
  const links = crawl.links;
  const onSelect = React.useCallback(
    (fact: Fact) => setPin({ fact, at: crawl.currentFact }),
    [crawl.currentFact],
  );

  /* ------------------------------------------------------------------ */

  if (notFound) {
    return (
      <StateShell title="Filing not found">
        <p className="text-small text-text-secondary">
          No indexed filing with id <span className="font-mono">{id}</span>.
        </p>
        <Link href="/filings" className="text-small text-cyan hover:underline">
          Back to filings
        </Link>
      </StateShell>
    );
  }

  if (loadError) {
    return (
      <StateShell title="Could not load filing">
        <p className="font-mono text-[0.75rem] text-error">{loadError}</p>
        <p className="text-small text-text-secondary">
          Is the Go API running on <span className="font-mono">:8080</span>?
        </p>
      </StateShell>
    );
  }

  if (!loaded) {
    return (
      <StateShell title="Loading filing">
        <Spinner className="text-text-muted" />
      </StateShell>
    );
  }

  const { filing, html } = loaded;

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      {/* Top strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-app/85 px-4 py-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/filings" className="text-text-muted hover:text-text-primary" aria-label="All filings">
            &larr;
          </Link>
          <span className="truncate text-h2 font-display font-bold tracking-[-0.01em]">
            {filing.company_name}
          </span>
          <Badge tone="cyan">{filing.ticker}</Badge>
          <Badge tone="muted">{filing.form_type}</Badge>
          {filing.period_of_report && (
            <span className="hidden text-meta text-text-muted sm:inline">
              FYE {formatDate(filing.period_of_report)}
            </span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={playing ? "secondary" : "primary"}
            onClick={crawl.status === "done" ? crawl.restart : crawl.toggle}
            aria-label={playing ? "Pause" : crawl.status === "done" ? "Replay" : "Play"}
            className="min-w-[76px]"
          >
            {playing ? "Pause" : crawl.status === "done" ? "Replay" : "Play"}
          </Button>
          {crawl.facts.length > 0 && crawl.status !== "done" && (
            <Button size="sm" variant="ghost" onClick={crawl.restart}>
              Restart
            </Button>
          )}

          <label className="flex items-center gap-1.5 text-meta text-text-muted">
            <span>speed</span>
            <select
              value={speed}
              onChange={(e) => onSpeed(e.target.value as Speed)}
              className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-raised px-1.5 font-mono text-[0.75rem] text-text-primary"
            >
              <option value="slow">slow</option>
              <option value="normal">normal</option>
              <option value="fast">fast</option>
            </select>
          </label>

          <button
            type="button"
            role="switch"
            aria-checked={follow}
            onClick={() => setFollow((f) => !f)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 text-[0.75rem] transition-colors",
              follow
                ? "border-cyan bg-cyan-tint text-cyan"
                : "border-hairline text-text-secondary hover:text-text-primary",
            )}
          >
            <span
              aria-hidden
              className={cn("h-1.5 w-1.5 rounded-full", follow ? "bg-cyan" : "bg-text-muted")}
            />
            Follow spider
          </button>

          <span className="font-mono text-[0.75rem] text-text-secondary [font-variant-numeric:tabular-nums]">
            {crawl.facts.length} of {total} found
          </span>
        </div>
      </div>

      {crawl.error && (
        <div className="border-b border-error/40 bg-error-tint px-4 py-1.5 font-mono text-[0.75rem] text-error">
          {crawl.error}
        </div>
      )}

      {/* Body */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Paper */}
        <div className="min-h-0 overflow-y-auto bg-[#e3e6ea] px-3 py-6 pb-[44vh] lg:pb-10">
          <div className="paper mx-auto w-full max-w-[900px] bg-white px-10 py-12 text-[#111] shadow-[0_1px_2px_rgba(0,0,0,0.18),0_12px_40px_rgba(0,0,0,0.12)]">
            <SpiderStage
              html={html}
              facts={crawl.facts}
              activeFact={activeFact}
              playing={playing}
              follow={follow}
            />
          </div>
        </div>

        {/* Found panel (right rail, >= lg) */}
        <aside className="hidden min-h-0 border-l border-hairline bg-panel lg:flex lg:flex-col">
          <FoundPanel
            companyName={filing.company_name}
            ticker={filing.ticker}
            facts={crawl.facts}
            links={links}
            total={total}
            activeFact={activeFact}
            filter={crawl.options.categories}
            onFilterChange={onFilter}
            onSelect={onSelect}
            className="min-h-0 flex-1"
          />
        </aside>
      </div>

      {/* Found panel (bottom sheet, < lg) */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex h-[40vh] flex-col rounded-t-[var(--radius-lg)] border-t border-hairline bg-panel shadow-[0_-8px_30px_rgba(0,0,0,0.35)] lg:hidden">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong" />
        <FoundPanel
          companyName={filing.company_name}
          ticker={filing.ticker}
          facts={crawl.facts}
          links={links}
          total={total}
          activeFact={activeFact}
          filter={crawl.options.categories}
          onFilterChange={onFilter}
          onSelect={onSelect}
          className="min-h-0 flex-1"
        />
      </div>
    </div>
  );
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* fall through */
  }
  return `Request failed (${res.status})`;
}

function StateShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-4 py-16">
      <h1 className="text-h1">{title}</h1>
      {children}
    </div>
  );
}
