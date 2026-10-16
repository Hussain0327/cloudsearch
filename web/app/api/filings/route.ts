import { proxyJson } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/filings — proxy to the Go API GET /api/v1/filings. */
export async function GET(request: Request): Promise<Response> {
  return proxyJson("/filings", request.signal);
}
