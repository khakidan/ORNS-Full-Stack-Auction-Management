import { useConfig } from "@/context/ConfigContext";
import { Button } from "@/components/ui/button";
import { PlaySquare, FileText } from "lucide-react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { useForPrintFolderFiles } from "@/hooks/useForPrintFolderFiles";
import { DocumentCreationPanel } from "@/components/DocumentCreationPanel";
import { FolderFilesCard } from "@/components/FolderFilesCard";

import { useAuction } from "@/context/AuctionContext";

export default function DocumentCreationTab() {
  const { isAuctionClosed } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.auctionItemsSpreadsheetId;
  const forPrintFolderId = config.forPrintFolderId;

  const { files, loadingFiles, fetchFiles, isInvalidFolder } = useForPrintFolderFiles(forPrintFolderId);

  const runScript = async (functionName: string, label: string) => {
    if (!spreadsheetId || spreadsheetId.includes("PASTE")) {
      toast.error("Please correctly configure the Auction Items Spreadsheet ID in Settings.");
      return;
    }

    const endpointMap: Record<string, string> = {
      apiCreateBundlingDoc: "/api/production/item-entry/bundling-doc",
      apiCreateItemLabels: "/api/production/item-entry/item-labels",
      apiCreateSlideshow: "/api/production/item-entry/slideshow",
      apiCreateBiddingGuideCoverPage: "/api/production/item-entry/bidding-guide-cover",
      apiCreateBiddingGuideInnerPages: "/api/production/item-entry/bidding-guide-inner",
      apiCreateBidSheets: "/api/production/item-entry/bid-sheets",
      apiCreateCatalog: "/api/production/item-entry/catalog",
      apiCreateTableTents: "/api/production/item-entry/table-tents"
    };

    const endpoint = endpointMap[functionName];
    if (!endpoint) {
      toast.error(`Unknown function map: ${functionName}`);
      return;
    }

    try {
      toast.loading(`Running ${label}...`, { id: functionName });
      const res = await fetchWithRetry(`${getBaseUrl()}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: config.forPrintFolderId, spreadsheetId })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast.success(`${label} completed!`, { id: functionName });
      // Refresh files list after a short delay to allow Drive to sync
      setTimeout(fetchFiles, 3000);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`, { id: functionName });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <DocumentCreationPanel description="Generate printable documents and presentations." isAuctionClosed={isAuctionClosed}>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateBundlingDoc', 'Create Bundling Meeting Doc')}
            disabled={isAuctionClosed}
          >
            <FileText className="w-4 h-4" />
            Create Bundling Meeting Doc
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateItemLabels', 'Create Item Labels')}
            disabled={isAuctionClosed}
          >
            <FileText className="w-4 h-4" />
            Create Item Labels Document
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateBiddingGuideCoverPage', 'Bidding Guide Cover Page')}
            disabled={isAuctionClosed}
          >
            <FileText className="w-4 h-4" />
            Create Bidding Guide Cover Page
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateBiddingGuideInnerPages', 'Bidding Guide Inner Pages')}
            disabled={isAuctionClosed}
          >
            <FileText className="w-4 h-4" />
            Create Bidding Guide Inner Pages
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateBidSheets', 'Bid Sheets')}
            disabled={isAuctionClosed}
          >
            <FileText className="w-4 h-4" />
            Create Bid Sheets Doc (A5)
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateCatalog', 'Auction Catalog')}
            disabled={isAuctionClosed}
          >
            <FileText className="w-4 h-4" />
            Create Auction Catalog Doc
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateTableTents', 'Table Tents')}
            disabled={isAuctionClosed}
          >
            <FileText className="w-4 h-4" />
            Create Table Tents Doc
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="secondary"
            onClick={() => runScript('apiCreateSlideshow', 'Create Slideshow')}
            disabled={isAuctionClosed}
          >
            <PlaySquare className="w-4 h-4" />
            Create Live Auction Slideshow
          </Button>
        </DocumentCreationPanel>
      </div>

      <div className="lg:col-span-2">
        <FolderFilesCard files={files} loadingFiles={loadingFiles} isInvalidFolder={isInvalidFolder} onRefresh={fetchFiles} />
      </div>
    </div>
  );
}
