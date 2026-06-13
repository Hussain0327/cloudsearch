import type { ResponseMetadata } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ResultMetaProps {
  meta: ResponseMetadata;
  className?: string;
}

/**
 * MetaStrip: mono telemetry row — query_time_ms, chunks_found, model tag, and a
 * cache_hit indicator (green "CACHE HIT" with dot / muted "LIVE"). Tabular
 * numerals; fields separated by hairline dividers.
 */
export function ResultMeta({ meta, className }: ResultMetaProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-text-secondary",
        className,
      )}
    >
      <Field label="time">
        <span className="text-text-primary">{meta.query_time_ms}</span> ms
      </Field>
      <Divider />
      <Field label="chunks">
        <span className="text-text-primary">{meta.chunks_found}</span>
        {meta.chunks_found === 1 ? " chunk" : " chunks"}
      </Field>
      <Divider />
      <Field label="model">
        <span className="rounded-[var(--radius-sm)] border border-hairline bg-raised px-1.5 py-px text-text-primary">
          {meta.model}
        </span>
      </Field>
      <Divider />
      {meta.cache_hit ? (
        <span className="inline-flex items-center gap-1.5 text-success">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-success"
          />
          CACHE HIT
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-text-muted">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted"
          />
          LIVE
        </span>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[0.625rem] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      <span className="[font-feature-settings:'tnum'_1,'ss01'_1]">{children}</span>
    </span>
  );
}

function Divider() {
  return <span aria-hidden className="h-3 w-px bg-hairline" />;
}
