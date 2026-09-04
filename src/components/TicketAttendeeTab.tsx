import { Users, Trash2, Filter, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { cn } from "@/lib/utils";
import { FilterToolbar } from "@/components/FilterToolbar";
import { AttendeesTable } from "@/components/AttendeesTable";
import { AddAttendeeDialog } from "@/components/AddAttendeeDialog";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { useTicketAttendeeState } from "@/hooks/useTicketAttendeeState";

// SelectValue with no children renders the raw stored value, not the
// matching SelectItem's label - see component-standards.md's documented
// SelectValue failure mode (confirmed via a throwaway RTL render for the
// sibling AddAttendeeDialog.tsx/BiddersFilterControls.tsx case - the
// trigger showed the literal stored value instead of the item's label).
const SOURCE_LABELS: Record<string, string> = {
  all: "All Sources",
  tickets: "General Tickets",
  "sponsor tickets": "Sponsors",
  "staff tickets": "Staff",
};

export default function TicketAttendeeTab() {
  const { config } = useConfig();
  const spreadsheetId = config.auctionTicketsSpreadsheetId;
  const { attendees, setAttendees, attendeesLoading, addAttendee, removeAttendee, fetchAttendees, isAuctionClosed } = useAuction();

  const state = useTicketAttendeeState({ attendees, setAttendees, addAttendee, removeAttendee, spreadsheetId });

  return (
    <div className="space-y-4">
      <FilterToolbar
        searchValue={state.searchTerm}
        onSearchChange={state.setSearchTerm}
        searchPlaceholder="Search attendees..."
        searchClassName="md:w-64"
        searchInputClassName="h-10"
        filters={
          <Select value={state.filterSource} onValueChange={state.setFilterSource}>
            <SelectTrigger className="w-[180px] h-10">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Source">{(value: string) => SOURCE_LABELS[value] ?? value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="tickets">General Tickets</SelectItem>
              <SelectItem value="sponsor tickets">Sponsors</SelectItem>
              <SelectItem value="staff tickets">Staff</SelectItem>
            </SelectContent>
          </Select>
        }
        trailing={
          <>
            <Button variant="outline" onClick={fetchAttendees} disabled={attendeesLoading} className="gap-2">
              <RefreshCw className={cn("w-4 h-4", attendeesLoading && "animate-spin")} />
              Refresh
            </Button>

            {!isAuctionClosed && (
              <AddAttendeeDialog
                open={state.isAddDialogOpen}
                onOpenChange={state.setIsAddDialogOpen}
                newEntry={state.newEntry}
                onNewEntryChange={state.setNewEntry}
                onSubmit={state.handleAddSubmit}
                isSubmitting={state.isSubmitting}
              />
            )}
            {isAuctionClosed && (
              <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 h-10 px-4">
                Auction Closed (Read Only)
              </Badge>
            )}
          </>
        }
      />

      <Card className="flex flex-col min-h-0">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Attendee List</CardTitle>
          <CardDescription>
            {state.filteredAttendees.length} entries found across participating sources.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0 min-h-[400px]">
          <AttendeesTable
            attendees={state.filteredAttendees}
            loading={attendeesLoading}
            isAuctionClosed={isAuctionClosed}
            onUpdateField={state.updateField}
            onUpdatePaymentStatus={state.updatePaymentStatus}
            onDeleteRequest={state.setAttendeeToDelete}
          />
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={!!state.attendeeToDelete}
        onOpenChange={(open) => !open && state.setAttendeeToDelete(null)}
        title="Confirm Deletion"
        description={<>Are you sure you want to permanently clear <strong>{state.attendeeToDelete?.firstName} {state.attendeeToDelete?.lastName}</strong>'s entry? This action will remove the record from the database and cannot be undone easily.</>}
        confirmLabel="Confirm Delete"
        onConfirm={state.handleDeleteConfirm}
        isLoading={state.isDeleting}
        variant="destructive"
        icon={<Trash2 className="w-5 h-5" />}
      />
    </div>
  );
}
