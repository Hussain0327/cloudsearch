import type { Metadata } from "next";
import * as React from "react";
import { FilingViewer } from "@/components/spider/FilingViewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Spider",
  description:
    "Watch the spider walk a Form 10-K: every revenue, debt, and share figure it finds lights up in the document and lands in the Found ledger.",
};

/**
 * /filings/[id] — the spider viewer. `params` is a Promise in Next 16.
 * The viewer reads `?autoplay=1` via useSearchParams, so it sits under a
 * Suspense boundary.
 */
export default async function FilingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<div className="h-[calc(100vh-56px)]" aria-hidden />}>
      <FilingViewer id={id} />
    </React.Suspense>
  );
}
