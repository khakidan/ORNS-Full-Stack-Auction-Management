import { Trophy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SpecialWinnerField } from "@/components/SpecialWinnerField";

interface SpecialWinnersCardProps {
  giftCardWinnerId: string;
  onGiftCardWinnerIdChange: (value: string) => void;
  savingGiftCard: boolean;
  onSaveGiftCard: () => void;
  raffleWinnerId: string;
  onRaffleWinnerIdChange: (value: string) => void;
  savingRaffle: boolean;
  onSaveRaffle: () => void;
  isAuctionClosed: boolean;
  getBidderName: (id: string) => string;
}

export function SpecialWinnersCard({
  giftCardWinnerId,
  onGiftCardWinnerIdChange,
  savingGiftCard,
  onSaveGiftCard,
  raffleWinnerId,
  onRaffleWinnerIdChange,
  savingRaffle,
  onSaveRaffle,
  isAuctionClosed,
  getBidderName,
}: SpecialWinnersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent-blue" />
          Special Winners
        </CardTitle>
        <CardDescription>
          Record the winners for the special raffle items.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SpecialWinnerField
          id="gift-card-winner"
          label="$500 Amazon Gift Card"
          value={giftCardWinnerId}
          onChange={onGiftCardWinnerIdChange}
          onSave={onSaveGiftCard}
          saving={savingGiftCard}
          disabled={savingGiftCard || isAuctionClosed}
          winnerName={getBidderName(giftCardWinnerId)}
        />
        <SpecialWinnerField
          id="raffle-winner"
          label="50/50 Raffle"
          value={raffleWinnerId}
          onChange={onRaffleWinnerIdChange}
          onSave={onSaveRaffle}
          saving={savingRaffle}
          disabled={savingRaffle || isAuctionClosed}
          winnerName={getBidderName(raffleWinnerId)}
          bordered
        />
      </CardContent>
    </Card>
  );
}
