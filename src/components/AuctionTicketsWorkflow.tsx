import { useConfig } from "@/context/ConfigContext";
import { useAuction } from "@/context/AuctionContext";
import { WorkflowTabsShell } from "@/components/WorkflowTabsShell";
import TicketAttendeeTab from "./TicketAttendeeTab";
import TicketDocumentCreationTab from "./TicketDocumentCreationTab";

export default function AuctionTicketsWorkflow() {
  const { config } = useConfig();
  const { auctionState } = useAuction();
  const spreadsheetId = config.auctionTicketsSpreadsheetId;

  return (
    <WorkflowTabsShell
      title="Auction Tickets"
      description="Manage bidders, check-ins, and prepare bidder documents for the day of the auction."
      spreadsheetId={spreadsheetId}
      auctionState={auctionState}
      defaultTab="auction_tickets"
      headerAlign="center"
      tabs={[
        { value: "auction_tickets", label: "Auction Tickets", content: <TicketAttendeeTab /> },
        { value: "documents", label: "Document Creation", content: <TicketDocumentCreationTab /> },
      ]}
    />
  );
}
