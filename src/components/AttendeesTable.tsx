import { TableHead, TableRow } from "@/components/ui/table";
import { DataTableWrapper } from "@/components/DataTableWrapper";
import { AttendeeRow } from "@/components/AttendeeRow";
import { Attendee } from "@/types";

interface AttendeesTableProps {
  attendees: Attendee[];
  loading: boolean;
  isAuctionClosed: boolean;
  onUpdateField: (attendee: Attendee, field: string, newValue: string, guestIndex?: number) => Promise<void>;
  onUpdatePaymentStatus: (attendee: Attendee, newStatus: string) => void;
  onDeleteRequest: (attendee: Attendee) => void;
}

export function AttendeesTable({
  attendees,
  loading,
  isAuctionClosed,
  onUpdateField,
  onUpdatePaymentStatus,
  onDeleteRequest,
}: AttendeesTableProps) {
  return (
    <DataTableWrapper<Attendee>
      items={attendees}
      loading={loading}
      columnCount={6}
      header={
        <TableRow className="bg-slate-50/50">
          <TableHead className="w-[30%]">Name & Contact</TableHead>
          <TableHead className="w-[12%] text-center">Source</TableHead>
          <TableHead className="w-[8%] text-center">Tix</TableHead>
          <TableHead className="w-[25%]">Guests</TableHead>
          <TableHead className="w-[20%]">Payment</TableHead>
          <TableHead className="w-[5%]"></TableHead>
        </TableRow>
      }
      emptyMessage="No results match your filters."
      renderRow={(attendee) => (
        <AttendeeRow
          key={attendee.id}
          attendee={attendee}
          isAuctionClosed={isAuctionClosed}
          onUpdateField={onUpdateField}
          onUpdatePaymentStatus={onUpdatePaymentStatus}
          onDeleteRequest={onDeleteRequest}
        />
      )}
    />
  );
}
