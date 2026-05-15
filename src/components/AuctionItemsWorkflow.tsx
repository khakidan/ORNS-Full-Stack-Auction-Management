import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlaySquare, Download, Package } from "lucide-react";
import { toast } from "sonner";
import { getBaseUrl } from "@/lib/google-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AuctionItemsTab from "./AuctionItemsTab";

export default function AuctionItemsWorkflow() {
  const spreadsheetId = localStorage.getItem("auctionItemsSpreadsheetId");
  const scriptId = localStorage.getItem("auctionItemsScriptId");
  const [activeTab, setActiveTab] = useState("auction_items");

  const runScript = async (functionName: string, label: string) => {
    if (!spreadsheetId || !scriptId) {
      toast.error("Please configure the Auction Items Spreadsheet ID and Script ID in Settings.");
      return;
    }

    try {
      toast.loading(`Running ${label}...`, { id: functionName });
      const res = await fetch(`${getBaseUrl()}/api/script/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ functionName, parameters: [spreadsheetId], scriptId })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      toast.success(`${label} completed!`, { id: functionName });
    } catch (e: any) {
      toast.error(`Error: ${e.message}`, { id: functionName });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Auction Items Management</h2>
          <p className="text-muted-foreground mt-2">
            The database for all auction items. Bundle items, assign categories, and generate documents.
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
            <TabsTrigger value="bundling" className="gap-2 px-4 py-2">
              Bundling Management
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-2 px-4 py-2">
              Document & Spreadsheet Creation
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="auction_items" className="m-0">
          <AuctionItemsTab />
        </TabsContent>

        <TabsContent value="bundling" className="m-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Package className="w-5 h-5 text-primary" /> Bundling Management</CardTitle>
              <CardDescription>
                Operate on the item database data. Bundle your items and sync them to your Bid Management system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              <Button className="w-full justify-start gap-2" variant="secondary" onClick={() => runScript('apiBundleItems', 'Bundle Items')}>
                <PlaySquare className="w-4 h-4" />
                Bundle Items
              </Button>
              <Button className="w-full justify-start gap-2" variant="secondary" onClick={() => runScript('apiSyncItemsToMain', 'Sync Items')}>
                <PlaySquare className="w-4 h-4" />
                Sync Items to Bid Management System
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="m-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="w-5 h-5 text-primary" /> Generate Documents</CardTitle>
              <CardDescription>
                Create labels and slide decks for the event.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
               <Button className="w-full justify-start gap-2" variant="secondary" onClick={() => runScript('apiCreateItemLabels', 'Create Item Labels')}>
                <PlaySquare className="w-4 h-4" />
                Create Item Labels Document
              </Button>
              <Button className="w-full justify-start gap-2" variant="secondary" onClick={() => runScript('apiCreateSlideshow', 'Create Slideshow')}>
                <PlaySquare className="w-4 h-4" />
                Create Auction Slideshow
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
