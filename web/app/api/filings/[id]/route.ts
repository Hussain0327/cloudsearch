import { parseId, proxyJson } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/filings/{id} — proxy to GET /api/v1/filings/{id}. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const safeId = parseId(id);
  if (!safeId) {
    return Response.json({ error: "Invalid filing id" }, { status: 400 });
  }
  return proxyJson(`/filings/${safeId}`, request.signal);
}
