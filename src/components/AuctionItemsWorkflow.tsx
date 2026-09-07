import { useConfig } from "@/context/ConfigContext";
import { useAuction } from "@/context/AuctionContext";
import { WorkflowTabsShell } from "@/components/WorkflowTabsShell";
import AuctionItemsTab from "./AuctionItemsTab";
import DocumentCreationTab from "./DocumentCreationTab";

export default function AuctionItemsWorkflow() {
  const { config } = useConfig();
  const { isAuctionClosed } = useAuction();
  const spreadsheetId = config.auctionItemsSpreadsheetId;

  return (
    <WorkflowTabsShell
      title="Auction Items Management"
      description="The database for all auction items. Assign categories, bundle items, and generate documents."
      spreadsheetId={spreadsheetId}
      isAuctionClosed={isAuctionClosed}
      defaultTab="auction_items"
      tabs={[
        { value: "auction_items", label: "Auction Items", content: <AuctionItemsTab /> },
        { value: "documents", label: "Document & Presentation Creation", content: <DocumentCreationTab /> },
      ]}
    />
  );
}
