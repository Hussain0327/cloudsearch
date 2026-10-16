import { parseId, upstreamError, upstreamFailure, upstreamUrl } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/filings/{id}/document — proxy to GET /api/v1/filings/{id}/document.
 *
 * Passes the annotated filing HTML through as text/html and forwards the
 * upstream Content-Security-Policy and X-Content-Type-Options headers (or
 * supplies the contract defaults when the upstream omits them).
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

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(`/filings/${safeId}/document`), {
      method: "GET",
      headers: { Accept: "text/html" },
      cache: "no-store",
      signal: request.signal,
    });
  } catch (err) {
    return upstreamFailure(err);
  }
  if (!upstream.ok) return upstreamError(upstream);

  const html = await upstream.text();
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        upstream.headers.get("Content-Security-Policy") ??
        "default-src 'none'; img-src https://www.sec.gov data:; style-src 'unsafe-inline'",
      "X-Content-Type-Options": upstream.headers.get("X-Content-Type-Options") ?? "nosniff",
    },
  });
}
