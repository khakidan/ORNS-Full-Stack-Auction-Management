import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { RefreshCw } from "lucide-react";

interface SetupNewAuctionCardProps {
  isSettingUpNewAuction: boolean;
  onRun: () => Promise<void>;
}

export default function SetupNewAuctionCard({ isSettingUpNewAuction, onRun }: SetupNewAuctionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5 text-muted-foreground" />Setup New Auction Year</CardTitle>
        <CardDescription>
          Automate folder archiving, new year setup, and master spreadsheet cleanup. Only run this when starting a new auction year.
          It backs up your current master spreadsheets to last year's folder first, then creates the new year's folder structure and
          clears the rows in your data sheets, ready for the upcoming auction. If the backup fails, nothing is cleared.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoadingButton
          variant="destructive"
          loading={isSettingUpNewAuction}
          loadingText="Setting Up..."
          icon={<RefreshCw className="w-4 h-4" />}
          onClick={onRun}
          className="gap-2"
        >
          Run New Auction Setup
        </LoadingButton>
      </CardContent>
    </Card>
  );
}
