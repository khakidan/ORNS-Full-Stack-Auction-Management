import { Trash2 } from "lucide-react";
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
import { AttendeeEditableCell } from "@/components/AttendeeEditableCell";
import { Attendee } from "@/types";
import { cn } from "@/lib/utils";

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
  return (
    <TableRow className="align-top hover:bg-slate-50/30">
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            <AttendeeEditableCell value={a.firstName} onSave={val => onUpdateField(a, 'firstName', val)} placeholder="First" disabled={isAuctionClosed} />
            <AttendeeEditableCell value={a.lastName} onSave={val => onUpdateField(a, 'lastName', val)} placeholder="Last" disabled={isAuctionClosed} />
          </div>
          <AttendeeEditableCell value={a.email} onSave={val => onUpdateField(a, 'email', val)} placeholder="Email" disabled={isAuctionClosed} />
          <AttendeeEditableCell value={a.phone} onSave={val => onUpdateField(a, 'phone', val)} placeholder="Phone" disabled={isAuctionClosed} />
        </div>
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="outline" className="capitalize text-xs font-normal py-1">
          {a.sheet.replace(' tickets', '').trim() || 'General'}
        </Badge>
      </TableCell>
      <TableCell className="text-center">
        <div className="font-semibold mx-auto w-8 h-8 rounded-md bg-secondary text-secondary-foreground text-sm flex items-center justify-center">
          {a.ticketsPurchased}
        </div>
      </TableCell>
      <TableCell className="text-base">
        <div className="space-y-3">
          {a.guestsInfo.map((g, idx) => (
            <div key={idx} className="flex flex-col gap-0.5 pb-2 border-b border-slate-100 last:border-0 last:pb-0">
              <span className="font-medium text-slate-800 flex items-center gap-2 text-base">
                {g.name || `Guest ${idx + 1}`}
                {g.ownBidderNumber?.toLowerCase() === 'yes' && (
                  <Badge variant="secondary" className="text-[11px] h-4 px-1 font-normal bg-indigo-50 text-indigo-700 hover:bg-indigo-50 border-indigo-200">
                    Own #
                  </Badge>
                )}
              </span>
              <AttendeeEditableCell value={g.email} onSave={val => onUpdateField(a, 'email', val, g.guestIndex)} placeholder="Guest Email" disabled={isAuctionClosed} />
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
