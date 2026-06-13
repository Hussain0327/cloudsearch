"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useSearchStream } from "@/lib/useSearchStream";
import {
  SearchBar,
  ServiceFilterChips,
  AnswerView,
  CitationList,
  ResultMeta,
  RecentQueries,
  useRecentQueries,
  AnswerSkeleton,
  MetaSkeleton,
  SourcesSkeleton,
  EmptyState,
  ErrorState,
} from "@/components/search";

const TOP_K_DEFAULT = 10;

/**
 * The full search experience. Reads an optional `?services=` query param
 * (set when arriving from the Stats per-service table) to prefill the service
 * filter. Because it calls useSearchParams it must render under a <Suspense>
 * boundary — see the default export below.
 */
function SearchExperience() {
  const searchParams = useSearchParams();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Request controls. The service filter can be seeded from the URL
  // (?services=s3,lambda) when navigating in from the Stats table.
  const [query, setQuery] = React.useState("");
  const [topK, setTopK] = React.useState(TOP_K_DEFAULT);
  const [stream, setStream] = React.useState(true);
  const [services, setServices] = React.useState<string[]>(() => {
    const raw = searchParams.get("services");
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  });

  // Citation coordination (bidirectional chip <-> card).
  const [activeCite, setActiveCite] = React.useState<number | null>(null);
  const [flashCite, setFlashCite] = React.useState<number | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mobile filter bottom-sheet + tabbed Answer|Sources (< 1100px).
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [mobileTab, setMobileTab] = React.useState<"answer" | "sources">("answer");

  const search = useSearchStream();
  const { recent, add: addRecent, clear: clearRecent } = useRecentQueries();

  const isBusy = search.status === "loading" || search.status === "streaming";
  const hasResult =
    search.status === "done" ||
    search.status === "streaming" ||
    search.status === "error";

  const submit = React.useCallback(
    (forceStream: boolean) => {
      const q = query.trim();
      if (!q) {
        inputRef.current?.focus();
        return;
      }
      const useStream = forceStream || stream;
      addRecent(q);
      setActiveCite(null);
      setFlashCite(null);
      setMobileTab("answer");
      search.search({
        query: q,
        top_k: topK,
        services: services.length ? services : undefined,
        stream: useStream,
      });
    },
    [query, stream, topK, services, addRecent, search],
  );

  // Global ⌘K / "/" focuses the query input.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // Click an inline [N] chip: scroll to + flash the matching source card.
  const activateCite = React.useCallback((index: number) => {
    const card = document.getElementById(`cite-${index}`);
    if (!card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMobileTab("sources");
    // Defer scroll a frame so the Sources tab is mounted on small screens.
    requestAnimationFrame(() => {
      const el = document.getElementById(`cite-${index}`);
      el?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "nearest",
      });
      (el as HTMLElement | null)?.focus?.({ preventScroll: true });
    });
    setFlashCite(null);
    // Re-trigger the flash animation on the next tick.
    requestAnimationFrame(() => {
      setFlashCite(index);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashCite(null), 650);
    });
  }, []);

  const onChipHover = React.useCallback((index: number, hovering: boolean) => {
    setActiveCite(hovering ? index : null);
  }, []);

  const onCardActive = React.useCallback((index: number, active: boolean) => {
    setActiveCite(active ? index : null);
  }, []);

  const sourcesCount = search.citations.length;
  const showEmpty =
    search.status === "done" &&
    search.citations.length === 0 &&
    (search.meta?.chunks_found ?? 0) === 0;

  return (
    <div className="relative vignette-amber">
      <div className="relative z-10 mx-auto grid w-full max-w-[1600px] gap-6 px-2 py-4 lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* ---------------------------------------------------------------- */}
        {/* LEFT RAIL (>=1100px)                                              */}
        {/* ---------------------------------------------------------------- */}
        <aside className="hidden lg:block">
          <div className="sticky top-[72px] flex flex-col gap-5 border-r border-hairline pr-5">
            <ServiceFilterChips selected={services} onChange={setServices} />
            <RecentQueries
              queries={recent}
              onSelect={(q) => {
                setQuery(q);
                inputRef.current?.focus();
              }}
              onClear={clearRecent}
            />
          </div>
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* CENTER                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="sticky top-[56px] z-20 -mx-2 bg-app/85 px-2 pb-2 pt-3 backdrop-blur-md">
            <SearchBar
              ref={inputRef}
              query={query}
              onQueryChange={setQuery}
              topK={topK}
              onTopKChange={setTopK}
              stream={stream}
              onStreamChange={setStream}
              onSubmit={submit}
              onStop={search.stop}
              loading={isBusy}
              selectedCount={services.length}
              onOpenFilters={() => setFiltersOpen(true)}
            />
          </div>

          {/* Tab switcher (< 2xl, only when there are sources). */}
          {hasResult && sourcesCount > 0 && (
            <div className="flex items-center gap-1 border-b border-hairline 2xl:hidden">
              <TabButton
                active={mobileTab === "answer"}
                onClick={() => setMobileTab("answer")}
              >
                Answer
              </TabButton>
              <TabButton
                active={mobileTab === "sources"}
                onClick={() => setMobileTab("sources")}
              >
                Sources
                <span className="ml-1.5 font-mono text-[0.6875rem] text-text-muted">
                  [{sourcesCount}]
                </span>
              </TabButton>
            </div>
          )}

          {/* ANSWER PANEL */}
          <div
            className={cn(
              "min-h-[120px]",
              mobileTab === "sources" && sourcesCount > 0 && "hidden 2xl:block",
            )}
          >
            {search.status === "idle" && <IdleHint />}

            {search.status === "loading" && search.answer === "" && (
              <AnswerSkeleton />
            )}

            {search.status === "error" && search.answer === "" && (
              <ErrorState
                error={search.error ?? "Unknown error"}
                onRetry={search.retry}
              />
            )}

            {showEmpty ? (
              <EmptyState
                message={search.answer || undefined}
                hasFilters={services.length > 0}
                onClearFilters={() => setServices([])}
              />
            ) : (
              search.answer !== "" && (
                <AnswerView
                  answer={search.answer}
                  citations={search.citations}
                  streaming={search.status === "streaming"}
                  activeCite={activeCite}
                  onActivateCite={activateCite}
                  onChipHover={onChipHover}
                />
              )
            )}

            {/* Inline error if we already have partial answer text. */}
            {search.status === "error" && search.answer !== "" && (
              <div className="mt-4">
                <ErrorState
                  error={search.error ?? "Unknown error"}
                  onRetry={search.retry}
                />
              </div>
            )}
          </div>

          {/* META STRIP */}
          {(search.status === "loading" || search.status === "streaming") &&
            !search.meta && (
              <div className="border-t border-hairline pt-3">
                <MetaSkeleton />
              </div>
            )}
          {search.meta &&
            !(mobileTab === "sources" && sourcesCount > 0) && (
              <div className="sticky bottom-0 -mx-2 border-t border-hairline bg-app/85 px-2 py-2.5 backdrop-blur-md">
                <ResultMeta meta={search.meta} />
              </div>
            )}

          {/* SOURCES (tabbed, < 2xl) */}
          {sourcesCount > 0 && (
            <div
              className={cn(
                "2xl:hidden",
                mobileTab === "answer" ? "hidden" : "block",
              )}
            >
              <CitationList
                citations={search.citations}
                highlightIndex={activeCite}
                flashIndex={flashCite}
                onCardActive={onCardActive}
              />
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* RIGHT PANE (>=1400px / 2xl)                                       */}
        {/* ---------------------------------------------------------------- */}
        <aside className="hidden 2xl:block">
          <div className="sticky top-[72px] flex max-h-[calc(100vh-88px)] flex-col gap-3 overflow-y-auto border-l border-hairline pl-5">
            <div className="flex items-center justify-between">
              <span className="text-micro text-text-muted">sources</span>
              {sourcesCount > 0 && (
                <Badge tone="cyan">{sourcesCount}</Badge>
              )}
            </div>
            {isBusy && sourcesCount === 0 ? (
              <SourcesSkeleton />
            ) : sourcesCount > 0 ? (
              <CitationList
                citations={search.citations}
                highlightIndex={activeCite}
                flashIndex={flashCite}
                onCardActive={onCardActive}
              />
            ) : (
              <p className="text-small text-text-muted">
                Cited sources appear here, ordered by their [N] marker.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* FILTER BOTTOM-SHEET / DRAWER (< 1100px)                            */}
      {/* ------------------------------------------------------------------ */}
      {filtersOpen && (
        <FilterDrawer onClose={() => setFiltersOpen(false)}>
          <ServiceFilterChips selected={services} onChange={setServices} />
          <RecentQueries
            queries={recent}
            onSelect={(q) => {
              setQuery(q);
              setFiltersOpen(false);
              inputRef.current?.focus();
            }}
            onClear={clearRecent}
            className="mt-2"
          />
        </FilterDrawer>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Page entry. useSearchParams (read inside SearchExperience) requires a
 * <Suspense> boundary so the static shell can be prerendered while the param-
 * dependent tree is client-rendered. The fallback mirrors the page chrome to
 * avoid layout shift.
 */
export default function SearchPage() {
  return (
    <React.Suspense fallback={<SearchExperienceFallback />}>
      <SearchExperience />
    </React.Suspense>
  );
}

/** Minimal pre-hydration shell matching the search layout's first paint. */
function SearchExperienceFallback() {
  return (
    <div className="relative vignette-amber">
      <div className="relative z-10 mx-auto grid w-full max-w-[1600px] gap-6 px-2 py-4 lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside className="hidden lg:block" aria-hidden />
        <section className="flex min-w-0 flex-col gap-4">
          <div className="h-10 rounded-[var(--radius-md)] border border-hairline bg-raised" />
        </section>
        <aside className="hidden 2xl:block" aria-hidden />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative -mb-px inline-flex items-center px-3 py-2 text-small transition-colors",
        active
          ? "text-text-primary"
          : "text-text-secondary hover:text-text-primary",
      )}
    >
      {children}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-2 bottom-0 h-0.5 bg-accent"
        />
      )}
    </button>
  );
}

function IdleHint() {
  return (
    <div className="flex flex-col gap-3 py-6">
      <div className="flex items-center gap-2">
        <Badge tone="cyan" dot>
          READY
        </Badge>
        <span className="text-meta text-text-muted">
          query → proxy → :8080 retrieval + RAG
        </span>
      </div>
      <p className="text-body text-text-secondary max-w-[60ch]">
        Ask a question about AWS documentation. Answers stream into this panel
        with live inline citations and full query telemetry — query_time_ms,
        chunks_found, cache_hit, model.
      </p>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {["how do I make an S3 bucket public?", "lambda cold start mitigation", "dynamodb GSI design"].map(
          (ex) => (
            <span
              key={ex}
              className="rounded-[var(--radius-sm)] border border-hairline bg-raised px-2 py-1 font-mono text-[0.6875rem] text-text-muted"
            >
              {ex}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function FilterDrawer({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Close on ESC; trap focus loosely by focusing the panel on open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Search filters"
    >
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />
      <div className="relative max-h-[80vh] overflow-y-auto rounded-t-[var(--radius-lg)] border-t border-hairline bg-panel p-4 pb-8">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
        <div className="mb-3 flex items-center justify-between">
          <span className="text-micro text-text-muted">filters</span>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[0.75rem] text-text-secondary hover:text-text-primary"
          >
            done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
