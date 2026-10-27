import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { PostAuctionFollowUp } from "@/components/PostAuctionFollowUp";
import { DashboardStatsRow } from "@/components/DashboardStatsRow";
import { AttendanceChart } from "@/components/AttendanceChart";
import { ProxyBiddersCard } from "@/components/ProxyBiddersCard";
import { SpecialWinnersCard } from "@/components/SpecialWinnersCard";
import { useDashboardState } from "@/hooks/useDashboardState";

export default function Dashboard() {
  const { bidders, items, totalRaised, isAuctionClosed, winners, dataVersion } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;

  const state = useDashboardState({ bidders, items, winners, spreadsheetId, isAuctionClosed, dataVersion });

  return (
    <div className="space-y-6 text-left">
      {isAuctionClosed && (
        <PostAuctionFollowUp
          pendingCheckoutBidders={state.pendingCheckoutBidders}
          followUpRecords={state.followUpRecords}
          unattendedBidders={state.unattendedBidders}
          loadingFollowUp={state.loadingFollowUp}
          onRefresh={state.fetchFollowUpRecords}
          getBidderName={state.getBidderName}
        />
      )}

      <DashboardStatsRow
        checkedInCount={state.checkedInCount}
        totalBidders={state.totalBidders}
        checkedOutCount={state.checkedOutCount}
        pendingCheckoutCount={state.pendingCheckoutCount}
        itemsCount={state.itemsCount}
        totalRaised={totalRaised || 0}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AttendanceChart bidderStats={state.bidderStats} />
        <ProxyBiddersCard proxyBidders={state.proxyBidders} />
        <SpecialWinnersCard
          giftCardWinnerId={state.giftCardWinnerId}
          onGiftCardWinnerIdChange={state.setGiftCardWinnerId}
          savingGiftCard={state.savingGiftCard}
          onSaveGiftCard={state.saveGiftCardWinner}
          raffleWinnerId={state.raffleWinnerId}
          onRaffleWinnerIdChange={state.setRaffleWinnerId}
          savingRaffle={state.savingRaffle}
          onSaveRaffle={state.saveRaffleWinner}
          isAuctionClosed={isAuctionClosed}
          getBidderName={state.getBidderName}
        />
      </div>
    </div>
  );
}
