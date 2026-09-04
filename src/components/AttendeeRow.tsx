import { AlertTriangle, Trash2 } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/IconButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EditableCell } from "@/components/ui/EditableCell";
import { Attendee } from "@/types";
import { cn } from "@/lib/utils";
import { hasMoreGuestsThanTicketsPurchased } from "@/lib/attendeeValidation";

interface AttendeeRowProps {
  attendee: Attendee;
  isAuctionClosed: boolean;
  onUpdateField: (attendee: Attendee, field: string, newValue: string, guestIndex?: number) => Promise<void>;
  onUpdatePaymentStatus: (attendee: Attendee, newStatus: string) => void;
  onDeleteRequest: (attendee: Attendee) => void;
}

export function AttendeeRow({
  attendee: a,
  isAuctionClosed,
  onUpdateField,
  onUpdatePaymentStatus,
  onDeleteRequest,
}: AttendeeRowProps) {
  const guestsExceedTickets = hasMoreGuestsThanTicketsPurchased(a);

  return (
    <TableRow className="align-top hover:bg-slate-50/30">
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            <EditableCell value={a.firstName} onSave={val => onUpdateField(a, 'firstName', val)} placeholder="First" disabled={isAuctionClosed} singleLine />
            <EditableCell value={a.lastName} onSave={val => onUpdateField(a, 'lastName', val)} placeholder="Last" disabled={isAuctionClosed} singleLine />
          </div>
          <EditableCell value={a.email} onSave={val => onUpdateField(a, 'email', val)} placeholder="Email" disabled={isAuctionClosed} singleLine />
          <EditableCell value={a.phone} onSave={val => onUpdateField(a, 'phone', val)} placeholder="Phone" disabled={isAuctionClosed} singleLine />
        </div>
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="outline" className="capitalize text-xs font-normal py-1">
          {a.sheet.replace(' tickets', '').trim() || 'General'}
        </Badge>
      </TableCell>
      <TableCell className="text-center">
        <div
          className={cn(
            "font-semibold mx-auto w-8 h-8 rounded-md text-sm flex items-center justify-center",
            guestsExceedTickets ? "bg-red-100 text-red-700 ring-1 ring-red-300" : "bg-secondary text-secondary-foreground"
          )}
          title={guestsExceedTickets ? `${a.guestsInfo.length} guests listed but only ${a.ticketsPurchased || 0} ticket(s) purchased` : undefined}
        >
          {a.ticketsPurchased}
        </div>
      </TableCell>
      <TableCell className="text-base">
        <div className="space-y-3">
          {guestsExceedTickets && (
            <div className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {a.guestsInfo.length} guests listed but only {a.ticketsPurchased || 0} ticket(s) purchased - please correct in the spreadsheet.
              </span>
            </div>
          )}
          {a.guestsInfo.map((g, idx) => (
            <div key={idx} className="flex flex-col gap-1.5 pb-2 border-b border-slate-100 last:border-0 last:pb-0">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <EditableCell value={g.firstName} onSave={val => onUpdateField(a, 'firstName', val, g.guestIndex)} placeholder="First" disabled={isAuctionClosed} singleLine />
                  <EditableCell value={g.lastName} onSave={val => onUpdateField(a, 'lastName', val, g.guestIndex)} placeholder="Last" disabled={isAuctionClosed} singleLine />
                </div>
                {g.ownBidderNumber?.toLowerCase() === 'yes' && (
                  <Badge variant="secondary" className="text-xxs h-4 px-1 font-normal bg-indigo-50 text-indigo-700 hover:bg-indigo-50 border-indigo-200 shrink-0">
                    Own #
                  </Badge>
                )}
              </div>
              <EditableCell value={g.email} onSave={val => onUpdateField(a, 'email', val, g.guestIndex)} placeholder="Guest Email" disabled={isAuctionClosed} singleLine />
            </div>
          ))}
          {a.guestsInfo.length === 0 && <span className="text-muted-foreground italic text-sm">No guests listed</span>}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-2">
          <Select value={a.paymentStatus || 'Pending'} onValueChange={(val) => onUpdatePaymentStatus(a, val)} disabled={isAuctionClosed}>
            <SelectTrigger className={cn("h-9 text-sm", a.paymentStatus?.toLowerCase() === 'paid' ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          {a.paymentStatus?.toLowerCase() === 'paid' && a.totalPaid !== '$0' && (
            <span className="text-sm text-green-700 font-medium">Total: {a.totalPaid}</span>
          )}
          <span className="text-xs text-muted-foreground">Source: {a.paymentMethod || (a.sheet.includes('staff') || a.sheet.includes('sponsor') ? 'Comp' : 'Unknown')}</span>
        </div>
      </TableCell>
      <TableCell>
        {!isAuctionClosed && (
          <IconButton
            variant="ghost"
            aria-label={`Delete ${a.firstName} ${a.lastName}`}
            icon={<Trash2 className="w-3.5 h-3.5" />}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onDeleteRequest(a)}
          />
        )}
      </TableCell>
    </TableRow>
  );
}
