import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface SetupNewAuctionCardProps {
  isOpen: boolean;
  onToggle: () => void;
  isSettingUpNewAuction: boolean;
  onRun: () => Promise<void>;
}

export default function SetupNewAuctionCard({ isOpen, onToggle, isSettingUpNewAuction, onRun }: SetupNewAuctionCardProps) {
  return (
    <Card className="border border-blue-200">
      <CardHeader
        className="bg-blue-50/50 border-b border-blue-100 cursor-pointer hover:bg-blue-100/50 transition-colors rounded-t-lg"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-blue-900">Setup New Auction Year</CardTitle>
            <CardDescription>
              Automate folder archiving, new year setup, and master spreadsheet cleanup. Only run this when starting a new auction year.
            </CardDescription>
          </div>
          {isOpen ? <ChevronUp className="w-5 h-5 text-blue-900/70" /> : <ChevronDown className="w-5 h-5 text-blue-900/70" />}
        </div>
      </CardHeader>
      {isOpen && (
      <CardContent className="pt-6">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This workflow will back up your current master spreadsheets to last year's folder, create the new year's folder structure, and automatically clear the rows in your data sheets so that they are completely empty and ready to be populated for the upcoming auction.
          </p>
          <Button
            variant="destructive"
            disabled={isSettingUpNewAuction}
            onClick={onRun}
            className="gap-2"
          >
            {isSettingUpNewAuction ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isSettingUpNewAuction ? "Setting Up..." : "Run New Auction Setup"}
          </Button>
        </div>
      </CardContent>
      )}
    </Card>
  );
}
