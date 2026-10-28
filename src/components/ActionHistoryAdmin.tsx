import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, ExternalLink, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterToolbar } from "@/components/FilterToolbar";
import { RefreshableListCard } from "@/components/RefreshableListCard";
import { RowListShell } from "@/components/RowListShell";
import { ALL, ActionRecord, useActionHistoryState } from "@/hooks/useActionHistoryState";
import { useConfig } from "@/context/ConfigContext";
import { extractId } from "@/hooks/useConfigSettingsState";

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="h-10 w-44 shrink-0" aria-label={label}>
        <SelectValue>{(v: string) => (v === ALL ? `All ${label}` : v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Before/After cells hold JSON; show it readably, or the text as-is. */
function pretty(value: string): string {
  if (!value) return "—";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function ActionRow({ action, onUndo, undoing }: { action: ActionRecord; onUndo: (a: ActionRecord) => void; undoing: boolean }) {
  const [open, setOpen] = useState(false);
  const when = action.timestamp ? format(new Date(action.timestamp), "MMM d, h:mm a") : "";
  return (
    <div className="border-b last:border-0" data-testid={`action-row-${action.id}`}>
      <div className="flex items-start gap-3 px-5 py-3 hover:bg-muted/50">
        <button
          type="button"
          className="mt-0.5 text-muted-foreground"
          aria-label={open ? "Hide details" : "Show details"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-semibold">{action.action}</span>
            {action.target && <span className="text-muted-foreground">· {action.target}</span>}
          </div>
          <div className="text-sm text-muted-foreground break-words">{action.summary}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {when} · {action.who}{action.role ? ` (${action.role})` : ""} · {action.area}{action.source === "Sheet edit" ? " · edited in the spreadsheet" : ""}
          </div>
        </div>
        <div className="w-44 shrink-0 text-right text-xs">
          {action.undoable ? (
            <LoadingButton size="sm" variant="outline" className="gap-1" loading={undoing} icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={() => onUndo(action)}>
              Undo
            </LoadingButton>
          ) : (
            <span className="text-muted-foreground">{action.undoOf ? "Reverses an earlier action" : action.undo}</span>
          )}
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-12 pb-4 text-xs">
          <div>
            <div className="font-semibold mb-1">Before</div>
            <pre className="whitespace-pre-wrap break-words bg-muted/50 rounded p-2">{pretty(action.before)}</pre>
          </div>
          <div>
            <div className="font-semibold mb-1">After</div>
            <pre className="whitespace-pre-wrap break-words bg-muted/50 rounded p-2">{pretty(action.after)}</pre>
          </div>
          {action.location && <div className="md:col-span-2 text-muted-foreground">Where: {action.location}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Settings > Action History (Full Administrator only): who did what, from
 * the Action History spreadsheet, newest first, with Undo for the actions
 * that can be reversed. Undo refuses (with the reason) when the value has
 * changed since, so it never overwrites a later change.
 */
export default function ActionHistoryAdmin() {
  const state = useActionHistoryState();
  const { config } = useConfig();
  const { filters } = state;
  const [confirming, setConfirming] = useState<ActionRecord | null>(null);

  if (state.configured === false) {
    return (
      <Card>
        <CardContent>
          <StatusStatePlaceholder
            icon={<History />}
            title="Action History isn't set up yet"
            description="Create the Action History spreadsheet to start recording who adds, edits, deletes and bundles items, changes tickets, and runs the auction. It's created in the Auction/General Auction Info/Template Files folder, next to the master spreadsheets, archived with the other spreadsheets, and cleared at the start of each new auction year. Until then, actions are only written to the server's logs."
            action={
              <LoadingButton loading={state.creating} onClick={state.createSpreadsheet} icon={<History className="w-4 h-4" />}>
                Create Action History spreadsheet
              </LoadingButton>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <FilterToolbar
        searchValue={filters.search}
        onSearchChange={filters.setSearch}
        searchPlaceholder="Search actions..."
        filtersWrap={false}
        filters={
          <>
            <FilterSelect label="Areas" value={filters.area} onChange={filters.setArea} options={filters.options.areas} />
            <FilterSelect label="People" value={filters.who} onChange={filters.setWho} options={filters.options.people} />
            <FilterSelect label="Sources" value={filters.source} onChange={filters.setSource} options={filters.options.sources} />
          </>
        }
        trailing={
          <>
            <LoadingButton
              variant="outline"
              size="sm"
              loading={state.enablingTracking}
              title={state.trackingOn
                ? "Edits made directly in the Items and Tickets spreadsheets (not through the app) are being recorded. Turn off to stop recording them."
                : "Records edits made directly in the Items and Tickets spreadsheets (not through the app). Run it again if the Items or Tickets spreadsheet changes."}
              onClick={() => state.setEditTracking(!state.trackingOn, extractId(config.auctionItemsSpreadsheetId), extractId(config.auctionTicketsSpreadsheetId))}
            >
              {state.trackingOn ? "Turn off edit tracking" : "Turn on edit tracking"}
            </LoadingButton>
            {state.trackingOn && state.trackingTurnedOn && (
              <span
                className="text-xs text-muted-foreground"
                title="Edits are recorded by this person's Google account. If that account is removed, recording stops - turn tracking off and on again to record as yourself."
              >
                Recording as {state.trackingTurnedOn.by}
                {state.trackingTurnedOn.at ? ` since ${format(new Date(state.trackingTurnedOn.at), "MMM d")}` : ""}
              </span>
            )}
            {state.spreadsheetUrl && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open(state.spreadsheetUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="w-4 h-4" /> Open Spreadsheet
              </Button>
            )}
          </>
        }
      />

      <RefreshableListCard
        icon={<History className="w-5 h-5 text-primary" />}
        title="Action History"
        description={`${state.actions.length} of ${state.totalCount} actions this season, newest first${state.hasMore ? ` (the newest ${state.loadedCount} loaded - search and filters cover those)` : ""}. Undo puts back what an action changed, unless it has changed again since.`}
        loading={state.loading}
        onRefresh={state.fetchActions}
      >
        <RowListShell
          items={state.actions}
          loading={state.loading}
          emptyIcon={<History className="w-7 h-7" />}
          emptyMessage={state.totalCount === 0 ? "No actions recorded yet this season." : "No actions match your search or filters."}
          renderRow={(a) => <ActionRow key={a.id} action={a} undoing={state.undoingId === a.id} onUndo={setConfirming} />}
        />
        {state.hasMore && (
          <div className="flex justify-center p-4 border-t">
            <LoadingButton variant="outline" size="sm" loading={state.loadingMore} onClick={state.loadMore}>
              Load older actions
            </LoadingButton>
          </div>
        )}
      </RefreshableListCard>

      <ConfirmationDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Undo this action?"
        description={confirming ? `"${confirming.summary}" (by ${confirming.who}). ${confirming.undoPreview}` : ""}
        confirmLabel="Undo"
        isLoading={!!confirming && state.undoingId === confirming.id}
        onConfirm={async () => {
          if (confirming && (await state.undo(confirming))) setConfirming(null);
        }}
        icon={<RotateCcw className="w-5 h-5" />}
      />
    </div>
  );
}
