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
  );
}
