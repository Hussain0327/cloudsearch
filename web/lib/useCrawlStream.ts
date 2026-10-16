"use client";

import * as React from "react";
import type {
  CrawlStartEvent,
  CrawlStreamEvent,
  Fact,
  FactCategory,
  FilingLink,
} from "@/lib/filings-types";
import { readSseStream } from "@/lib/sse";

/** Lifecycle of the crawl. */
export type CrawlStatus = "idle" | "loading" | "playing" | "paused" | "done" | "error";

export interface CrawlOptions {
  /** Replay interval between facts in ms (default 120). */
  paceMs: number;
  /** Server-side category filter; empty means all. */
  categories: FactCategory[];
}

export interface CrawlState {
  status: CrawlStatus;
  start: CrawlStartEvent | null;
  /** Facts received so far, in arrival (document) order. */
  facts: Fact[];
  /** Links received so far. */
  links: FilingLink[];
  /** The most recently received fact. */
  currentFact: Fact | null;
  error: string | null;
  options: CrawlOptions;
}

export interface UseCrawlStream extends CrawlState {
  /** Start (or resume) the stream from the next unseen fact_index. */
  play: () => void;
  /** Abort the stream, keeping what was found. play() resumes. */
  pause: () => void;
  /** Abort and mark done. */
  stop: () => void;
  /** Change pace; applies on the next play (and restarts a live stream). */
  setPace: (ms: number) => void;
  /** Change the category filter; applies on the next play (restarts a live stream). */
  setCategories: (categories: FactCategory[]) => void;
  /** Clear everything and start again from fact_index 0. */
  restart: () => void;
  /** Toggle between play and pause. */
  toggle: () => void;
}

/**
 * A crawl source opens one streaming run and invokes `onEvent` for each event
 * until the stream ends or `signal` aborts. The API implementation fetches
 * /api/filings/{id}/crawl; the demo implementation replays an inline fixture.
 */
export type CrawlSource = (
  params: { from: number; paceMs: number; categories: FactCategory[]; signal: AbortSignal },
  onEvent: (event: CrawlStreamEvent) => void,
) => Promise<void>;

/** Crawl source backed by the Next.js proxy for a real filing id. */
export function apiCrawlSource(filingId: number | string): CrawlSource {
  return async ({ from, paceMs, categories, signal }, onEvent) => {
    const qs = new URLSearchParams();
    qs.set("pace_ms", String(paceMs));
    qs.set("from", String(from));
    if (categories.length) qs.set("categories", categories.join(","));

    const res = await fetch(`/api/filings/${filingId}/crawl?${qs.toString()}`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    });

    if (!res.ok || !res.body) {
      let message = `Request failed (${res.status})`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) message = j.error;
      } catch {
        /* keep default */
      }
      throw new Error(message);
    }

    await readSseStream(res.body, (frame) => {
      switch (frame.event) {
        case "start":
          try {
            onEvent({ type: "start", data: JSON.parse(frame.data ?? "{}") as CrawlStartEvent });
          } catch {
            /* ignore malformed */
          }
          break;
        case "fact":
          try {
            onEvent({ type: "fact", data: JSON.parse(frame.data ?? "null") as Fact });
          } catch {
            /* ignore malformed */
          }
          break;
        case "link":
          try {
            onEvent({ type: "link", data: JSON.parse(frame.data ?? "null") as FilingLink });
          } catch {
            /* ignore malformed */
          }
          break;
        case "error":
          onEvent({ type: "error", data: frame.data || "Upstream stream error" });
          break;
        case "done":
          onEvent({ type: "done" });
          break;
        default:
          break;
      }
    });
  };
}

/**
 * Crawl source that replays an in-memory fixture with setTimeout pacing.
 * Used by the NEXT_PUBLIC_SPIDER_DEMO=1 viewer so the spider can be exercised
 * without a backend.
 */
export function mockCrawlSource(fixture: {
  start: Omit<CrawlStartEvent, "streaming">;
  facts: Fact[];
  links: FilingLink[];
}): CrawlSource {
  return ({ from, paceMs, categories, signal }, onEvent) =>
    new Promise<void>((resolve) => {
      const wanted = new Set(categories);
      const queue = fixture.facts.filter(
        (f) => f.fact_index >= from && (wanted.size === 0 || wanted.has(f.category)),
      );
      onEvent({ type: "start", data: { ...fixture.start, streaming: queue.length } });

      let i = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", finish, { once: true });

      const tick = () => {
        if (signal.aborted) return;
        if (i >= queue.length) {
          onEvent({ type: "done" });
          finish();
          return;
        }
        const fact = queue[i++];
        onEvent({ type: "fact", data: fact });
        const link = fixture.links.find((l) => l.fact_index === fact.fact_index);
        if (link) onEvent({ type: "link", data: link });
        timer = setTimeout(tick, Math.max(0, paceMs));
      };
      timer = setTimeout(tick, Math.max(0, paceMs));
    });
}

