import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { PlaySquare, Download, FileText, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { cn } from "@/lib/utils";

import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";

export default function TicketDocumentCreationTab() {
  const { isAuctionClosed } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.auctionTicketsSpreadsheetId;
  const forPrintFolderId = config.forPrintFolderId;
  const bidManagementSpreadsheetId = config.bidManagementSpreadsheetId;
  
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
        return;
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
    if (!spreadsheetId || spreadsheetId.includes("PASTE")) {
      toast.error("Please correctly configure the Auction Tickets Spreadsheet ID in Settings.");
      return;
    }
    if (!bidManagementSpreadsheetId || bidManagementSpreadsheetId.includes("PASTE")) {
      toast.error("Please correctly configure the Bid Management Spreadsheet ID in Settings.");
      return;
    }

    try {
      toast.loading(`Running ${label}...`, { id: functionName });

      const endpoint = "/api/production/tickets/bidder-labels";

      const res = await fetchWithRetry(`${getBaseUrl()}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: forPrintFolderId, bidManagementSpreadsheetId })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      toast.success(`${label} completed!`, { id: functionName });
      setTimeout(fetchFiles, 3000);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`, { id: functionName });
    }
  };

  const isInvalidFolder = !forPrintFolderId || forPrintFolderId === "undefined" || forPrintFolderId === "null" || forPrintFolderId.includes("PASTE");

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
              Generate printable documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              className="w-full justify-start gap-2" 
              variant="secondary" 
              onClick={() => runScript('apiCreateBidderLabels', 'Create Bidder Labels')}
              disabled={isAuctionClosed}
            >
              <PlaySquare className="w-4 h-4 text-emerald-600" />
              Create Bidder Labels Doc
            </Button>
            
            {isAuctionClosed && (
              <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex items-center gap-2">
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
            <IconButton
              variant="ghost"
              aria-label="Refresh files"
              icon={<RefreshCw className={cn("w-4 h-4", loadingFiles && "animate-spin")} />}
              onClick={fetchFiles}
              disabled={loadingFiles || isInvalidFolder}
            />
          </CardHeader>
          <CardContent>
            {isInvalidFolder ? (
              <StatusStatePlaceholder
                bordered
                icon={<FileText />}
                description={
                  <>
                    For Print Folder ID not configured.
                    <p className="text-xs mt-1">Set it in the Configuration {'>'} Styling & Files section.</p>
                  </>
                }
              />
            ) : loadingFiles ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary/30" />
              </div>
            ) : files.length === 0 ? (
              <StatusStatePlaceholder bordered icon={<FileText />} description="No files found in the For Print folder." />
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
