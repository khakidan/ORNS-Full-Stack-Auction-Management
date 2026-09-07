import { Users } from "lucide-react";
import { RowListShell } from "@/components/RowListShell";
import { AttendeeRow } from "@/components/AttendeeRow";
import { Attendee } from "@/types";

interface AttendeesListProps {
  attendees: Attendee[];
  loading: boolean;
  isAuctionClosed: boolean;
  onEdit: (attendee: Attendee) => void;
  onUpdatePaymentStatus: (attendee: Attendee, newStatus: string) => void;
  onDeleteRequest: (attendee: Attendee) => void;
}

/**
 * Row-based replacement for the old <table>-based attendee grid (see the
 * user-reported "Attendee List UI Layout Issues" bug) - a plain-div list
 * instead of table markup, since AttendeeRow.tsx's rows no longer need
 * <td>/<tr> semantics once per-field inline editing moved into
 * EditAttendeeDialog.tsx.
 */
export function AttendeesList({
  attendees,
  loading,
  isAuctionClosed,
  onEdit,
  onUpdatePaymentStatus,
  onDeleteRequest,
}: AttendeesListProps) {
  return (
    <RowListShell
      items={attendees}
      loading={loading}
      emptyIcon={<Users className="w-7 h-7" />}
      emptyMessage="No results match your filters."
      renderRow={(attendee) => (
        <AttendeeRow
          key={attendee.id}
          attendee={attendee}
          isAuctionClosed={isAuctionClosed}
          onEdit={onEdit}
          onUpdatePaymentStatus={onUpdatePaymentStatus}
          onDeleteRequest={onDeleteRequest}
        />
      )}
    />
  );
}
