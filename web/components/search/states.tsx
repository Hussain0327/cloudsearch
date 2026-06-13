"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Skeletons                                                                  */
/* -------------------------------------------------------------------------- */

function Bar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-3 rounded-[3px] bg-hairline shimmer", className)}
    />
  );
}

/** Optimistic answer-panel skeleton shown immediately on submit. */
export function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading answer">
      <Bar className="w-[92%]" />
      <Bar className="w-[100%]" />
      <Bar className="w-[84%]" />
      <Bar className="w-[96%]" />
      <Bar className="w-[60%]" />
      <div className="mt-2 flex gap-2">
        <Bar className="h-5 w-20" />
        <Bar className="h-5 w-16" />
        <Bar className="h-5 w-24" />
      </div>
    </div>
  );
}

/** Meta-strip placeholder. */
export function MetaSkeleton() {
  return (
    <div className="flex gap-3" aria-hidden>
      <Bar className="h-3 w-14" />
      <Bar className="h-3 w-16" />
      <Bar className="h-3 w-20" />
    </div>
  );
}

/** Source-card placeholders for the right pane. */
export function SourcesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-hairline bg-panel p-3"
        >
          <div className="flex gap-2">
            <Bar className="h-5 w-14" />
            <Bar className="h-5 w-12" />
          </div>
          <Bar className="w-[80%]" />
          <Bar className="h-2.5 w-[60%]" />
          <Bar className="h-2.5 w-[90%]" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty state (chunks_found === 0 / no citations)                            */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  /** The friendly backend message ("couldn't find relevant documentation…"). */
  message?: string;
  /** True when one or more service filters are active. */
  hasFilters?: boolean;
  onClearFilters?: () => void;
}

export function EmptyState({ message, hasFilters, onClearFilters }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-info/30 bg-[rgba(91,155,213,0.06)] p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-info"
        />
        <span className="text-micro text-info">no matching documentation</span>
      </div>
      <p className="text-body text-text-secondary max-w-[60ch]">
        {message ||
          "Couldn't find relevant documentation for that query. Try broadening the services or rephrasing."}
      </p>
      <ul className="ml-1 list-disc space-y-1 pl-4 text-small text-text-muted">
        <li>Rephrase with different keywords.</li>
        <li>Remove service filters to widen the search.</li>
        <li>Check the service is one of the indexed 20.</li>
      </ul>
      {hasFilters && onClearFilters && (
        <Button variant="secondary" size="sm" onClick={onClearFilters}>
          Clear service filters
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Error state                                                                */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  error: string;
  requestId?: string | null;
  onRetry?: () => void;
}

export function ErrorState({ error, requestId, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-error/40 bg-error-tint p-4"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-error" />
        <span className="text-micro text-error">request failed</span>
      </div>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap font-mono text-[0.8125rem] leading-relaxed text-text-primary [font-feature-settings:'tnum'_1,'ss01'_1]">
        {error}
      </pre>
      {requestId && (
        <span className="font-mono text-meta text-text-muted">
          request_id: {requestId}
        </span>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
