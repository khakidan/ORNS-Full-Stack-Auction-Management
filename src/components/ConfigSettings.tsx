import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, AlertCircle, PlaySquare, Loader2, Copy, CheckSquare, RefreshCw, Cloud, CloudOff, LogIn, ChevronDown, ChevronUp } from "lucide-react";
import { fetchWithRetry, updateSheetData, appendSheetData, getSheetData, getBaseUrl } from "@/lib/google-api";
import { useConfig } from "@/context/ConfigContext";
import { Config } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ConfigSettings() {
  const { config: remoteConfig, saveConfig, firebaseUser, loginToFirebase, loading: configLoading } = useConfig();
  const [config, setConfig] = useState<Config>(remoteConfig);

  useEffect(() => {
    setConfig(remoteConfig);
  }, [remoteConfig]);

  const [initializing, setInitializing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isSettingUpNewAuction, setIsSettingUpNewAuction] = useState(false);
  const [showManualCopyDialog, setShowManualCopyDialog] = useState(false);
  const [auctionYear, setAuctionYear] = useState<number | null>(null);
  const [isAuctionConfigOpen, setIsAuctionConfigOpen] = useState(false);
  const [isSetupNewAuctionOpen, setIsSetupNewAuctionOpen] = useState(false);

  const redirectUri = `${window.location.origin}/auth/callback`;

  const handleSetupNewAuction = async () => {
    if (!window.confirm("Are you SURE you want to create a new auction instance? This will clear all data in the master spreadsheets!")) {
      return;
    }
    
    setIsSettingUpNewAuction(true);
    const toastId = toast.loading("Setting up new auction folder structure and backing up data. This may take a minute or two...", { duration: Infinity });
    
    try {
      const bidMgtId = extractId(config.bidManagementSpreadsheetId);
      const auctionItemsId = extractId(config.auctionItemsSpreadsheetId);
      const auctionTicketsId = extractId(config.auctionTicketsSpreadsheetId);
      
      const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/setup-new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketsSpreadsheetId: auctionTicketsId,
          itemEntrySpreadsheetId: auctionItemsId,
          bidManagementSpreadsheetId: bidMgtId
        }),
      });
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      let data: any = null;

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                const msg = JSON.parse(line);
                if (msg.log) {
                  toast.loading(msg.log, { id: toastId });
                } else {
                  // If it has success or error, it's the final payload
                  data = msg;
                }
              } catch(e) {}
            }
          }
        }
      }

      if (!data) {
        throw new Error("Failed to receive valid response from server");
      }
      
      if (data.logs && Array.isArray(data.logs)) {
        console.group("New Auction Setup Logs");
        data.logs.forEach((logMsg: string) => console.log(logMsg));
        console.groupEnd();
      }

      if (data.success) {
        toast.dismiss(toastId);
        
        // Auto-assign new folder IDs
        const newReceipts = data.bidderReceiptsFolderId || config.receiptFolderId;
        const newPrint = data.forPrintFolderId || config.forPrintFolderId;
        
        const updatedConfig = {
          ...config,
          receiptFolderId: newReceipts,
          forPrintFolderId: newPrint
        };

        setConfig(updatedConfig);
        
        try {
          await saveConfig(updatedConfig);
          localStorage.setItem("receiptFolderId", newReceipts);
          localStorage.setItem("forPrintFolderId", newPrint);
        } catch (e) {
          console.error("Auto-save failed", e);
        }
        
        // Show success and open dialog
        toast.success(`Success! New folders created. IDs updated.`, { duration: 5000 });
        setAuctionYear(data.auctionYear);
        setShowManualCopyDialog(true);
      } else {
        toast.error(data.error || "Failed to setup new auction", { id: toastId, duration: 5000 });
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "An error occurred", { id: toastId, duration: 5000 });
    } finally {
      setIsSettingUpNewAuction(false);
    }
  };

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
        let newForPrintFolderId = config.forPrintFolderId;
        let newOrnsLogoId = config.ornsLogoId;
        let newTicketPrice = config.ticketPrice;

        for (const row of data.values) {
          if (row[0] === "receiptFolderID") newReceiptFolderId = row[1];
          if (row[0] === "forPrintFolderID") newForPrintFolderId = row[1];
          if (row[0] === "ornsLogoID") newOrnsLogoId = row[1];
          if (row[0] === "ticketPrice") newTicketPrice = row[1];
        }

        setConfig(curr => ({
          ...curr,
          receiptFolderId: newReceiptFolderId,
          forPrintFolderId: newForPrintFolderId,
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
    await fetchWithRetry(`${getBaseUrl()}/api/settings/update`, {
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
    const forPrintFolderId = extractId(config.forPrintFolderId);
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
    localStorage.setItem("forPrintFolderId", forPrintFolderId);
    localStorage.setItem("ornsLogoId", ornsLogoId);
    localStorage.setItem("ticketPrice", config.ticketPrice);
    localStorage.setItem("auctionItemsScriptId", auctionItemsScriptId);
    localStorage.setItem("auctionTicketsScriptId", auctionTicketsScriptId);
    localStorage.setItem("bidManagementScriptId", bidManagementScriptId);
    // Legacy support
    localStorage.setItem("googleScriptId", bidManagementScriptId);

    // Save to Firebase for cross-device sync
    try {
      await saveConfig({
        ...config,
        bidManagementSpreadsheetId: bidMgtId,
        auctionItemsSpreadsheetId: auctionItemsId,
        auctionTicketsSpreadsheetId: auctionTicketsId,
        receiptFolderId,
        forPrintFolderId,
        ornsLogoId,
        auctionItemsScriptId,
        auctionTicketsScriptId,
        bidManagementScriptId
      });
    } catch (err) {
      console.error("Firebase sync failed:", err);
      // We don't block saving locally if Firebase fails, but we already toasted in saveConfig
    }
    
    // Sync to Bid Management Spreadsheet (Legacy cloud sync)
    if (bidMgtId) {
      try {
        await syncSettingToCloud(bidMgtId, "ticketPrice", config.ticketPrice, "Standard Walk-In Ticket Price");
        await syncSettingToCloud(bidMgtId, "receiptFolderID", receiptFolderId, "Receipts Folder ID");
        await syncSettingToCloud(bidMgtId, "forPrintFolderID", forPrintFolderId, "For Print Folder ID");
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
      <Card className={`${firebaseUser ? 'border-emerald-200 bg-emerald-50/10' : 'border-amber-200 bg-amber-50/10'}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {firebaseUser ? <Cloud className="w-5 h-5 text-emerald-600" /> : <CloudOff className="w-5 h-5 text-amber-600" />}
              Cloud Sync Status
            </CardTitle>
            {firebaseUser ? (
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Synced: {firebaseUser.email}
              </div>
            ) : (
               <div className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                Offline Sync
              </div>
            )}
          </div>
          <CardDescription>
            {firebaseUser 
              ? "Your configuration is automatically backed up and synced across all your devices."
              : "Settings are currently only saved on this device. Sign in to enable cross-device synchronization."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!firebaseUser && (
            <Button variant="outline" onClick={loginToFirebase} className="w-full gap-2 border-amber-300 hover:bg-amber-100/50">
              <LogIn className="w-4 h-4" />
              Sign in to Sync Across Devices
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="hidden">
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

      <Card className="border border-blue-200">
        <CardHeader 
          className="bg-blue-50/50 border-b border-blue-100 cursor-pointer hover:bg-blue-100/50 transition-colors rounded-t-lg"
          onClick={() => setIsSetupNewAuctionOpen(!isSetupNewAuctionOpen)}
        >
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-blue-900">Setup New Auction Year</CardTitle>
              <CardDescription>
                Automate folder archiving, new year setup, and master spreadsheet cleanup. Only run this when starting a new auction year.
              </CardDescription>
            </div>
            {isSetupNewAuctionOpen ? <ChevronUp className="w-5 h-5 text-blue-900/70" /> : <ChevronDown className="w-5 h-5 text-blue-900/70" />}
          </div>
        </CardHeader>
        {isSetupNewAuctionOpen && (
        <CardContent className="pt-6">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This workflow will back up your current master spreadsheets to last year's folder, create the new year's folder structure, and automatically clear the rows in your data sheets so that they are completely empty and ready to be populated for the upcoming auction.
            </p>
            <Button
              variant="destructive"
              disabled={isSettingUpNewAuction}
              onClick={handleSetupNewAuction}
              className="gap-2"
            >
              {isSettingUpNewAuction ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isSettingUpNewAuction ? "Setting Up..." : "Run New Auction Setup"}
            </Button>
          </div>
        </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader 
          className="cursor-pointer hover:bg-slate-50 transition-colors rounded-t-lg" 
          onClick={() => setIsAuctionConfigOpen(!isAuctionConfigOpen)}
        >
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Auction Configuration</CardTitle>
              <CardDescription>
                Configure the Google Sheet IDs for your different workflows.
              </CardDescription>
            </div>
            {isAuctionConfigOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
          </div>
        </CardHeader>
        {isAuctionConfigOpen && (
        <CardContent className="space-y-6 pt-0">
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

            <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Google Apps Script Workflows</h3>
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

            {/* Hidden Fields kept for state management */}
            <div className="hidden">
              <Input value={config.bidderNumbersSheet} onChange={(e) => setConfig({ ...config, bidderNumbersSheet: e.target.value })} />
              <Input value={config.auctionItemsSheet} onChange={(e) => setConfig({ ...config, auctionItemsSheet: e.target.value })} />
              <Input value={config.bidManagementSheet} onChange={(e) => setConfig({ ...config, bidManagementSheet: e.target.value })} />
              <Input value={config.receiptFolderId} onChange={(e) => setConfig({ ...config, receiptFolderId: extractId(e.target.value) })} />
              <Input value={config.forPrintFolderId} onChange={(e) => setConfig({ ...config, forPrintFolderId: extractId(e.target.value) })} />
              <Input value={config.ornsLogoId} onChange={(e) => setConfig({ ...config, ornsLogoId: extractId(e.target.value) })} />
            </div>

          </div>
        </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ticket Pricing</CardTitle>
          <CardDescription>Configure the standard walk-in ticket price for the event.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="ticketPrice">Walk-In Ticket Price ($)</Label>
            <Input
              id="ticketPrice"
              type="number"
              placeholder="35"
              value={config.ticketPrice}
              onChange={(e) => setConfig({ ...config, ticketPrice: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 pt-6 pb-6">
        <Button onClick={handleSave} disabled={savingSettings} className="flex-1 gap-2 h-12 text-md">
          {savingSettings ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          Save Configuration
        </Button>
      </div>
      
      <Dialog open={showManualCopyDialog} onOpenChange={setShowManualCopyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Copy Required</DialogTitle>
            <DialogDescription>
              Because these files require custom historical data, they are not auto-copied. Once your new folder is generated, please manually copy the following from last year's folder:
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ul className="list-disc pl-6 space-y-2 text-sm text-foreground font-medium">
              <li>Auction Donation List {auctionYear}</li>
              <li>Auction {auctionYear} Ideas</li>
            </ul>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowManualCopyDialog(false)}>I have confirmed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
