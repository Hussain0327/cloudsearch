"use client";

import * as React from "react";
import type {
  Citation,
  ResponseMetadata,
  SearchRequest,
  SearchResponse,
} from "@/lib/types";

/** Lifecycle of a single search request. */
export type SearchStatus = "idle" | "loading" | "streaming" | "done" | "error";

export interface SearchState {
  status: SearchStatus;
  /** Accumulated answer text (raw, whitespace-preserved). */
  answer: string;
  citations: Citation[];
  meta: ResponseMetadata | null;
  /** Error string from an "error" SSE event or a network/proxy failure. */
  error: string | null;
  /** The request that produced this state, for Retry. */
  request: SearchRequest | null;
}

export interface UseSearchStream extends SearchState {
  /** Kick off a new search. Aborts any in-flight request first. */
  search: (request: SearchRequest) => void;
  /** Abort the in-flight request (Stop button / ESC). Marks the result done. */
  stop: () => void;
  /** Re-run the last request verbatim. */
  retry: () => void;
  /** Reset to idle (clears answer/citations/meta/error). */
  reset: () => void;
}

const INITIAL: SearchState = {
  status: "idle",
  answer: "",
  citations: [],
  meta: null,
  error: null,
  request: null,
};

/**
 * Parsed SSE frame: one `event:` name plus its joined `data:` payload.
 * `data` is null for events with no data line (e.g. "done").
 */
interface SseFrame {
  event: string;
  data: string | null;
}

/**
 * Parse a single SSE frame (the text between blank-line delimiters) into its
 * event name and joined data payload. Per the SSE spec we strip EXACTLY one
 * leading space after "data:" and join multiple data lines with "\n".
 */
function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  let sawData = false;

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // blank / comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    // Strip exactly one leading space after the colon.
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      sawData = true;
      dataLines.push(value);
    }
    // id / retry fields are ignored — not used by this protocol.
  }

  if (event === "message" && !sawData) return null;
  return { event, data: sawData ? dataLines.join("\n") : null };
}

/**
 * Client hook that POSTs to /api/search and (when stream:true) parses the SSE
 * stream incrementally via fetch + getReader() + TextDecoder. State updates
 * are coalesced to ~1 per animation frame to avoid layout thrash on fast token
 * streams. Aborts the prior request when a new search starts or on unmount.
 */
