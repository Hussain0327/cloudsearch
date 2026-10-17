import type { Metadata } from "next";
import { FilingList } from "@/components/spider/FilingList";

export const metadata: Metadata = {
  title: "Filings",
  description:
    "Indexed SEC filings. Pick one and watch the spider crawl it for revenue, debt and financing, and share facts.",
};

/** /filings — the list of indexed 10-Ks. Data comes from the /api/filings proxy. */
export default function FilingsPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-2 py-8 md:py-10">
      <FilingList />
    </div>
  );
}
