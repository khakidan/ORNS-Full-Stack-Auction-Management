import { AnimatePresence } from "motion/react";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { TableHead, TableRow } from "@/components/ui/table";
import { DataTableWrapper } from "@/components/DataTableWrapper";
import { BidderRow } from "@/components/BidderRow";
import { Bidder } from "@/types";
import { BidderAttendeeInfo } from "@/lib/bidderAttendeeInfo";
import { cn } from "@/lib/utils";

interface SortConfig {
  key: string;
  direction: "asc" | "desc";
}

interface BiddersTableProps {
  bidders: Bidder[];
  loading: boolean;
  sortConfig: SortConfig | null;
  onSort: (key: string) => void;
  /** Unfiltered bidder count, so the empty state can tell "nothing loaded yet" apart from "filtered down to nothing" - matches Items.tsx's own search/no-data distinction. */
  totalBiddersCount: number;
  hasActiveFilters: boolean;
  getAttendeeInfo: (bidder: Bidder) => BidderAttendeeInfo;
  isAuctionClosed: boolean;
  processingId: string | null;
  isAddingTicketToReceipt: boolean;
  onCheckInAttempt: (bidder: Bidder) => void;
  onMarkAsProxy: (bidder: Bidder) => void;
}

function SortableHead({ label, sortKey, sortConfig, onSort, className }: {
  label: string;
  sortKey: string;
  sortConfig: SortConfig | null;
  onSort: (key: string) => void;
  className?: string;
}) {
  return (
    <TableHead
      className={cn("cursor-pointer hover:text-primary transition-colors group", className)}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        {sortConfig?.key === sortKey ? (
          sortConfig.direction === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </TableHead>
  );
}

export function BiddersTable({
  bidders,
  loading,
  sortConfig,
  onSort,
  totalBiddersCount,
  hasActiveFilters,
  getAttendeeInfo,
  isAuctionClosed,
  processingId,
  isAddingTicketToReceipt,
  onCheckInAttempt,
  onMarkAsProxy,
}: BiddersTableProps) {
  return (
    <DataTableWrapper<Bidder>
      items={bidders}
      loading={loading}
      columnCount={5}
      skeletonRowCount={6}
      wrapItemRows={(rows) => <AnimatePresence mode="popLayout">{rows}</AnimatePresence>}
      header={
        <TableRow>
          <SortableHead label="ID" sortKey="id" sortConfig={sortConfig} onSort={onSort} className="w-20 md:w-24 px-4 font-mono" />
          <SortableHead label="Name" sortKey="name" sortConfig={sortConfig} onSort={onSort} />
          <TableHead className="hidden lg:table-cell">Email</TableHead>
          <SortableHead label="Status" sortKey="status" sortConfig={sortConfig} onSort={onSort} />
          <TableHead className="text-right px-4">Actions</TableHead>
        </TableRow>
      }
      emptyMessage={
        totalBiddersCount === 0
          ? "No bidders loaded yet. Run \"Set Up Bid Management App\" or add a walk-in ticket to get started."
          : hasActiveFilters
            ? "No bidders match your search or filters."
            : "No bidders found."
      }
      renderRow={(bidder) => (
        <BidderRow
          key={bidder.id}
          bidder={bidder}
          attendeeInfo={getAttendeeInfo(bidder)}
          isAuctionClosed={isAuctionClosed}
          processingId={processingId}
          isAddingTicketToReceipt={isAddingTicketToReceipt}
          onCheckInAttempt={onCheckInAttempt}
          onMarkAsProxy={onMarkAsProxy}
        />
      )}
    />
  );
}
