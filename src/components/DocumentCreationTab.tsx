import { useState, useEffect } from "react";
import { useConfig } from "@/context/ConfigContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlaySquare, Download, FileText, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/lib/google-api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { useAuction } from "@/context/AuctionContext";

export default function DocumentCreationTab() {
  const { isAuctionClosed } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.auctionItemsSpreadsheetId;
  const scriptId = config.auctionItemsScriptId;
  const forPrintFolderId = config.forPrintFolderId;
  
  const [files, setFiles] = useState<any[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const fetchFiles = async () => {
    if (!forPrintFolderId || ["undefined", "null", ""].includes(forPrintFolderId) || forPrintFolderId.includes("PASTE")) {
      setLoadingFiles(false);
      return;
    }
    setLoadingFiles(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/drive/files/${forPrintFolderId}`);
      if (res.status === 404) {
        setFiles([]);
        return; // Silent fail on mount to avoid annoying toast if ID is wrong
      }
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch files");
      }
      const data = await res.json();
      setFiles(data);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [forPrintFolderId]);

  const runScript = async (functionName: string, label: string) => {
    if (!spreadsheetId || !scriptId || spreadsheetId.includes("PASTE") || scriptId.includes("PASTE")) {
      toast.error("Please correctly configure the Auction Items Spreadsheet ID and Script ID in Settings.");
      return;
    }

    try {
      toast.loading(`Running ${label}...`, { id: functionName });
      const res = await fetchWithRetry(`${getBaseUrl()}/api/script/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ functionName, parameters: [config.forPrintFolderId], scriptId })
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

  const folderId = config.forPrintFolderId;
  const isInvalidFolder = !folderId || folderId === "undefined" || folderId === "null" || folderId.includes("PASTE");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" /> 
              Creation Tools
            </CardTitle>
            <CardDescription>
              Generate printable documents and presentations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
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

            {isAuctionClosed && (
              <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex items-center gap-2 mt-4">
                <Loader2 className="w-3 h-3 animate-pulse" />
                Auction Closed: Creation tools disabled.
              </p>
            )}
            
            <p className="text-[10px] text-muted-foreground mt-4 px-1 italic">
              Note: Documents will be placed in your For Print folder.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> 
                For Print Folder Contents
              </CardTitle>
              <CardDescription>
                Files recently generated for the auction.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={fetchFiles} disabled={loadingFiles || isInvalidFolder}>
              <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin' : ''}`} />
            </Button>
          </CardHeader>
          <CardContent>
            {isInvalidFolder ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-2">For Print Folder ID not configured.</p>
                <p className="text-xs">Set it in the Configuration {'>'} Styling & Files section.</p>
              </div>
            ) : loadingFiles ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary/30" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground">No files found in the For Print folder.</p>
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>File Name</TableHead>
                      <TableHead>Modified</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow key={file.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {file.iconLink && <img src={file.iconLink} alt="" className="w-4 h-4" referrerPolicy="no-referrer" />}
                            <span className="truncate max-w-[200px] sm:max-w-xs" title={file.name}>{file.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(file.modifiedTime).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 gap-1"
                            onClick={() => window.open(file.webViewLink, "_blank")}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
