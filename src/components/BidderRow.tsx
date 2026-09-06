import { motion } from "motion/react";
import { AlertCircle, CheckCircle, Clock, Gavel, Mail, Ticket, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bidder } from "@/types";
import { BidderAttendeeInfo } from "@/lib/bidderAttendeeInfo";
import { cn } from "@/lib/utils";

const SOURCE_BADGE_STYLES: Record<string, string> = {
  "sponsor tickets": "bg-indigo-50 text-indigo-700 border-indigo-100",
  "staff tickets": "bg-emerald-50 text-emerald-700 border-emerald-100",
};

interface BidderRowProps {
  bidder: Bidder;
  attendeeInfo: BidderAttendeeInfo;
  isAuctionClosed: boolean;
  processingId: string | null;
  isAddingTicketToReceipt: boolean;
  onCheckInAttempt: (bidder: Bidder) => void;
  onMarkAsProxy: (bidder: Bidder) => void;
}

/**
 * Redesigned to match AttendeeRow.tsx's row-based visual language (see
 * refactor-opportunities.md's "UI / Layout Tweaks" item - the user
 * specifically asked for the Attendee List's look here) instead of the
 * old cramped <table> row that packed two stacked status badges into one
 * narrow column. All the same information and actions are still here -
 * check-in/proxy mutual exclusion, the ticket-payment and auction-status
 * indicators, the read-only state when the auction is closed - just laid
 * out as one flexible row instead of fixed table columns.
 */
export function BidderRow({
  bidder,
  attendeeInfo,
  isAuctionClosed,
  processingId,
  isAddingTicketToReceipt,
  onCheckInAttempt,
  onMarkAsProxy,
}: BidderRowProps) {
  const { attendee, isGuest } = attendeeInfo;
  const isPaidStatus = isGuest || attendee?.paymentStatus.toLowerCase() === 'paid';
  const isDisabled = processingId === bidder.id || isAddingTicketToReceipt;

  let sourceLabel: string | null = null;
  if (attendee) {
    const sheetInfo = attendee.sheet.replace(' tickets', '');
    if (sheetInfo !== 'tickets' || isGuest) {
      sourceLabel = `${sheetInfo}${isGuest ? ' (Guest)' : ''}`;
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-testid={`bidder-row-${bidder.id}`}
      className="group/row flex items-center gap-4 px-5 py-4 border-b last:border-0 hover:bg-muted/50 transition-colors"
    >
      <div className="w-13 shrink-0 flex flex-col items-center gap-0.5">
        <div className="w-10 h-10 rounded-md bg-secondary text-secondary-foreground flex items-center justify-center font-mono font-bold text-sm">
          {bidder.id}
        </div>
        <span className="text-[10px] uppercase text-muted-foreground">ID</span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[15px]">{bidder.firstName} {bidder.lastName}</span>
          {sourceLabel && (
            <Badge variant="outline" className={cn("capitalize text-xs font-normal", SOURCE_BADGE_STYLES[attendee!.sheet])}>
              {sourceLabel}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Mail className="w-3.5 h-3.5 shrink-0" />
          {bidder.email || <span className="italic">No email</span>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isPaidStatus ? (
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 w-fit text-xs font-normal">
              <Ticket className="w-3 h-3 mr-1" /> Ticket Paid{isGuest ? '*' : ''}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 w-fit text-xs font-normal">
              <Ticket className="w-3 h-3 mr-1" /> Ticket Pending
            </Badge>
          )}

          {bidder.checkedOut ? (
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 w-fit text-xs font-normal">
              <Gavel className="w-3 h-3 mr-1" /> Full Checkout
            </Badge>
          ) : bidder.paid ? (
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 w-fit text-xs font-normal">
              <Clock className="w-3 h-3 mr-1" /> Paid (Not Out)
            </Badge>
          ) : bidder.checkedIn ? (
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 w-fit text-xs font-normal">
              <UserCheck className="w-3 h-3 mr-1" /> Checked-In
            </Badge>
          ) : bidder.isProxy ? (
            <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-50 w-fit text-xs font-normal">
              Proxy
            </Badge>
          ) : isAuctionClosed ? (
            <Badge variant="outline" className="text-red-600 bg-red-50 border-red-100 w-fit text-xs font-bold">
              <AlertCircle className="w-3 h-3 mr-1" /> No Show
            </Badge>
          ) : (
            <Badge variant="outline" className="text-slate-400 bg-slate-50 w-fit text-xs font-normal">
              Pending
            </Badge>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 md:gap-2 shrink-0">
        {isAuctionClosed ? (
          <span className="text-xs text-muted-foreground italic">Read Only</span>
        ) : (
          <>
            {!bidder.checkedIn && !bidder.isProxy && (
              <Button
                size="sm"
                variant="default"
                onClick={() => onCheckInAttempt(bidder)}
                disabled={isDisabled}
                className="h-8 md:h-9"
              >
                <span className="hidden sm:inline">Check In</span>
                <UserCheck className="w-4 h-4 sm:hidden" />
              </Button>
            )}
            {!bidder.isProxy && !bidder.checkedIn && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onMarkAsProxy(bidder)}
                disabled={isDisabled}
                className="h-8 md:h-9"
              >
                <UserCheck className="w-4 h-4 md:mr-1.5" />
                <span className="hidden md:inline">Proxy</span>
              </Button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
