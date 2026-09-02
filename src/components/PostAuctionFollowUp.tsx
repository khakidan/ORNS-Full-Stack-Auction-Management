import { AlertCircle, Clock, ExternalLink, RefreshCw, UserX } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FollowUpListPanel } from "@/components/FollowUpListPanel";
import { Bidder } from "@/types";
import { cn } from "@/lib/utils";

interface PostAuctionFollowUpProps {
  pendingCheckoutBidders: Bidder[];
  followUpRecords: string[][];
  unattendedBidders: Bidder[];
  loadingFollowUp: boolean;
  onRefresh: () => void;
  getBidderName: (id: string) => string;
}

export function PostAuctionFollowUp({
  pendingCheckoutBidders,
  followUpRecords,
  unattendedBidders,
  loadingFollowUp,
  onRefresh,
  getBidderName,
}: PostAuctionFollowUpProps) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <Card className="border-amber-200 bg-amber-50/20 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-amber-800 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Post-Auction Follow-Up
            </CardTitle>
            <CardDescription className="text-amber-700/80">
              Critical actions to take after the auction has closed.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loadingFollowUp}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loadingFollowUp && "animate-spin")} />
            Refresh Lists
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <FollowUpListPanel
              icon={<Clock className="w-4 h-4" />}
              title="Still Need to Check Out"
              count={pendingCheckoutBidders.length}
              countBadgeClassName="bg-amber-100 text-amber-700"
              isEmpty={pendingCheckoutBidders.length === 0}
              emptyMessage="All present bidders have checked out."
            >
              {pendingCheckoutBidders.map(b => (
                <div key={b.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <div className="font-bold text-sm">#{b.id} {b.firstName} {b.lastName}</div>
                    <div className="text-xs text-muted-foreground">{b.email}</div>
                  </div>
                  <Badge variant="outline" className={b.paid ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                    {b.paid ? "Paid" : "Unpaid"}
                  </Badge>
                </div>
              ))}
            </FollowUpListPanel>

            <FollowUpListPanel
              icon={<ExternalLink className="w-4 h-4" />}
              title="Post-Checkout Item Wins"
              count={followUpRecords.length}
              countLabel="Records"
              countBadgeClassName="bg-blue-100 text-blue-700"
              isEmpty={followUpRecords.length === 0}
              emptyMessage="No items have been assigned to checked-out bidders yet."
              note="Note: These records are created automatically when an item is assigned to someone who already checked out."
            >
              {followUpRecords.map((rec, i) => (
                <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <div className="font-bold text-sm">#{rec[0]} {getBidderName(rec[0])}</div>
                    <div className="text-xs text-muted-foreground font-medium text-blue-600">Won Item: {rec[1]}</div>
                  </div>
                  <div>
                    <div className="font-bold text-sm">Still Due</div>
                    <div className="text-xs text-muted-foreground font-medium text-blue-600">${rec[2]}</div>
                  </div>
                </div>
              ))}
            </FollowUpListPanel>

            <FollowUpListPanel
              icon={<UserX className="w-4 h-4" />}
              title="No Shows (Never Checked In)"
              count={unattendedBidders.length}
              countBadgeClassName="bg-red-100 text-red-700"
              isEmpty={unattendedBidders.length === 0}
              emptyMessage="Everyone checked in successfully!"
              note="Note: These registered bidders never checked in, and are left with blank checkout/payment statuses."
            >
              {unattendedBidders.map(b => (
                <div key={b.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <div className="font-bold text-sm">#{b.id} {b.firstName} {b.lastName}</div>
                    <div className="text-xs text-muted-foreground">{b.email}</div>
                  </div>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-100">
                    No Show
                  </Badge>
                </div>
              ))}
            </FollowUpListPanel>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
