import { Button } from "@/components/ui/button";
import { PlaySquare } from "lucide-react";
import { toast } from "sonner";
import { errorTextFrom, getBaseUrl, NO_ANSWER_MESSAGE, postOnce, ServerUnreachableError } from "@/services/google-api";
import { useForPrintFolderFiles } from "@/hooks/useForPrintFolderFiles";
import { DocumentCreationPanel } from "@/components/DocumentCreationPanel";
import { FolderFilesCard } from "@/components/FolderFilesCard";

import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";

export default function TicketDocumentCreationTab() {
  const { isAuctionClosed } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.auctionTicketsSpreadsheetId;
  const forPrintFolderId = config.forPrintFolderId;
  const bidManagementSpreadsheetId = config.bidManagementSpreadsheetId;

  const { files, loadingFiles, fetchFiles, isInvalidFolder } = useForPrintFolderFiles(forPrintFolderId);

  const runScript = async (functionName: string, label: string) => {
    if (!spreadsheetId || spreadsheetId.includes("PASTE")) {
      toast.error("Please correctly configure the Auction Tickets Spreadsheet ID in Settings.");
      return;
    }
    if (!bidManagementSpreadsheetId || bidManagementSpreadsheetId.includes("PASTE")) {
      toast.error("Please correctly configure the Bid Management Spreadsheet ID in Settings.");
      return;
    }

    try {
      toast.loading(`Running ${label}...`, { id: functionName });

      const endpoint = "/api/production/tickets/bidder-labels";

      // Sent once, never retried: each run creates a new file, so a retry
      // after a timeout made duplicates.
      const res = await postOnce(`${getBaseUrl()}${endpoint}`, { folderId: forPrintFolderId, bidManagementSpreadsheetId, auctionTicketsSpreadsheetId: spreadsheetId });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(errorTextFrom(data, `Failed with status ${res.status}`));

      toast.success(`${label} completed!`, { id: functionName });
      setTimeout(fetchFiles, 3000);
    } catch (e: any) {
      toast.error(e instanceof ServerUnreachableError ? NO_ANSWER_MESSAGE : `Error: ${e.message}`, { id: functionName });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <DocumentCreationPanel description="Generate printable documents." isAuctionClosed={isAuctionClosed} buttonSpacingClassName="space-y-4">
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateBidderLabels', 'Create Bidder Labels')}
            disabled={isAuctionClosed}
          >
            <PlaySquare className="w-4 h-4 text-emerald-600" />
            Create Bidder Labels Doc
          </Button>
        </DocumentCreationPanel>
      </div>

      <div className="lg:col-span-2">
        <FolderFilesCard files={files} loadingFiles={loadingFiles} isInvalidFolder={isInvalidFolder} onRefresh={fetchFiles} />
      </div>
    </div>
  );
}
