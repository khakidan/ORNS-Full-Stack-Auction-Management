import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, AlertCircle, PlaySquare, Loader2, Copy, CheckSquare, RefreshCw } from "lucide-react";
import { updateSheetData, appendSheetData, getSheetData, getBaseUrl } from "@/lib/google-api";

export interface Config {
  auctionItemsSpreadsheetId: string;
  auctionTicketsSpreadsheetId: string;
  bidManagementSpreadsheetId: string;
  bidderNumbersSheet: string;
  auctionItemsSheet: string;
  bidManagementSheet: string;
  receiptFolderId: string;
  ornsLogoId: string;
  ticketPrice: string;
  auctionItemsScriptId: string;
  auctionTicketsScriptId: string;
  bidManagementScriptId: string;
}

export default function ConfigSettings() {
  const [config, setConfig] = useState<Config>({
    auctionItemsSpreadsheetId: localStorage.getItem("auctionItemsSpreadsheetId") || "",
    auctionTicketsSpreadsheetId: localStorage.getItem("auctionTicketsSpreadsheetId") || "",
    bidManagementSpreadsheetId: localStorage.getItem("bidManagementSpreadsheetId") || localStorage.getItem("spreadsheetId") || "",
    bidderNumbersSheet: localStorage.getItem("bidderNumbersSheet") || "Bidder-Numbers",
    auctionItemsSheet: localStorage.getItem("auctionItemsSheet") || "Auction-Items",
    bidManagementSheet: localStorage.getItem("bidManagementSheet") || "Bid-Management",
    receiptFolderId: localStorage.getItem("receiptFolderId") || "",
    ornsLogoId: localStorage.getItem("ornsLogoId") || "",
    ticketPrice: localStorage.getItem("ticketPrice") || "35",
    auctionItemsScriptId: localStorage.getItem("auctionItemsScriptId") || "",
    auctionTicketsScriptId: localStorage.getItem("auctionTicketsScriptId") || "",
    bidManagementScriptId: localStorage.getItem("bidManagementScriptId") || localStorage.getItem("googleScriptId") || "",
  });
  const [initializing, setInitializing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const redirectUri = `${window.location.origin}/auth/callback`;

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(redirectUri);
        setCopySuccess(true);
        toast.success("Redirect URI copied to clipboard");
        setTimeout(() => setCopySuccess(false), 2000);
      } else {
        throw new Error("Clipboard API not available");
      }
    } catch (err) {
      console.error("Clipboard error:", err);
      toast.error("Failed to copy. Please select and copy the text manually.");
    }
  };

  const extractId = (input: string): string => {
    if (!input) return "";
    if (input.includes("script.google.com")) {
      const match = input.match(/\/projects\/([a-zA-Z0-9-_]+)/);
      if (match) return match[1];
    }
    if (input.includes("/d/")) {
      const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match) return match[1];
    }
    if (input.includes("/folders/")) {
      const match = input.match(/\/folders\/([a-zA-Z0-9-_]+)/);
      if (match) return match[1];
    }
    if (input.includes("id=")) {
      const match = input.match(/id=([a-zA-Z0-9-_]+)/);
      if (match) return match[1];
    }
    return input.trim();
  };

  const syncSettingsFromCloud = async () => {
    // We'll sync from Bid Management by default as it was the original "Main" spreadsheet
    const spreadsheetId = extractId(config.bidManagementSpreadsheetId);
    if (!spreadsheetId) {
      toast.error("Please enter a Bid Management Spreadsheet ID first to sync.");
      return;
    }

    try {
      setInitializing(true);
      const data = await getSheetData(spreadsheetId, "_Settings!A:C");
      if (data && data.values) {
        let newReceiptFolderId = config.receiptFolderId;
        let newOrnsLogoId = config.ornsLogoId;
        let newTicketPrice = config.ticketPrice;

        for (const row of data.values) {
          if (row[0] === "receiptFolderID") newReceiptFolderId = row[1];
          if (row[0] === "ornsLogoID") newOrnsLogoId = row[1];
          if (row[0] === "ticketPrice") newTicketPrice = row[1];
        }

        setConfig(curr => ({
          ...curr,
          receiptFolderId: newReceiptFolderId,
          ornsLogoId: newOrnsLogoId,
          ticketPrice: newTicketPrice
        }));

        toast.success("Settings synced from cloud!");
      } else {
         toast.info("No existing settings found in _Settings sheet.");
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to sync from cloud. Checking if _Settings tab exists in your sheet.");
    } finally {
      setInitializing(false);
    }
  };

  const syncSettingToCloud = async (spreadsheetId: string, key: string, value: string, description: string) => {
    await fetch(`${getBaseUrl()}/api/settings/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spreadsheetId,
        key,
        value,
        description
      }),
      credentials: "include"
    });
  };

  const handleSave = async () => {
    setSavingSettings(true);
    
    const bidMgtId = extractId(config.bidManagementSpreadsheetId);
    const auctionItemsId = extractId(config.auctionItemsSpreadsheetId);
    const auctionTicketsId = extractId(config.auctionTicketsSpreadsheetId);

    const receiptFolderId = extractId(config.receiptFolderId);
    const ornsLogoId = extractId(config.ornsLogoId);
    const auctionItemsScriptId = extractId(config.auctionItemsScriptId);
    const auctionTicketsScriptId = extractId(config.auctionTicketsScriptId);
    const bidManagementScriptId = extractId(config.bidManagementScriptId);

    localStorage.setItem("bidManagementSpreadsheetId", bidMgtId);
    // Legacy support for older components that might still read 'spreadsheetId'
    localStorage.setItem("spreadsheetId", bidMgtId); 
    
    localStorage.setItem("auctionItemsSpreadsheetId", auctionItemsId);
    localStorage.setItem("auctionTicketsSpreadsheetId", auctionTicketsId);
    
    localStorage.setItem("bidderNumbersSheet", config.bidderNumbersSheet);
    localStorage.setItem("auctionItemsSheet", config.auctionItemsSheet);
    localStorage.setItem("bidManagementSheet", config.bidManagementSheet);
    localStorage.setItem("receiptFolderId", receiptFolderId);
    localStorage.setItem("ornsLogoId", ornsLogoId);
    localStorage.setItem("ticketPrice", config.ticketPrice);
    localStorage.setItem("auctionItemsScriptId", auctionItemsScriptId);
    localStorage.setItem("auctionTicketsScriptId", auctionTicketsScriptId);
    localStorage.setItem("bidManagementScriptId", bidManagementScriptId);
    // Legacy support
    localStorage.setItem("googleScriptId", bidManagementScriptId);
    
    // Sync to Bid Management
    if (bidMgtId) {
      try {
        await syncSettingToCloud(bidMgtId, "ticketPrice", config.ticketPrice, "Standard Walk-In Ticket Price");
        await syncSettingToCloud(bidMgtId, "receiptFolderID", receiptFolderId, "Receipts Folder ID");
        await syncSettingToCloud(bidMgtId, "ornsLogoID", ornsLogoId, "ORNS Logo File ID");
      } catch (err) {
        console.error("Failed to sync settings to cloud:", err);
      }
    }

    setSavingSettings(false);
    toast.success("Settings saved locally and synced to cloud");
    setTimeout(() => window.location.reload(), 1000);
  };

  const initializeSheets = async () => {
    if (!config.bidManagementSpreadsheetId) {
      toast.error("Please provide a Bid Management Spreadsheet ID first");
      return;
    }

    setInitializing(true);
    try {
      await updateSheetData(config.bidManagementSpreadsheetId, `${config.bidderNumbersSheet}!A1:H1`, [[
        "ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid"
      ]]);
      
      await updateSheetData(config.bidManagementSpreadsheetId, `${config.auctionItemsSheet}!A1:E1`, [[
        "ID", "Item Name", "Description", "Starting Bid", "Donor"
      ]]);
      
      await appendSheetData(config.bidManagementSpreadsheetId, `${config.auctionItemsSheet}!A2:E`, [
        [1401, 'A Night with the ORNS Staff', '', 0, 'ORNS'],
        [1501, 'One Raffle Ticket ($500 Amazon)', '', 20, 'ORNS'],
        [1606, 'Auction Tickets', '', 35, 'ORNS']
      ]);

      toast.success("Sheet structure initialized! Columns and headers created.");
    } catch (error: any) {
      console.error(error);
      toast.error("Failed to initialize sheet. Make sure the Sheet ID is correct and you have access.");
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Google OAuth Helper</CardTitle>
          <CardDescription>
            Your Google Cloud Console must have this exact Authorised redirect URI:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="bg-slate-100 p-2 rounded text-xs flex-1 border font-mono truncate">
              {redirectUri}
            </code>
            <Button variant="outline" size="sm" onClick={copyToClipboard} className="gap-2 shrink-0">
              {copySuccess ? <CheckSquare className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copySuccess ? "Copied" : "Copy"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auction Configuration</CardTitle>
          <CardDescription>
            Configure the Google Sheet IDs for your different workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6">
            
            <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Spreadsheet Workflows</h3>
              
              <div className="space-y-2">
                <Label htmlFor="auctionItemsSpreadsheetId">1. Auction Item Data Entry Spreadsheet ID</Label>
                <Input
                  id="auctionItemsSpreadsheetId"
                  placeholder="Paste full URL or ID"
                  value={config.auctionItemsSpreadsheetId}
                  onChange={(e) => setConfig({ ...config, auctionItemsSpreadsheetId: extractId(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">Database for all auction items pre-auction.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="auctionTicketsSpreadsheetId">2. Auction Tickets Spreadsheet ID</Label>
                <Input
                  id="auctionTicketsSpreadsheetId"
                  placeholder="Paste full URL or ID"
                  value={config.auctionTicketsSpreadsheetId}
                  onChange={(e) => setConfig({ ...config, auctionTicketsSpreadsheetId: extractId(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">Source of truth for bidders and check-in before auction.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bidManagementSpreadsheetId">3. Bid Management Spreadsheet ID</Label>
                <Input
                  id="bidManagementSpreadsheetId"
                  placeholder="Paste full URL or ID"
                  value={config.bidManagementSpreadsheetId}
                  onChange={(e) => setConfig({ ...config, bidManagementSpreadsheetId: extractId(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">Main event bid tracking and checkout spreadsheet.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bidderNumbersSheet">Bidder Numbers Sheet Name</Label>
                <Input
                  id="bidderNumbersSheet"
                  value={config.bidderNumbersSheet}
                  onChange={(e) => setConfig({ ...config, bidderNumbersSheet: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auctionItemsSheet">Auction Items Sheet Name</Label>
                <Input
                  id="auctionItemsSheet"
                  value={config.auctionItemsSheet}
                  onChange={(e) => setConfig({ ...config, auctionItemsSheet: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bidManagementSheet">Bid Management Sheet Name</Label>
                <Input
                  id="bidManagementSheet"
                  value={config.bidManagementSheet}
                  onChange={(e) => setConfig({ ...config, bidManagementSheet: e.target.value })}
                />
              </div>
              <div className="col-span-1 md:col-span-2 mt-4 space-y-4">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground border-b pb-2">Google Apps Script IDs</h3>
                <div className="space-y-2">
                  <Label htmlFor="auctionItemsScriptId">1. Auction Item Data Entry Script ID</Label>
                  <Input
                    id="auctionItemsScriptId"
                    placeholder="Paste script URL or ID"
                    value={config.auctionItemsScriptId}
                    onChange={(e) => setConfig({ ...config, auctionItemsScriptId: extractId(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auctionTicketsScriptId">2. Auction Tickets Script ID</Label>
                  <Input
                    id="auctionTicketsScriptId"
                    placeholder="Paste script URL or ID"
                    value={config.auctionTicketsScriptId}
                    onChange={(e) => setConfig({ ...config, auctionTicketsScriptId: extractId(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bidManagementScriptId">3. Bid Management Script ID</Label>
                  <Input
                    id="bidManagementScriptId"
                    placeholder="Paste script URL or ID"
                    value={config.bidManagementScriptId}
                    onChange={(e) => setConfig({ ...config, bidManagementScriptId: extractId(e.target.value) })}
                  />
                </div>
              </div>

              <div className="col-span-1 md:col-span-2 mt-4 space-y-4">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground border-b pb-2">Styling & Files</h3>
              </div>
              <div className="space-y-2">
                <Label htmlFor="receiptFolderId">Receipts Folder ID</Label>
                <Input
                  id="receiptFolderId"
                  placeholder="Paste folder URL or ID"
                  value={config.receiptFolderId}
                  onChange={(e) => setConfig({ ...config, receiptFolderId: extractId(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ornsLogoId">ORNS Logo File ID</Label>
                <Input
                  id="ornsLogoId"
                  placeholder="Paste image URL or ID"
                  value={config.ornsLogoId}
                  onChange={(e) => setConfig({ ...config, ornsLogoId: extractId(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticketPrice">Walk-In Ticket Price ($)</Label>
                <Input
                  id="ticketPrice"
                  type="number"
                  placeholder="35"
                  value={config.ticketPrice}
                  onChange={(e) => setConfig({ ...config, ticketPrice: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={handleSave} disabled={savingSettings} className="flex-1 gap-2 h-12">
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Configuration
            </Button>
            <Button 
                variant="outline" 
                onClick={syncSettingsFromCloud} 
                disabled={initializing}
                className="flex-1 gap-2 h-12 border-primary/20 hover:bg-primary/5"
            >
              <RefreshCw className={`w-4 h-4 ${initializing ? 'animate-spin' : ''}`} />
              Sync from Cloud
            </Button>
            <Button 
                variant="outline" 
                onClick={initializeSheets} 
                disabled={initializing}
                className="flex-1 gap-2 h-12 border-primary/20 hover:bg-primary/5"
            >
              {initializing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlaySquare className="w-4 h-4" />}
              Initialize Main Sheets
            </Button>
          </div>
        </CardContent>
      </Card>
      
    </div>
  );
}
