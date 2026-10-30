import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/IconButton";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Plus, Repeat, Trash2, XCircle } from "lucide-react";
import { useBatchBidEntryState } from "@/hooks/useBatchBidEntryState";
import { AuctionItem, Bidder } from "@/types";

interface BatchBidEntryProps {
  items: AuctionItem[];
  bidders: Bidder[];
  winners: Record<string, string>;
  recordWinningBid: (bidderId: string, itemId: string, price: number) => Promise<string | void>;
}

const STATUS_ROW_CLASS: Record<string, string> = {
  ready: "border-l-4 border-l-green-500",
  "ready-repeat": "border-l-4 border-l-blue-500",
  duplicate: "border-l-4 border-l-amber-500",
  check: "border-l-4 border-l-yellow-400 bg-yellow-50/50",
  error: "border-l-4 border-l-orns-red",
  empty: "border-l-4 border-l-transparent",
};

export function BatchBidEntry({ items, bidders, winners, recordWinningBid }: BatchBidEntryProps) {
  const state = useBatchBidEntryState({ items, bidders, winners, recordWinningBid });

  const readyCount = state.resolved.filter(r => r.status === "ready" || r.status === "ready-repeat").length;
  const duplicateCount = state.resolved.filter(r => r.status === "duplicate").length;
  const errorCount = state.resolved.filter(r => r.status === "error").length;
  const checkCount = state.resolved.filter(r => r.status === "check").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="font-semibold">Transcribe a Stack</div>
          <p className="text-xs text-muted-foreground">Nothing is recorded until you review and click "Record Ready Bids" below.</p>
        </div>
        <button
          type="button"
          onClick={state.addRow}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <Plus className="w-3.5 h-3.5" /> Add Row
        </button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xxs uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold px-4 py-2 w-16">#</th>
                <th className="text-left font-semibold px-2 py-2 w-32">Item #</th>
                <th className="text-left font-semibold px-2 py-2">Resolves To</th>
                <th className="text-left font-semibold px-2 py-2 w-32">Bidder #</th>
                <th className="text-left font-semibold px-2 py-2">Resolves To</th>
                <th className="text-left font-semibold px-2 py-2 w-32">Price</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {state.resolved.map((r, i) => (
                <tr key={r.row.key} className={cn("border-b last:border-0", STATUS_ROW_CLASS[r.status])}>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground font-mono">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-9 font-mono"
                      value={r.row.itemId}
                      onChange={e => state.updateRow(r.row.key, "itemId", e.target.value)}
                      placeholder="&hellip;"
                      aria-label={`Row ${i + 1} item number`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {r.status === "error" && r.row.itemId.trim() && !r.item && (
                      <span className="text-orns-red flex items-center gap-1"><XCircle className="w-3 h-3" /> No item #{r.row.itemId}</span>
                    )}
                    {r.item && r.status === "duplicate" && (
                      <span className="text-amber-600 flex items-center gap-1"><XCircle className="w-3 h-3" /> {winners[r.item.id] ? `Already won by ${winners[r.item.id]}` : "Duplicate in this batch"}</span>
                    )}
                    {r.item && (r.status === "ready" || r.status === "ready-repeat" || r.status === "check") && (
                      <span className="text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> {r.item.name}
                        {r.status === "ready-repeat" && (
                          <span className="inline-flex items-center gap-1 text-blue-600"><Repeat className="w-3 h-3" /> repeatable</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-9 font-mono"
                      value={r.row.bidderId}
                      onChange={e => state.updateRow(r.row.key, "bidderId", e.target.value)}
                      placeholder="&hellip;"
                      aria-label={`Row ${i + 1} bidder number`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {r.status === "error" && r.row.bidderId.trim() && !r.bidder && (
                      <span className="text-orns-red flex items-center gap-1"><XCircle className="w-3 h-3" /> No bidder #{r.row.bidderId}</span>
                    )}
                    {r.bidder && (
                      <span className={cn("flex items-center gap-1", r.bidder.checkedIn || r.bidder.isProxy ? "text-green-600" : "text-amber-600")}>
                        <CheckCircle2 className="w-3 h-3" /> {r.bidder.firstName} {r.bidder.lastName}
                        {!r.bidder.checkedIn && !r.bidder.isProxy && " (not checked in)"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      className="h-9"
                      value={r.row.price}
                      onChange={e => state.updateRow(r.row.key, "price", e.target.value)}
                      placeholder="&hellip;"
                      aria-label={`Row ${i + 1} price`}
                    />
                    {r.status === "check" && (
                      <div className="mt-1 space-y-1 max-w-64">
                        {r.warnings.map(w => (
                          <p key={w} className="text-xxs text-amber-800 flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /> {w}
                          </p>
                        ))}
                        <button
                          type="button"
                          onClick={() => state.confirmRow(r.row.key)}
                          className="text-xxs font-semibold underline text-amber-900 hover:text-foreground"
                        >
                          Looks right - the bid sheet says this
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.hasAnyInput && (
                      <IconButton
                        variant="ghost"
                        aria-label="Remove row"
                        icon={<Trash2 className="w-3.5 h-3.5" />}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => state.removeRow(r.row.key)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap px-4 py-3 bg-muted/40 border-t">
          <div className="flex gap-4 text-xs font-medium">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /> {readyCount} ready</span>
            {checkCount > 0 && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400" /> {checkCount} to check</span>}
            {duplicateCount > 0 && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> {duplicateCount} duplicate</span>}
            {errorCount > 0 && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orns-red" /> {errorCount} unresolved</span>}
          </div>
          <LoadingButton
            className="bg-orns-red text-white hover:bg-orns-red/90"
            disabled={readyCount === 0}
            loading={state.submitting}
            loadingText="Recording..."
            onClick={state.submitReady}
          >
            Record {readyCount} Ready Bid{readyCount === 1 ? "" : "s"}
          </LoadingButton>
        </div>
      </CardContent>
    </Card>
  );
}
