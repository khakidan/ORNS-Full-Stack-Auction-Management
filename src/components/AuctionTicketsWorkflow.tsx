import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/context/ConfigContext";
import { ExternalLink, AlertCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TicketAttendeeTab from "./TicketAttendeeTab";
import TicketDocumentCreationTab from "./TicketDocumentCreationTab";
import { useAuction } from "@/context/AuctionContext";

export default function AuctionTicketsWorkflow() {
  const { config } = useConfig();
  const { isAuctionClosed } = useAuction();
  const spreadsheetId = config.auctionTicketsSpreadsheetId;
  const [activeTab, setActiveTab] = useState("auction_tickets");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Auction Tickets</h2>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Manage bidders, check-ins, and prepare bidder documents for the day of the auction.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
          {isAuctionClosed && (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-md font-bold text-xs uppercase tracking-wider animate-pulse whitespace-nowrap order-first sm:order-none mb-2 sm:mb-0">
              <AlertCircle className="w-4 h-4" />
              Auction Closed
            </div>
          )}
          {spreadsheetId && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, "_blank")}
              className="w-full sm:w-auto"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Spreadsheet
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto pb-2 -mx-6 px-6 md:mx-0 md:px-0">
          <TabsList className="bg-slate-200/50 p-1">
            <TabsTrigger value="auction_tickets" className="gap-2 px-4 py-2">
              Auction Tickets
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-2 px-4 py-2">
              Document Creation
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="auction_tickets" className="m-0">
          <TicketAttendeeTab />
        </TabsContent>

        <TabsContent value="documents" className="m-0">
          <TicketDocumentCreationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
