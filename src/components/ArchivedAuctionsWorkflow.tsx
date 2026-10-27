import { useEffect, useState } from "react";
import { Archive, Loader2 } from "lucide-react";
import { getArchivedAuctions } from "@/services/google-api";
import { ArchivedAuction } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { WorkflowTabsShell } from "@/components/WorkflowTabsShell";
import { useAuction } from "@/context/AuctionContext";
import ArchivedYearPanel from "./ArchivedYearPanel";

export default function ArchivedAuctionsWorkflow() {
  const { isAuctionClosed } = useAuction();
  const [auctions, setAuctions] = useState<ArchivedAuction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArchivedAuctions()
      .then(setAuctions)
      .catch((e: Error) => setError(e.message));
  }, []);

  let body;
  if (error) {
    body = (
      <Card>
        <CardContent>
          <StatusStatePlaceholder icon={<Archive />} title="Couldn't load the archived auctions" description={error} />
        </CardContent>
      </Card>
    );
  } else if (!auctions) {
    body = (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" /> Looking for past auctions...
      </div>
    );
  }

  if (body) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Archived Auctions</h2>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">Look back at the past two auctions.</p>
        </div>
        {body}
      </div>
    );
  }

  return (
    <WorkflowTabsShell
      title="Archived Auctions"
      description="Look back at the past two auctions: attendance, bidders, and the auction catalog."
      spreadsheetId=""
      isAuctionClosed={isAuctionClosed}
      defaultTab={String(auctions![0].year)}
      tabs={auctions!.map((a) => ({
        value: String(a.year),
        label: `${a.year} Auction`,
        content: <ArchivedYearPanel auction={a} />,
      }))}
    />
  );
}
