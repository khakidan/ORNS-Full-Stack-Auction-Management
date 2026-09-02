import { motion } from "motion/react";
import { AlertCircle, CheckCircle, Clock, Gavel, Ticket, UserCheck } from "lucide-react";
import { TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bidder } from "@/types";
import { BidderAttendeeInfo } from "@/lib/bidderAttendeeInfo";

interface BidderRowProps {
  bidder: Bidder;
  attendeeInfo: BidderAttendeeInfo;
  isAuctionClosed: boolean;
  processingId: string | null;
  isAddingTicketToReceipt: boolean;
  onCheckInAttempt: (bidder: Bidder) => void;
  onMarkAsProxy: (bidder: Bidder) => void;
}

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

  let sheetInfoLabel: string | null = null;
  if (attendee) {
    const sheetInfo = attendee.sheet.replace(' tickets', '');
    if (sheetInfo !== 'tickets' || isGuest) {
      sheetInfoLabel = `${sheetInfo} ${isGuest ? '(GUEST)' : ''}`;
    }
  }

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="group hover:bg-slate-50/50 border-b transition-colors"
    >
      <TableCell className="font-mono font-bold px-4">{bidder.id}</TableCell>
      <TableCell>
        <div className="font-medium whitespace-nowrap">{bidder.firstName} {bidder.lastName}</div>
        {sheetInfoLabel && (
          <div className="text-[10px] uppercase tracking-tighter text-muted-foreground font-bold">
            {sheetInfoLabel}
          </div>
        )}
      </TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm max-w-[200px] truncate">
        {bidder.email || "—"}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-2 min-w-[140px]">
          {/* Ticket Payment Status */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
              <Ticket className="w-2.5 h-2.5" /> Event Ticket
            </span>
            {isPaidStatus ? (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 w-fit text-[10px] h-5">
                <CheckCircle className="w-3 h-3 mr-1" /> Ticket Paid {isGuest ? '*' : ''}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 w-fit text-[10px] h-5">
                <AlertCircle className="w-3 h-3 mr-1" /> Ticket Pending
              </Badge>
            )}
          </div>

          {/* Auction / Checkout Status */}
          <div className="flex flex-col gap-1 border-t pt-1 border-slate-100">
            <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
              <Gavel className="w-2.5 h-2.5" /> Auction Status
            </span>
            {bidder.checkedOut ? (
              <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 w-fit text-[10px] h-5">
                <CheckCircle className="w-3 h-3 mr-1" /> Full Checkout
              </Badge>
            ) : bidder.paid ? (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 w-fit text-[10px] h-5">
                <Clock className="w-3 h-3 mr-1" /> Paid (Not Out)
              </Badge>
            ) : bidder.checkedIn ? (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 w-fit text-[10px] h-5">
                <UserCheck className="w-3 h-3 mr-1" /> Checked-In
              </Badge>
            ) : bidder.isProxy ? (
              <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-50 w-fit text-[10px] h-5">
                Proxy
              </Badge>
            ) : isAuctionClosed ? (
              <Badge variant="outline" className="text-red-600 bg-red-50 border-red-100 w-fit text-[10px] h-5 font-bold">
                No Show
              </Badge>
            ) : (
              <Badge variant="outline" className="text-slate-400 bg-slate-50 w-fit text-[10px] h-5">
                Pending
              </Badge>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right px-4">
        <div className="flex justify-end gap-1.5 md:gap-2">
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
      </TableCell>
    </motion.tr>
  );
}
