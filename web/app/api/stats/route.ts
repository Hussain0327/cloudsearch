import { API_PREFIX, BACKEND_URL } from "@/lib/config";

export const runtime = "nodejs";
// Allow the stats response to be cached briefly to avoid hammering the API.
export const revalidate = 30;

/**
 * GET /api/stats — server-side proxy to the Go API GET /api/v1/stats.
 * Returns a clean 502 JSON { error } if the upstream is unreachable.
 */
export async function GET(): Promise<Response> {
  const upstreamUrl = `${BACKEND_URL}${API_PREFIX}/stats`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Match the route-level revalidate window.
      next: { revalidate: 30 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Upstream request failed: ${message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: text || `Upstream returned ${upstream.status}` },
      { status: 502 },
    );
  }

  const data = await upstream.text();
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
