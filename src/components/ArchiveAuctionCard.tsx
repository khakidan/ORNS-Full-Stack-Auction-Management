import { useState } from "react";
import { Archive, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { postJson } from "@/services/apiClient";
import { extractId } from "@/hooks/useConfigSettingsState";
import { Config } from "@/types";

interface ArchiveCopyResult {
  name: string;
  status: "copied" | "replaced" | "skipped" | "failed";
  error?: string;
}

interface ArchiveReply {
  success: boolean;
  year: number;
  folderLink: string;
  results: ArchiveCopyResult[];
}

/**
 * Copies this auction's three master spreadsheets into its "{year} Auction"
 * Drive folder, named for the Archived Auctions page, without clearing
 * anything. Closing an auction does not do this by itself; "Setup New
 * Auction Year" also archives (last year's), skipping anything already
 * archived here.
 */
export default function ArchiveAuctionCard({ config }: { config: Config }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [archiving, setArchiving] = useState(false);
  const [folderLink, setFolderLink] = useState<string | null>(null);

  const handleArchive = async () => {
    setArchiving(true);
    setFolderLink(null);
    try {
      const reply: ArchiveReply = await postJson("/api/auction/archive", {
        year: Number(year),
        ticketsSpreadsheetId: extractId(config.auctionTicketsSpreadsheetId),
        itemEntrySpreadsheetId: extractId(config.auctionItemsSpreadsheetId),
        bidManagementSpreadsheetId: extractId(config.bidManagementSpreadsheetId),
      }, "Couldn't archive the auction");
      setFolderLink(reply.folderLink);
      const failed = reply.results.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        toast.error(`Archived with problems: ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}`);
      } else {
        toast.success(`Archived the ${reply.year} auction (${reply.results.length} spreadsheets).`);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Archive className="w-5 h-5 text-muted-foreground" />Archive This Auction</CardTitle>
        <CardDescription>
          Saves copies of the Tickets, Items and Bid Management spreadsheets to the "{year} Auction" folder so they show up under
          Archived Auctions. Nothing is cleared. Closing an auction doesn't do this on its own. Archiving again replaces the
          earlier copies (the old ones go to the Drive trash).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 max-w-40">
          <Label htmlFor="archiveYear">Auction year</Label>
          <Input id="archiveYear" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <LoadingButton
          variant="outline"
          loading={archiving}
          loadingText="Archiving..."
          icon={<Archive className="w-4 h-4" />}
          disabled={!/^\d{4}$/.test(year)}
          onClick={handleArchive}
          className="gap-2"
        >
          Archive Auction
        </LoadingButton>
        {folderLink && (
          <a href={folderLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-primary underline">
            <ExternalLink className="w-3.5 h-3.5" /> Open the archive folder
          </a>
        )}
      </CardContent>
    </Card>
  );
}
