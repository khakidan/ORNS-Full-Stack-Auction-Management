import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Config } from "@/types";
import { extractId } from "@/hooks/useConfigSettingsState";

interface AuctionConfigurationCardProps {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  isOpen: boolean;
  onToggle: () => void;
}

export default function AuctionConfigurationCard({ config, setConfig, isOpen, onToggle }: AuctionConfigurationCardProps) {
  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-slate-50 transition-colors rounded-t-lg"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Auction Configuration</CardTitle>
            <CardDescription>
              Configure the Google Sheet IDs for your different workflows.
            </CardDescription>
          </div>
          {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
        </div>
      </CardHeader>
      {isOpen && (
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
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Bug Reports</h3>

            <div className="space-y-2">
              <Label htmlFor="bugReportsSpreadsheetId">Bug Reports Spreadsheet ID</Label>
              <Input
                id="bugReportsSpreadsheetId"
                placeholder="Paste full URL or ID"
                value={config.bugReportsSpreadsheetId}
                onChange={(e) => setConfig({ ...config, bugReportsSpreadsheetId: extractId(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">Central catalog every in-app bug report (Ctrl/Cmd+Shift+B) gets saved to.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bugReportsFolderId">Bug Reports Screenshots Folder ID</Label>
              <Input
                id="bugReportsFolderId"
                placeholder="Paste full URL or ID"
                value={config.bugReportsFolderId}
                onChange={(e) => setConfig({ ...config, bugReportsFolderId: extractId(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">Optional - if left blank, reports still save without a screenshot link.</p>
            </div>
          </div>

          <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Google Apps Script Workflows</h3>
            {/* No Script ID boxes: the server runs the three scripts by the
                IDs in its own environment (SCRIPT_ID_*), never these. The
                boxes used to be here and changed nothing. */}
            <p className="text-sm text-muted-foreground">
              The app runs the Item Entry, Tickets and Bid Management scripts using Script IDs set on the server
              (the Cloud Run settings <code>SCRIPT_ID_ITEM_ENTRY</code>, <code>SCRIPT_ID_TICKETS</code> and{" "}
              <code>SCRIPT_ID_BID_MANAGEMENT</code>). They can't be changed here.
            </p>
          </div>

          {/* Hidden Fields kept for state management */}
          <div className="hidden">
            <Input value={config.bidderNumbersSheet} onChange={(e) => setConfig({ ...config, bidderNumbersSheet: e.target.value })} />
            <Input value={config.bidManagementSheet} onChange={(e) => setConfig({ ...config, bidManagementSheet: e.target.value })} />
            <Input value={config.receiptFolderId} onChange={(e) => setConfig({ ...config, receiptFolderId: extractId(e.target.value) })} />
            <Input value={config.forPrintFolderId} onChange={(e) => setConfig({ ...config, forPrintFolderId: extractId(e.target.value) })} />
            <Input value={config.ornsLogoId} onChange={(e) => setConfig({ ...config, ornsLogoId: extractId(e.target.value) })} />
          </div>

        </div>
      </CardContent>
      )}
    </Card>
  );
}
