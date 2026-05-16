import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/context/ConfigContext";
import { ExternalLink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TicketAttendeeTab from "./TicketAttendeeTab";
import TicketDocumentCreationTab from "./TicketDocumentCreationTab";

export default function AuctionTicketsWorkflow() {
  const { config } = useConfig();
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
