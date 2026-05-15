import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlaySquare, Download, Package } from "lucide-react";
import { toast } from "sonner";
import { getBaseUrl } from "@/lib/google-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AuctionItemsTab from "./AuctionItemsTab";
import DocumentCreationTab from "./DocumentCreationTab";

export default function AuctionItemsWorkflow() {
  const spreadsheetId = localStorage.getItem("auctionItemsSpreadsheetId");
  const [activeTab, setActiveTab] = useState("auction_items");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Auction Items Management</h2>
          <p className="text-muted-foreground mt-2">
            The database for all auction items. Assign categories, bundle items, and generate documents.
          </p>
        </div>
        {spreadsheetId && (
          <Button variant="outline" onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, "_blank")}>
            Open Spreadsheet
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto pb-2 -mx-6 px-6 md:mx-0 md:px-0">
          <TabsList className="bg-slate-200/50 p-1">
            <TabsTrigger value="auction_items" className="gap-2 px-4 py-2">
              Auction Items
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-2 px-4 py-2">
              Document & Presentation Creation
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="auction_items" className="m-0">
          <AuctionItemsTab />
        </TabsContent>

        <TabsContent value="documents" className="m-0">
          <DocumentCreationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
