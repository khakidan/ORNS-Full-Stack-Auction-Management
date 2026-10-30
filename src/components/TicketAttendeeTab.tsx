import { Users, Trash2, Filter, RefreshCw } from "lucide-react";
import { ListPageCard } from "@/components/ui/ListPageCard";
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
import { AttendeesList } from "@/components/AttendeesList";
import { AddAttendeeDialog } from "@/components/AddAttendeeDialog";
import { EditAttendeeDialog } from "@/components/EditAttendeeDialog";
import { useAuction } from "@/context/AuctionContext";
import { useAuth } from "@/context/AuthContext";
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
  const { can } = useAuth();

  const state = useTicketAttendeeState({ attendees, setAttendees, addAttendee, removeAttendee, spreadsheetId });
  // Users only view this page (tickets.edit); a closed auction is read-only for everyone.
  const viewOnly = !can("tickets.edit");
  const readOnly = isAuctionClosed || viewOnly;

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
            <SelectTrigger aria-label="Filter by source" className="w-45 h-10">
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

            {!readOnly && (
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
            {!isAuctionClosed && viewOnly && (
              <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 h-10 px-4">
                View Only
              </Badge>
            )}
          </>
        }
      />

      <ListPageCard
        icon={<Users className="w-5 h-5 text-primary" />}
        title="Attendee List"
        description={`${state.filteredAttendees.length} entries found across participating sources.`}
        className="flex flex-col min-h-0"
        contentClassName="flex-1 overflow-auto min-h-100"
      >
        <AttendeesList
          attendees={state.filteredAttendees}
          loading={attendeesLoading}
          isAuctionClosed={readOnly}
          canDelete={can("attendees.delete")}
          onEdit={state.setAttendeeToEdit}
          onUpdatePaymentStatus={state.updatePaymentStatus}
          onDeleteRequest={state.setAttendeeToDelete}
        />
      </ListPageCard>

      <EditAttendeeDialog
        attendee={state.attendeeToEdit}
        open={!!state.attendeeToEdit}
        onOpenChange={(open) => !open && state.setAttendeeToEdit(null)}
        onSave={state.handleEditSave}
        isSaving={state.isSavingEdit}
      />

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