const DEFAULT_OPTIONS: CrawlOptions = { paceMs: 120, categories: [] };

/**
 * Client hook driving one crawl. Pause aborts the fetch; play resumes with
 * from = last fact_index + 1, so the server never re-sends what we have.
 * Changing pace or categories while playing restarts the stream from the
 * same cursor with the new parameters.
 */
export function useCrawlStream(
  source: CrawlSource,
  initial: Partial<CrawlOptions> = {},
): UseCrawlStream {
  const [state, setState] = React.useState<CrawlState>(() => ({
    status: "idle",
    start: null,
    facts: [],
    links: [],
    currentFact: null,
    error: null,
    options: { ...DEFAULT_OPTIONS, ...initial },
  }));

  const abortRef = React.useRef<AbortController | null>(null);
  const nextIndexRef = React.useRef(0);
  const seenRef = React.useRef<Set<number>>(new Set());
  const optionsRef = React.useRef(state.options);
  const sourceRef = React.useRef(source);
  React.useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const abort = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = React.useCallback(() => {
    abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { paceMs, categories } = optionsRef.current;

    setState((s) => ({
      ...s,
      status: s.facts.length === 0 ? "loading" : "playing",
      error: null,
    }));

    sourceRef
      .current(
        { from: nextIndexRef.current, paceMs, categories, signal: controller.signal },
        (event) => {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case "start":
              setState((s) => ({ ...s, start: event.data, status: "playing" }));
              break;
            case "fact": {
              const fact = event.data;
              if (!fact || typeof fact.fact_index !== "number") break;
              nextIndexRef.current = Math.max(nextIndexRef.current, fact.fact_index + 1);
              if (seenRef.current.has(fact.fact_index)) break;
              seenRef.current.add(fact.fact_index);
              setState((s) => ({
                ...s,
                status: "playing",
                facts: [...s.facts, fact],
                currentFact: fact,
              }));
              break;
            }
            case "link": {
              const link = event.data;
              if (!link) break;
              setState((s) =>
                s.links.some((l) => l.dom_id === link.dom_id)
                  ? s
                  : { ...s, links: [...s.links, link] },
              );
              break;
            }
            case "error":
              setState((s) => ({ ...s, status: "error", error: event.data }));
              break;
            case "done":
              setState((s) => ({ ...s, status: "done" }));
              break;
          }
        },
      )
      .then(() => {
        if (controller.signal.aborted) return;
        setState((s) => (s.status === "error" ? s : { ...s, status: "done" }));
      })
      .catch((err: unknown) => {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : "Network request failed";
        setState((s) => ({ ...s, status: "error", error: message }));
      });
  }, [abort]);

  const play = React.useCallback(() => {
    run();
  }, [run]);

  const pause = React.useCallback(() => {
    abort();
    setState((s) =>
      s.status === "playing" || s.status === "loading" ? { ...s, status: "paused" } : s,
    );
  }, [abort]);

  const stop = React.useCallback(() => {
    abort();
    setState((s) => ({ ...s, status: "done" }));
  }, [abort]);

  const restart = React.useCallback(() => {
    abort();
    nextIndexRef.current = 0;
    seenRef.current = new Set();
    setState((s) => ({
      status: "idle",
      start: null,
      facts: [],
      links: [],
      currentFact: null,
      error: null,
      options: s.options,
    }));
    // Start on the next tick so the reset state has been committed.
    queueMicrotask(run);
  }, [abort, run]);

  const applyOptions = React.useCallback(
    (patch: Partial<CrawlOptions>) => {
      const live = abortRef.current !== null;
      optionsRef.current = { ...optionsRef.current, ...patch };
      setState((s) => ({ ...s, options: { ...s.options, ...patch } }));
      if (live) run();
    },
    [run],
  );

  const setPace = React.useCallback((ms: number) => applyOptions({ paceMs: ms }), [applyOptions]);
  const setCategories = React.useCallback(
    (categories: FactCategory[]) => applyOptions({ categories }),
    [applyOptions],
  );

  const toggle = React.useCallback(() => {
    if (abortRef.current) pause();
    else play();
  }, [pause, play]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  return { ...state, play, pause, stop, setPace, setCategories, restart, toggle };
}
