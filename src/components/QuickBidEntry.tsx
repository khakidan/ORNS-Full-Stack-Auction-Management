import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Clock, Gavel, Repeat, Search, User, XCircle } from "lucide-react";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { OutboxEntry, useBidOutbox } from "@/lib/bidOutbox";
import { useQuickBidEntryState } from "@/hooks/useQuickBidEntryState";
import { AuctionItem, Bidder } from "@/types";

interface QuickBidEntryProps {
  items: AuctionItem[];
  bidders: Bidder[];
  winners: Record<string, string>;
  recordWinningBid: (bidderId: string, itemId: string, price: number) => Promise<string | void>;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function QuickBidEntry({ items, bidders, winners, recordWinningBid }: QuickBidEntryProps) {
  const state = useQuickBidEntryState({ items, bidders, winners, recordWinningBid });
  // Bids from this feed that are still saved on the device, by key (Milestone A).
  const outbox = useBidOutbox();
  const pending = new Map<string, OutboxEntry>(outbox.entries.map(e => [e.body.idempotencyKey, e]));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-semibold">
            <Gavel className="w-4 h-4 text-orns-red" /> Record a Winning Bid
          </div>
          <p className="text-xs text-muted-foreground">
            Item &rarr; Bidder &rarr; Price. Press <span className="font-semibold">Enter</span> to move to the next field.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Item Number</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                ref={state.itemInputRef}
                className="pl-10 h-12 text-lg font-mono"
                placeholder="e.g. 1301"
                value={state.itemId}
                onChange={e => state.setItemId(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") state.focusBidder(); }}
                autoFocus
                // Deliberately never disabled, unlike the Bidder/Price
                // fields below - it's the auto-refocus target after a
                // submit completes, and disabling it right up to that
                // point means .focus() would silently no-op on a still-
                // disabled element (a real bug caught by this component's
                // own tests). Submits are already near-instant
                // (optimistic update, background sync - see
                // useWinnersData.ts), so there's no real double-submit
                // risk from leaving it enabled.
              />
            </div>
            {state.selectedItem && (
              <p className="text-sm text-green-600 flex items-center gap-2">
                {state.selectedItem.name}
                {state.isRepeatable && (
                  <Badge variant="outline" className="text-xxs font-normal gap-1 bg-blue-50 text-blue-700 border-blue-200">
                    <Repeat className="w-3 h-3" /> Repeatable{state.soldCountThisSession > 0 ? ` · ${state.soldCountThisSession} sold this session` : ""}
                  </Badge>
                )}
              </p>
            )}
            {state.selectedItem && !state.isRepeatable && state.existingWinner && (
              <p className="text-sm text-orns-red flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" /> Already won by {state.existingWinner} - will not record
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Bidder ID</Label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                ref={state.bidderInputRef}
                className="pl-10 h-12 text-lg font-mono"
                placeholder="e.g. 142"
                value={state.bidderId}
                onChange={e => state.setBidderId(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") state.focusPrice(); }}
                disabled={state.submitting}
              />
            </div>
            {state.selectedBidder && (
              <p className={cn("text-sm", state.selectedBidder.checkedIn || state.selectedBidder.isProxy ? "text-green-600" : "text-amber-600")}>
                {state.selectedBidder.firstName} {state.selectedBidder.lastName}
                {!state.selectedBidder.checkedIn && !state.selectedBidder.isProxy && " — NOT CHECKED IN"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Winning Bid ($)</Label>
            <Input
              ref={state.priceInputRef}
              type="number"
              step="0.01"
              className="h-12 text-lg"
              placeholder="150.00"
              value={state.price}
              onChange={e => state.setPrice(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") state.handleSubmit(); }}
              disabled={state.submitting}
            />
          </div>

          {state.selectedItem && state.selectedBidder && state.price.trim() && (
            // All three side by side, large, to compare with the bid sheet in one look.
            <div
              data-testid="bid-summary"
              className={cn(
                "rounded-lg border p-3 space-y-2",
                state.warnings.length > 0 ? "border-amber-300 bg-amber-50/60" : "bg-muted/40"
              )}
            >
              <div className="flex items-center gap-2 flex-wrap text-lg font-bold">
                <span className="font-mono">#{state.selectedItem.id}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-mono">Bidder {state.selectedBidder.id}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="tabular-nums">${(parseFloat(state.price) || 0).toFixed(2)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {state.selectedItem.name} &middot; {state.selectedBidder.firstName} {state.selectedBidder.lastName}
              </div>
              {state.warnings.map((w) => (
                <p key={w} className="text-sm text-amber-800 flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
          )}

          <LoadingButton
            className="w-full h-12 text-base bg-orns-red text-white hover:bg-orns-red/90"
            loading={state.submitting}
            loadingText="Recording..."
            onClick={() => state.handleSubmit()}
          >
            Record Winning Bid
          </LoadingButton>

          <ConfirmationDialog
            open={state.confirmingWarnings}
            onOpenChange={(open) => { if (!open) state.cancelWarnings(); }}
            title="Check the bid sheet"
            icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
            description={
              <span className="block space-y-2">
                {state.warnings.map((w) => <span key={w} className="block">{w}</span>)}
                <span className="block">If the bid sheet really says this, record it anyway.</span>
              </span>
            }
            cancelLabel="Fix it"
            confirmLabel="Record anyway"
            onConfirm={() => state.handleSubmit({ confirmed: true })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <Clock className="w-4 h-4 text-muted-foreground" /> This Session
          </div>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            {state.feed.filter(f => f.outcome === "recorded").length} recorded
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {state.feed.length === 0 ? (
            <StatusStatePlaceholder
              icon={<Gavel />}
              description="Bids you record will show up here so you can double-check the last several entries at a glance."
            />
          ) : (
            <div className="max-h-130 overflow-y-auto">
              {state.feed.map(entry => {
                const saved = entry.idempotencyKey ? pending.get(entry.idempotencyKey) : undefined;
                return (
                <div
                  key={entry.id}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3 border-b last:border-0",
                    entry.outcome === "blocked-duplicate" && "bg-orns-red/5"
                  )}
                >
                  <div
                    className={cn(
                      "w-10 h-10 shrink-0 rounded-md flex items-center justify-center font-mono font-bold text-xs",
                      entry.outcome === "blocked-duplicate" ? "bg-orns-red text-white" : "bg-secondary text-secondary-foreground"
                    )}
                  >
                    #{entry.itemId}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-semibold text-sm truncate", entry.outcome === "blocked-duplicate" && "text-orns-red")}>
                      {entry.outcome === "blocked-duplicate" ? `Duplicate: ${entry.itemName}` : entry.itemName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.bidderName} &middot; {timeAgo(entry.timestamp)}
                    </div>
                    {saved && saved.status !== "needsReview" && (
                      <div className="text-xs text-amber-700">Saved on this device &middot; sends when back online</div>
                    )}
                    {saved?.status === "needsReview" && (
                      <div className="text-xs text-orns-red">Not recorded: {saved.problem}</div>
                    )}
                  </div>
                  <div className="font-bold text-sm tabular-nums">${entry.price.toFixed(2)}</div>
                  {entry.outcome !== "recorded" ? (
                    <XCircle className="w-4 h-4 text-orns-red shrink-0" />
                  ) : saved?.status === "needsReview" ? (
                    <AlertCircle className="w-4 h-4 text-orns-red shrink-0" aria-label="Needs review" />
                  ) : saved ? (
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" aria-label="Saved on this device" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  )}
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
