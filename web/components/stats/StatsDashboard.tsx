"use client";

import * as React from "react";
import Link from "next/link";
import type { ProxyError, StatsResponse } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { Badge, Button } from "@/components/ui";
import { StatCard } from "./StatCard";
import { ServiceTable } from "./ServiceTable";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: StatsResponse }
  | { status: "error"; message: string; unreachable: boolean };

const nf = new Intl.NumberFormat("en-US");

/** Type guard for the proxy's { error } body. */
function isProxyError(value: unknown): value is ProxyError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ProxyError).error === "string"
  );
}

/** Best-effort, locale-stable ISO -> readable absolute string for tooltips. */
function isoTooltip(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toUTCString();
}

/**
 * Client-side stats dashboard. Fetches the /api/stats proxy (never :8080
 * directly), and renders loading / error / unreachable / empty / ready states.
 * Includes a Retry affordance that re-issues the request.
 */
export function StatsDashboard() {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  // Bump to force a re-fetch (Retry button).
  const [nonce, setNonce] = React.useState(0);
  // Re-render the relative-time line periodically so "indexed_at" stays fresh.
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/stats", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });

        const raw = await res.text();
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }

        if (!active) return;

        if (!res.ok) {
          // The proxy returns 502 + { error } when the Go backend is down.
          const message = isProxyError(parsed)
            ? parsed.error
            : raw || `Request failed with status ${res.status}`;
          const unreachable =
            res.status === 502 ||
            res.status === 503 ||
            res.status === 504 ||
            /upstream|unreachable|failed|refused|connect/i.test(message);
          setState({ status: "error", message, unreachable });
          return;
        }

        if (!isStatsResponse(parsed)) {
          setState({
            status: "error",
            message: "Malformed stats payload from server.",
            unreachable: false,
          });
          return;
        }

        setState({ status: "ready", data: parsed });
      } catch (err) {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Network request failed";
        setState({ status: "error", message, unreachable: true });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [nonce]);

  // Keep the relative timestamp live while data is shown.
  React.useEffect(() => {
    if (state.status !== "ready") return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [state.status]);

  const retry = React.useCallback(() => {
    // Show the loading state immediately on user intent (not inside the
    // effect, which would trigger a cascading render), then re-fetch.
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Header state={state} onRetry={retry} />

      {state.status === "loading" && <DashboardSkeleton />}

      {state.status === "error" && (
        <ErrorState
          message={state.message}
          unreachable={state.unreachable}
          onRetry={retry}
        />
      )}

      {state.status === "ready" && <ReadyView data={state.data} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

function Header({
  state,
  onRetry,
}: {
  state: LoadState;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="cyan" dot>
            INDEX
          </Badge>
          <span className="text-meta text-text-muted">
            GET /api/v1/stats
          </span>
        </div>
        <h1 className="text-h1">
          Index statistics
          <span className="text-accent">.</span>
        </h1>
        <p className="text-small text-text-secondary max-w-[68ch]">
          Corpus coverage across indexed AWS services — document and chunk
          counts, freshness, and per-service share of the retrieval index.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <StatusPill state={state} />
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          disabled={state.status === "loading"}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: LoadState }) {
  if (state.status === "loading") {
    return (
      <Badge tone="info" dot>
        LOADING
      </Badge>
    );
  }
  if (state.status === "error") {
    return (
      <Badge tone={state.unreachable ? "warning" : "error"} dot>
        {state.unreachable ? "OFFLINE" : "ERROR"}
      </Badge>
    );
  }
  return (
    <Badge tone="success" dot>
      LIVE
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* Ready view: stat band + service table                                      */
/* -------------------------------------------------------------------------- */

function ReadyView({ data }: { data: StatsResponse }) {
  const isEmpty =
    data.services.length === 0 &&
    data.total_documents === 0 &&
    data.total_chunks === 0;

  const indexedRel = data.indexed_at
    ? relativeTime(data.indexed_at)
    : "unknown";
  const indexedTip = data.indexed_at ? isoTooltip(data.indexed_at) : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* 64px+ top stat band — 4 tiles, responsive grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="TOTAL DOCUMENTS"
          value={nf.format(data.total_documents)}
          hint="indexed docs"
          tickColor="var(--accent)"
        />
        <StatCard
          label="TOTAL CHUNKS"
          value={nf.format(data.total_chunks)}
          hint="embedded chunks"
          tickColor="var(--cyan)"
        />
        <StatCard
          label="SERVICES"
          value={nf.format(data.services.length)}
          hint="covered"
          tickColor="var(--info)"
        />
        <StatCard
          label="INDEXED"
          value={indexedRel}
          hint={indexedTip}
          title={indexedTip}
          tickColor="var(--success)"
        />
      </div>

      {/* Per-service breakdown */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-h2">Per-service breakdown</h2>
          <span className="text-meta text-text-muted">
            {nf.format(data.services.length)}{" "}
            {data.services.length === 1 ? "service" : "services"}
          </span>
        </div>

        {isEmpty || data.services.length === 0 ? (
          <EmptyState />
        ) : (
          <ServiceTable services={data.services} />
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[88px] rounded-[var(--radius-md)] border border-hairline bg-panel"
          >
            <div className="h-full w-full shimmer rounded-[var(--radius-md)]" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-panel">
        <div className="h-10 border-b border-hairline" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-11 border-b border-hairline last:border-b-0"
          >
            <div className="h-full w-full shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] bg-panel px-6 py-12 text-center">
      <Badge tone="info" dot>
        EMPTY INDEX
      </Badge>
      <p className="text-body text-text-secondary max-w-[48ch]">
        No services have been indexed yet. Once the crawler ingests AWS
        documentation, per-service document and chunk counts will appear here.
      </p>
      <Link
        href="/"
        className="text-small text-cyan hover:underline underline-offset-4"
      >
        Go to search →
      </Link>
    </div>
  );
}

function ErrorState({
  message,
  unreachable,
  onRetry,
}: {
  message: string;
  unreachable: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-[var(--error)] bg-[var(--error-tint)] px-5 py-5">
      <div className="flex items-center gap-2">
        <Badge tone={unreachable ? "warning" : "error"} dot>
          {unreachable ? "BACKEND UNREACHABLE" : "REQUEST FAILED"}
        </Badge>
      </div>
      <p className="text-body text-text-primary max-w-[64ch]">
        {unreachable
          ? "Couldn't reach the CloudSearch API. The Go backend on port 8080 may be offline, or the proxy upstream is misconfigured."
          : "The stats request failed. See the error detail below and retry."}
      </p>
      <pre className="max-w-full overflow-x-auto rounded-[var(--radius-sm)] border border-hairline bg-app px-3 py-2 font-mono text-meta text-error">
        {message}
      </pre>
      {unreachable && (
        <p className="text-small text-text-muted max-w-[64ch]">
          Start it with{" "}
          <code className="font-mono text-text-secondary">
            go run ./cmd/server
          </code>{" "}
          (or set{" "}
          <code className="font-mono text-text-secondary">BACKEND_URL</code>),
          then retry.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function isStatsResponse(value: unknown): value is StatsResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.total_documents === "number" &&
    typeof v.total_chunks === "number" &&
    typeof v.indexed_at === "string" &&
    Array.isArray(v.services) &&
    v.services.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>).service_name === "string" &&
        typeof (s as Record<string, unknown>).documents === "number" &&
        typeof (s as Record<string, unknown>).chunks === "number",
    )
  );
}
