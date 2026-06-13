import type { Metadata } from "next";
import { StatsDashboard } from "@/components/stats/StatsDashboard";

export const metadata: Metadata = {
  title: "Index statistics",
  description:
    "Corpus coverage for the CloudSearch index — document and chunk counts per AWS service, freshness, and per-service share of the retrieval index.",
};

/**
 * STATS / INDEX page. Full-width container with a 4-tile stat band over a
 * sortable, dense per-service breakdown table. Data is fetched client-side
 * from the /api/stats proxy (never the Go server directly) so loading,
 * error, unreachable, and empty states can be handled interactively with a
 * Retry affordance.
 */
export default function StatsPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-2 py-8 md:py-10">
      <StatsDashboard />
    </div>
  );
}
