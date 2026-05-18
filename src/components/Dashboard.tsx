import { useState, useEffect } from "react";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, ShoppingBag, TrendingUp, UserCheck, Trophy, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSheetData, updateSheetData } from "@/lib/google-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Dashboard() {
  const { bidders, items, totalRaised, loading } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;

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
  }, [spreadsheetId]);

  const saveGiftCardWinner = async () => {
    if (!spreadsheetId) {
      toast.error("Spreadsheet ID not configured.");
      return;
    }

    const bidder = bidders.find(b => b.id === giftCardWinnerId);
    if (bidder?.checkedOut) {
      toast.warning("Checked Out Warning", {
        description: `Warning: ${bidder.firstName} ${bidder.lastName} has already checked out. Please make a manual note to deliver their $500 Amazon Gift Card prize.`
      });
    }

    setSavingGiftCard(true);
    try {
      await updateSheetData(spreadsheetId, "Special-Winners!B2", [[giftCardWinnerId]]);
      toast.success("Updated $500 Amazon Gift Card winner");
    } catch (err) {
      toast.error("Failed to save winner");
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
    if (bidder?.checkedOut) {
      toast.warning("Checked Out Warning", {
        description: `Warning: ${bidder.firstName} ${bidder.lastName} has already checked out. Please make a manual note to deliver their 50/50 Raffle prize.`
      });
    }

    setSavingRaffle(true);
    try {
      await updateSheetData(spreadsheetId, "Special-Winners!B3", [[raffleWinnerId]]);
      toast.success("Updated 50/50 Raffle winner");
    } catch (err) {
      toast.error("Failed to save winner");
    } finally {
      setSavingRaffle(false);
    }
  };

  const getBidderName = (id: string) => {
    if (!id) return "";
    const b = bidders.find(b => b.id === id);
    return b ? `${b.firstName} ${b.lastName}` : "Bidder not found";
  };

  const checkedInCount = bidders.filter(b => b.checkedIn).length;
  const checkedOutCount = bidders.filter(b => b.checkedOut).length;
  const pendingCheckoutCount = Math.max(0, checkedInCount - checkedOutCount);
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
    <div className="space-y-6">
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

      {/* Main Widgets Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Attendance Overview</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px] w-full overflow-hidden" style={{ minWidth: 0 }}>
            <ResponsiveContainer width="99%" height="100%" minHeight={0} minWidth={0}>
              <PieChart>
                <Pie
                  data={bidderStats}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {bidderStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
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