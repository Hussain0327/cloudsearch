import { API_PREFIX, BACKEND_URL } from "@/lib/config";
import type { SearchRequest } from "@/lib/types";

// Run on the Node.js runtime so we can stream the upstream body through
// unbuffered, and force dynamic execution (never cache a search).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/search — server-side proxy to the Go API POST /api/v1/search.
 *
 * The browser never touches the Go server directly (avoids CORS). When
 * `stream` is true we pipe the upstream SSE ReadableStream straight through
 * unchanged with text/event-stream headers and no buffering. Otherwise we
 * pass the JSON body through. If the upstream is unreachable we return a
 * clean 502 JSON { error }.
 */
export async function POST(request: Request): Promise<Response> {
  let body: SearchRequest;
  try {
    body = (await request.json()) as SearchRequest;
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  if (!body?.query || typeof body.query !== "string" || body.query.trim() === "") {
    return Response.json({ error: "Field 'query' is required" }, { status: 400 });
  }

  const wantsStream = body.stream === true;
  const upstreamUrl = `${BACKEND_URL}${API_PREFIX}/search`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: wantsStream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(body),
      // Disable Next.js fetch caching for this proxy.
      cache: "no-store",
      // Forward the client's abort signal so cancelling the request
      // (Stop button / ESC / unmount) tears down the upstream connection.
      signal: request.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Upstream request failed: ${message}` },
      { status: 502 },
    );
  }

  // Surface upstream non-2xx as a 502 with whatever body it sent.
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: text || `Upstream returned ${upstream.status}` },
      { status: 502 },
    );
  }

  // Streaming path: pipe the upstream SSE body through unchanged.
  if (wantsStream && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disable proxy buffering (nginx and friends) so tokens flush live.
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Non-stream path: pass the JSON body through verbatim.
  const data = await upstream.text();
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