export function useSearchStream(): UseSearchStream {
  const [state, setState] = React.useState<SearchState>(INITIAL);

  const abortRef = React.useRef<AbortController | null>(null);
  const lastRequestRef = React.useRef<SearchRequest | null>(null);

  // Mutable buffers for the active stream; flushed to React on rAF.
  const answerRef = React.useRef("");
  const rafRef = React.useRef<number | null>(null);
  const pendingFlushRef = React.useRef(false);

  const cancelRaf = React.useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingFlushRef.current = false;
  }, []);

  // Coalesced flush of the accumulated answer text into React state.
  const scheduleAnswerFlush = React.useCallback(() => {
    if (pendingFlushRef.current) return;
    pendingFlushRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      pendingFlushRef.current = false;
      const next = answerRef.current;
      setState((s) =>
        s.answer === next && s.status === "streaming"
          ? s
          : { ...s, answer: next, status: "streaming" },
      );
    });
  }, []);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    cancelRaf();
    // Flush whatever we have and freeze as done (not error).
    setState((s) =>
      s.status === "loading" || s.status === "streaming"
        ? { ...s, answer: answerRef.current, status: "done" }
        : s,
    );
  }, [cancelRaf]);

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    cancelRaf();
    answerRef.current = "";
    lastRequestRef.current = null;
    setState(INITIAL);
  }, [cancelRaf]);

  const runStream = React.useCallback(
    async (request: SearchRequest, controller: AbortController) => {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Proxy returns clean JSON { error } on upstream failure.
        let message = `Request failed (${res.status})`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) message = j.error;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleFrame = (frame: SseFrame) => {
        switch (frame.event) {
          case "chunk": {
            if (frame.data == null) break;
            // Append in arrival order, preserving whitespace/newlines.
            answerRef.current += frame.data;
            scheduleAnswerFlush();
            break;
          }
          case "citations": {
            try {
              const citations = JSON.parse(frame.data ?? "[]") as Citation[];
              setState((s) => ({ ...s, citations }));
            } catch {
              /* ignore malformed citations payload */
            }
            break;
          }
          case "metadata": {
            try {
              const meta = JSON.parse(frame.data ?? "{}") as ResponseMetadata;
              setState((s) => ({ ...s, meta }));
            } catch {
              /* ignore malformed metadata payload */
            }
            break;
          }
          case "error": {
            cancelRaf();
            setState((s) => ({
              ...s,
              status: "error",
              error: frame.data || "Upstream stream error",
              answer: answerRef.current,
            }));
            break;
          }
          case "done": {
            // No-op here; finalization happens after the read loop ends.
            break;
          }
          default:
            break;
        }
      };

      // Read loop: buffer across reads, split complete frames on a blank line.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const { frames, rest } = splitFrames(buffer);
        buffer = rest;
        for (const raw of frames) {
          const frame = parseFrame(raw);
          if (frame) handleFrame(frame);
        }
      }

      // Flush remaining buffer (a final frame without trailing blank line).
      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail) {
        const frame = parseFrame(tail);
        if (frame) handleFrame(frame);
      }
    },
    [cancelRaf, scheduleAnswerFlush],
  );

  const runNonStream = React.useCallback(
    async (request: SearchRequest, controller: AbortController) => {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ ...request, stream: false }),
        signal: controller.signal,
      });

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

      const body = (await res.json()) as SearchResponse;
      answerRef.current = body.answer ?? "";
      setState((s) => ({
        ...s,
        status: "done",
        answer: body.answer ?? "",
        citations: body.citations ?? [],
        meta: body.metadata ?? null,
      }));
    },
    [],
  );

  const search = React.useCallback(
    (request: SearchRequest) => {
      const query = request.query?.trim();
      if (!query) return;

      // Abort any prior in-flight request.
      abortRef.current?.abort();
      cancelRaf();

      const controller = new AbortController();
      abortRef.current = controller;
      lastRequestRef.current = request;

      // Reset buffers and show optimistic loading state immediately.
      answerRef.current = "";
      setState({
        status: "loading",
        answer: "",
        citations: [],
        meta: null,
        error: null,
        request,
      });

      const stream = request.stream !== false; // default on
      const run = stream ? runStream : runNonStream;

      run(request, controller)
        .then(() => {
          // If aborted, leave whatever state stop()/new-search set.
          if (controller.signal.aborted) return;
          cancelRaf();
          setState((s) =>
            s.status === "error"
              ? s
              : { ...s, status: "done", answer: answerRef.current },
          );
        })
        .catch((err: unknown) => {
          // Aborts are expected (new search / stop / unmount) — not errors.
          if (
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === "AbortError")
          ) {
            return;
          }
          cancelRaf();
          const message =
            err instanceof Error ? err.message : "Network request failed";
          setState((s) => ({
            ...s,
            status: "error",
            error: message,
            answer: answerRef.current,
          }));
        });
    },
    [cancelRaf, runStream, runNonStream],
  );

  const retry = React.useCallback(() => {
    const last = lastRequestRef.current;
    if (last) search(last);
  }, [search]);

  // Abort + cancel rAF on unmount.
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { ...state, search, stop, retry, reset };
}

/**
 * Split a buffer into complete SSE frames (delimited by a blank line) plus the
 * trailing incomplete remainder. Handles both LF and CRLF line endings.
 */
function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;

  for (;;) {
    const lf = rest.indexOf("\n\n");
    const crlf = rest.indexOf("\r\n\r\n");
    let idx: number;
    let sepLen: number;
    if (lf === -1 && crlf === -1) break;
    if (crlf !== -1 && (lf === -1 || crlf < lf)) {
      idx = crlf;
      sepLen = 4;
    } else {
      idx = lf;
      sepLen = 2;
    }
    frames.push(rest.slice(0, idx));
    rest = rest.slice(idx + sepLen);
  }

  return { frames, rest };
}
