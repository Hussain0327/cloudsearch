import { proxyJson } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/filings/by-ticker/{ticker} — proxy to GET /api/v1/filings/by-ticker/{ticker}. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
): Promise<Response> {
  const { ticker } = await params;
  const t = ticker.trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(t)) {
    return Response.json({ error: "Invalid ticker" }, { status: 400 });
  }
  return proxyJson(`/filings/by-ticker/${encodeURIComponent(t)}`, request.signal);
}
