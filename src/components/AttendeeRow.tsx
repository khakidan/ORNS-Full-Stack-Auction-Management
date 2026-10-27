import { AlertTriangle, Mail, Phone, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/IconButton";
import { Attendee } from "@/types";
import { cn } from "@/lib/utils";
import { hasMoreGuestsThanTicketsPurchased } from "@/lib/attendeeValidation";

const SOURCE_BADGE_STYLES: Record<string, string> = {
  "tickets": "bg-muted text-muted-foreground",
  "sponsor tickets": "bg-indigo-50 text-indigo-700 border-indigo-100",
  "staff tickets": "bg-emerald-50 text-emerald-700 border-emerald-100",
};

const SOURCE_LABELS: Record<string, string> = {
  "tickets": "General",
  "sponsor tickets": "Sponsor",
  "staff tickets": "Staff",
};

interface AttendeeRowProps {
  attendee: Attendee;
  isAuctionClosed: boolean;
  /** Whether the signed-in person may delete attendees (Administrators and up). */
  canDelete: boolean;
  onEdit: (attendee: Attendee) => void;
  onUpdatePaymentStatus: (attendee: Attendee, newStatus: string) => void;
  onDeleteRequest: (attendee: Attendee) => void;
}

/**
 * Redesigned per the user-reported "Attendee List UI Layout Issues" bug:
 * replaces the old <table>-based row (four separate EditableCells packed
 * into one narrow column, with the first/last name gap the report called
 * out) with a single flexible row. All field editing now happens in one
 * place - EditAttendeeDialog.tsx, opened via the pencil icon - instead
 * of per-field inline editors.
 */
export function AttendeeRow({
  attendee: a,
  isAuctionClosed,
  canDelete,
  onEdit,
  onUpdatePaymentStatus,
  onDeleteRequest,
}: AttendeeRowProps) {
  const guestsExceedTickets = hasMoreGuestsThanTicketsPurchased(a);
  const isPaid = a.paymentStatus?.toLowerCase() === 'paid';
  const methodDisplay = a.paymentMethod || (a.sheet.includes('staff') || a.sheet.includes('sponsor') ? 'Comp' : 'Unknown');

  return (
    <div className="group/row flex items-start gap-4 px-5 py-4 border-b last:border-0 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-row-title">{a.firstName}</span>
          <span className="font-semibold text-row-title">{a.lastName}</span>
          <Badge variant="outline" className={cn("capitalize text-xs font-normal", SOURCE_BADGE_STYLES[a.sheet])}>
            {SOURCE_LABELS[a.sheet] || 'General'}
          </Badge>
          {guestsExceedTickets && (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"
              title={`${a.guestsInfo.length} guests listed but only ${a.ticketsPurchased || 0} ticket(s) purchased - please correct in the spreadsheet.`}
            >
              <AlertTriangle className="w-3 h-3" /> Guests exceed tickets
            </span>
          )}
        </div>
        <div className="flex items-center gap-3.5 flex-wrap text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 shrink-0" />
            {a.email || <span className="italic">No email</span>}
          </span>
          {a.phone && (
            <span className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 shrink-0" />
              {a.phone}
            </span>
          )}
        </div>
        {a.guestsInfo.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xxs font-semibold uppercase tracking-wide text-muted-foreground">Guests</span>
            {a.guestsInfo.map((g, idx) => (
              <span key={idx} className="inline-flex items-center gap-1.5 text-xs bg-muted rounded-full px-2.5 py-1">
                {g.firstName} {g.lastName}
                {g.ownBidderNumber?.toLowerCase() === 'yes' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title="Has their own bidder number" />
                )}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">No guests listed</span>
        )}
      </div>

      <div className="w-13 shrink-0 flex flex-col items-center gap-0.5 pt-0.5">
        <div
          className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center font-semibold text-sm",
            guestsExceedTickets ? "bg-red-100 text-red-700 ring-1 ring-red-300" : "bg-secondary text-secondary-foreground"
          )}
        >
          {a.ticketsPurchased}
        </div>
        <span className="text-xxs uppercase text-muted-foreground">tix</span>
      </div>

      <div className="w-37.5 shrink-0 flex flex-col gap-1 pt-0.5">
        <button
          type="button"
          disabled={isAuctionClosed}
          onClick={() => onUpdatePaymentStatus(a, isPaid ? 'Pending' : 'Paid')}
          className={cn(
            "inline-flex items-center gap-1.5 w-fit rounded-md border px-2.5 py-1 text-xs font-medium",
            isAuctionClosed ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            isPaid ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", isPaid ? "bg-green-600" : "bg-amber-600")} />
          {isPaid ? 'Paid' : 'Pending'}
        </button>
        {isPaid && a.totalPaid !== '$0' && (
          <span className="text-xs text-green-700 font-medium">Total: {a.totalPaid}</span>
        )}
        <span className="text-xxs text-muted-foreground">Source: {methodDisplay}</span>
      </div>

      <div className="flex gap-1 shrink-0 pt-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
        {!isAuctionClosed && (
          <IconButton
            variant="ghost"
            aria-label={`Edit ${a.firstName} ${a.lastName}`}
            icon={<Pencil className="w-3.5 h-3.5" />}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(a)}
          />
        )}
        {!isAuctionClosed && canDelete && (
          <IconButton
            variant="ghost"
            aria-label={`Delete ${a.firstName} ${a.lastName}`}
            icon={<Trash2 className="w-3.5 h-3.5" />}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onDeleteRequest(a)}
          />
        )}
      </div>
    </div>
  );
}
