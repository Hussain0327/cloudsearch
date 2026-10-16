import { parseId, upstreamError, upstreamFailure, upstreamUrl } from "@/lib/proxy";

// Node runtime so the upstream SSE body streams through unbuffered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/filings/{id}/crawl?pace_ms=&from=&categories= — SSE pass-through to
 * GET /api/v1/filings/{id}/crawl with the same query string. The client's
 * abort signal is forwarded so pausing/leaving the page tears down the
 * upstream stream.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const safeId = parseId(id);
  if (!safeId) {
    return Response.json({ error: "Invalid filing id" }, { status: 400 });
  }

  const { search } = new URL(request.url);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(`/filings/${safeId}/crawl`, search), {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
      signal: request.signal,
    });
  } catch (err) {
    return upstreamFailure(err);
  }
  if (!upstream.ok) return upstreamError(upstream);
  if (!upstream.body) {
    return Response.json({ error: "Upstream returned an empty stream" }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
