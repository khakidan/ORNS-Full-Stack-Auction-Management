import { Users } from "lucide-react";
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
  if (loading) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 border-b last:border-0 animate-pulse bg-muted/40" />
        ))}
      </div>
    );
  }

  if (attendees.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
        <Users className="w-7 h-7" />
        <span className="text-sm">No results match your filters.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {attendees.map((attendee) => (
        <AttendeeRow
          key={attendee.id}
          attendee={attendee}
          isAuctionClosed={isAuctionClosed}
          onEdit={onEdit}
          onUpdatePaymentStatus={onUpdatePaymentStatus}
          onDeleteRequest={onDeleteRequest}
        />
      ))}
    </div>
  );
}
