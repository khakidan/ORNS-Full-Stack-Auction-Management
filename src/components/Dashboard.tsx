import { useState, useEffect, useMemo } from "react";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, ShoppingBag, TrendingUp, UserCheck, Trophy, Loader2, AlertCircle, Clock, ExternalLink, RefreshCw } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSheetData, updateSheetData } from "@/lib/google-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

import { Bidder } from "@/types";

export default function Dashboard() {
  const { bidders, items, totalRaised, loading, isAuctionClosed, winners } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const [followUpRecords, setFollowUpRecords] = useState<string[][]>([]);
  const [loadingFollowUp, setLoadingFollowUp] = useState(false);

  const [giftCardWinnerId, setGiftCardWinnerId] = useState("");
  const [raffleWinnerId, setRaffleWinnerId] = useState("");
  const [savingGiftCard, setSavingGiftCard] = useState(false);
  const [savingRaffle, setSavingRaffle] = useState(false);

  useEffect(() => {
    const fetchSpecialWinners = async () => {
      if (!spreadsheetId) return;
      try {
        const data = await getSheetData(spreadsheetId, "Special-Winners!A2:B3");
        if (data.values) {
          const rows = data.values;
          if (rows[0] && rows[0][1]) setGiftCardWinnerId(rows[0][1].toString());
          if (rows[1] && rows[1][1]) setRaffleWinnerId(rows[1][1].toString());
        }
      } catch (err) {
        console.error("Failed to fetch special winners", err);
      }
    };
    fetchSpecialWinners();

    if (isAuctionClosed && spreadsheetId) {
      fetchFollowUpRecords();
    }
  }, [spreadsheetId, isAuctionClosed]);

  const fetchFollowUpRecords = async () => {
    setLoadingFollowUp(true);
    try {
      const data = await getSheetData(spreadsheetId, "Follow-Up!A:C");
      if (data.values && data.values.length > 1) {
        setFollowUpRecords(data.values.slice(1));
      }
    } catch (err) {
      console.error("Failed to fetch follow-up records", err);
    } finally {
      setLoadingFollowUp(false);
    }
  };

  const saveGiftCardWinner = async () => {
    if (!spreadsheetId) {
      toast.error("Spreadsheet ID not configured.");
      return;
    }

    const bidder = bidders.find(b => b.id === giftCardWinnerId);
    if (!bidder && giftCardWinnerId) {
      toast.error("Bidder ID not found");
      return;
    }

    if (bidder?.checkedOut) {
      toast.warning("Checked Out Warning", {
        description: `Warning: ${bidder.firstName} ${bidder.lastName} won "$500 Amazon Gift Card" but has already checked out.`,
        duration: Infinity,
        action: {
          label: "I have confirmed",
          onClick: () => console.log("Confirmed checkout warning for gift card"),
        },
      });
    }

    setSavingGiftCard(true);
    try {
      await updateSheetData(spreadsheetId, "Special-Winners!B2", [[giftCardWinnerId]]);
      toast.success("Updated $500 Amazon Gift Card winner");
    } catch (err: any) {
      toast.error("Failed to save winner: " + (err.message || "Unknown error"));
    } finally {
      setSavingGiftCard(false);
    }
  };

  const saveRaffleWinner = async () => {
    if (!spreadsheetId) {
      toast.error("Spreadsheet ID not configured.");
      return;
    }

    const bidder = bidders.find(b => b.id === raffleWinnerId);
    if (!bidder && raffleWinnerId) {
      toast.error("Bidder ID not found");
      return;
    }

    if (bidder?.checkedOut) {
      toast.warning("Checked Out Warning", {
        description: `Warning: ${bidder.firstName} ${bidder.lastName} won "50/50 Raffle" but has already checked out.`,
        duration: Infinity,
        action: {
          label: "I have confirmed",
          onClick: () => console.log("Confirmed checkout warning for raffle"),
        },
      });
    }

    setSavingRaffle(true);
    try {
      await updateSheetData(spreadsheetId, "Special-Winners!B3", [[raffleWinnerId]]);
      toast.success("Updated 50/50 Raffle winner");
    } catch (err: any) {
      toast.error("Failed to save winner: " + (err.message || "Unknown error"));
    } finally {
      setSavingRaffle(false);
    }
  };

  const getBidderName = (id: string) => {
    if (!id) return "";
    const b = bidders.find(b => b.id === id);
    return b ? `${b.firstName} ${b.lastName}` : "Bidder not found";
  };

  const winningNames = useMemo(() => new Set(Object.values(winners)), [winners]);

  const checkedInCount = bidders.filter(b => b.checkedIn).length;
  const checkedOutCount = bidders.filter(b => b.checkedOut).length;
  const pendingCheckoutBidders = bidders.filter(b => {
    if (b.checkedOut) return false;
    if (b.checkedIn) return true;
    const fullName = `${b.firstName} ${b.lastName}`;
    if (b.isProxy && winningNames.has(fullName)) return true;
    return false;
  });
  const pendingCheckoutCount = pendingCheckoutBidders.length;
  const totalBidders = bidders.length;
  const itemsCount = items.length;

  const proxyBidders = bidders
    .filter(b => b.isProxy)
    .sort((a, b) => parseInt(a.id) - parseInt(b.id));

  const bidderStats = [
    { name: "Checked In", value: checkedInCount, fill: "#10b981" },
    { name: "Checked Out", value: checkedOutCount, fill: "#0c63d5" },
    { name: "Not Present", value: totalBidders - checkedInCount, fill: "#ef4444" },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  return (
    <div className="space-y-6 text-left">
      {isAuctionClosed && (
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
              <Button variant="outline" size="sm" onClick={fetchFollowUpRecords} disabled={loadingFollowUp}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loadingFollowUp ? 'animate-spin' : ''}`} />
                Refresh Lists
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Pending Checkouts */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm uppercase tracking-wider text-slate-500 flex items-center gap-2">
                      <Clock className="w-4 h-4" /> Still Need to Check Out
                    </h4>
                    <span className="text-xs font-medium px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                      {pendingCheckoutBidders.length} Total
                    </span>
                  </div>
                  <ScrollArea className="h-[300px] rounded-md border bg-white p-4">
                    <div className="space-y-3">
                      {pendingCheckoutBidders.length > 0 ? (
                        pendingCheckoutBidders.map(b => (
                          <div key={b.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                            <div>
                              <div className="font-bold text-sm">#{b.id} {b.firstName} {b.lastName}</div>
                              <div className="text-xs text-muted-foreground">{b.email}</div>
                            </div>
                            <Badge variant="outline" className={b.paid ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                              {b.paid ? "Paid" : "Unpaid"}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-12 text-muted-foreground italic">All present bidders have checked out.</div>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Follow-Up Sheet Records */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm uppercase tracking-wider text-slate-500 flex items-center gap-2">
                       <ExternalLink className="w-4 h-4" /> Post-Checkout Item Wins
                    </h4>
                    <span className="text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      {followUpRecords.length} Records
                    </span>
                  </div>
                  <ScrollArea className="h-[300px] rounded-md border bg-white p-4">
                    <div className="space-y-3">
                      {followUpRecords.length > 0 ? (
                        followUpRecords.map((rec, i) => (
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
                        ))
                      ) : (
                        <div className="text-center py-12 text-muted-foreground italic">No items have been assigned to checked-out bidders yet.</div>
                      )}
                    </div>
                  </ScrollArea>
                  <p className="text-[10px] text-muted-foreground italic mt-2">
                    Note: These records are created automatically when an item is assigned to someone who already checked out.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Bidders Present</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{checkedInCount} / {totalBidders}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {Math.round((checkedInCount / (totalBidders || 1)) * 100)}% attendance
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Checkout Status</CardTitle>
            <UserCheck className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {checkedOutCount} <span className="text-sm font-normal text-muted-foreground">Checked Out</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-600 dark:text-amber-500">
                {pendingCheckoutCount} Pending
              </span>
              <span className="text-muted-foreground">
                of {checkedInCount} Present
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Auction Items</CardTitle>
            <ShoppingBag className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{itemsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">In catalog</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Raised</CardTitle>
            <TrendingUp className="w-4 h-4 text-[#10b981]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#10b981]">
              {formatCurrency(totalRaised || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Special Winners Widget Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Attendance Overview</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px] w-full flex items-center justify-center p-0">
            <PieChart width={280} height={250}>
              <Pie
                data={bidderStats}
                cx="50%"
                cy="42%"
                innerRadius={65}
                outerRadius={95}
                paddingAngle={5}
                dataKey="value"
              >
                {bidderStats.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </CardContent>
        </Card>

        {/* Proxy Bidders Widget */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-amber-600" />
              Proxy Bidders ({proxyBidders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ScrollArea className="h-full pr-4">
              {proxyBidders.length > 0 ? (
                <div className="space-y-2">
                  {proxyBidders.map((bidder) => (
                    <div
                      key={bidder.id}
                      className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-4 py-3 border border-slate-200"
                    >
                      <div className="font-mono font-bold text-primary">
                        #{bidder.id}
                      </div>
                      <div className="font-medium">
                        {bidder.firstName} {bidder.lastName}
                      </div>
                      <div className="text-xs text-amber-600 font-medium">PROXY</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  No proxy bidders yet.
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Special Winners Widget */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#0c63d5]" />
              Special Winners
            </CardTitle>
            <CardDescription>
              Record the winners for the special raffle items.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gift-card-winner" className="text-sm font-semibold text-slate-800">
                  $500 Amazon Gift Card
                </Label>
                <div className="flex gap-2">
                  <Input 
                    id="gift-card-winner" 
                    placeholder="Bidder ID" 
                    value={giftCardWinnerId}
                    onChange={(e) => setGiftCardWinnerId(e.target.value)}
                    className="w-32"
                    disabled={savingGiftCard || isAuctionClosed}
                  />
                  <Button 
                    onClick={saveGiftCardWinner} 
                    disabled={savingGiftCard}
                    className="bg-[#0c63d5] hover:bg-[#0c63d5]/90 text-white shrink-0 px-6"
                  >
                    {savingGiftCard ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Save
                  </Button>
                </div>
                {giftCardWinnerId && (
                  <p className="text-sm text-slate-600 pl-1 shrink-0">
                    Winner: <span className="font-medium text-slate-900">{getBidderName(giftCardWinnerId)}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="raffle-winner" className="text-sm font-semibold text-slate-800">
                  50/50 Raffle
                </Label>
                <div className="flex gap-2">
                  <Input 
                    id="raffle-winner" 
                    placeholder="Bidder ID" 
                    value={raffleWinnerId}
                    onChange={(e) => setRaffleWinnerId(e.target.value)}
                    className="w-32"
                    disabled={savingRaffle || isAuctionClosed}
                  />
                  <Button 
                    onClick={saveRaffleWinner} 
                    disabled={savingRaffle}
                    className="bg-[#0c63d5] hover:bg-[#0c63d5]/90 text-white shrink-0 px-6"
                  >
                    {savingRaffle ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Save
                  </Button>
                </div>
                {raffleWinnerId && (
                  <p className="text-sm text-slate-600 pl-1 shrink-0">
                    Winner: <span className="font-medium text-slate-900">{getBidderName(raffleWinnerId)}</span>
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
