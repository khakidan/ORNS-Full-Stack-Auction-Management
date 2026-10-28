import { useConfig } from "@/context/ConfigContext";
import { useAuction } from "@/context/AuctionContext";
import { useAuth } from "@/context/AuthContext";
import { AttentionDot, WorkflowTab, WorkflowTabsShell } from "@/components/WorkflowTabsShell";
import { useTicketPurchaseStatus } from "@/hooks/useTicketPurchaseStatus";
import { ticketStatusProblems } from "@/lib/ticketPurchaseStatus";
import TicketAttendeeTab from "./TicketAttendeeTab";
import TicketDocumentCreationTab from "./TicketDocumentCreationTab";
import TicketPurchaseStatusCard from "./TicketPurchaseStatusCard";

export default function AuctionTicketsWorkflow() {
  const { config } = useConfig();
  const { auctionState, attendees, fetchAttendees } = useAuction();
  const { can } = useAuth();
  const spreadsheetId = config.auctionTicketsSpreadsheetId;

  // Website Purchases (ROADMAP W6) is for staff who can run the auction's
  // stages; the page holds its status so the tab can flag a problem
  // without being opened.
  const canSeePurchases = can("auction.stage");
  const purchases = useTicketPurchaseStatus(fetchAttendees, canSeePurchases);
  const needsAttention = purchases.status !== null && ticketStatusProblems(purchases.status, new Date()).length > 0;

  const tabs: WorkflowTab[] = [
    { value: "auction_tickets", label: "Auction Tickets", content: <TicketAttendeeTab /> },
    ...(canSeePurchases ? [{
      value: "website_purchases",
      label: "Website Purchases",
      indicator: needsAttention ? <AttentionDot label="Needs attention" /> : undefined,
      content: <TicketPurchaseStatusCard attendees={attendees} purchases={purchases} />,
    }] : []),
    { value: "documents", label: "Document Creation", content: <TicketDocumentCreationTab /> },
  ];

  return (
    <WorkflowTabsShell
      title="Auction Tickets"
      description="Manage bidders, check-ins, and prepare bidder documents for the day of the auction."
      spreadsheetId={spreadsheetId}
      auctionState={auctionState}
      defaultTab="auction_tickets"
      headerAlign="center"
      tabs={tabs}
    />
  );
}
