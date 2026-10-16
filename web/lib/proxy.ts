import { API_PREFIX, BACKEND_URL } from "@/lib/config";

/**
 * Shared helpers for the /api/filings/* proxy Route Handlers. Server-only.
 *
 * Every handler follows the same contract as app/api/search/route.ts: fetch
 * the Go API, surface a clean 502 JSON { error } if it is unreachable or
 * returns non-2xx, otherwise pass the body through.
 */

export function upstreamUrl(path: string, search = ""): string {
  return `${BACKEND_URL}${API_PREFIX}${path}${search}`;
}

export function upstreamFailure(err: unknown): Response {
  const message = err instanceof Error ? err.message : "Unknown error";
  return Response.json(
    { error: `Upstream request failed: ${message}` },
    { status: 502 },
  );
}

/**
 * Map an upstream non-2xx to the client. A 404 stays a 404 (the viewer shows
 * "not found"); everything else becomes a 502 with whatever body it sent.
 */
export async function upstreamError(upstream: Response): Promise<Response> {
  const text = await upstream.text().catch(() => "");
  const status = upstream.status === 404 ? 404 : 502;
  let body: unknown = { error: text || `Upstream returned ${upstream.status}` };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && "error" in parsed) body = parsed;
  } catch {
    /* keep text body */
  }
  return Response.json(body, { status });
}

/** Proxy a JSON GET verbatim. */
export async function proxyJson(path: string, signal?: AbortSignal): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(path), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (err) {
    return upstreamFailure(err);
  }
  if (!upstream.ok) return upstreamError(upstream);

  const data = await upstream.text();
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Validate a numeric path id; returns null when malformed. */
export function parseId(raw: string): string | null {
  return /^\d{1,18}$/.test(raw) ? raw : null;
}
