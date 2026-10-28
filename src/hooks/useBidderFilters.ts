import { useMemo, useState } from "react";
import { getBidderAttendeeInfo } from "@/lib/bidderAttendeeInfo";
import { Bidder, Attendee } from "@/types";

// The only three keys sortedBidders' comparator below actually handles -
// narrowing sortConfig to this literal union (instead of a bare `string`)
// is what lets valA/valB below be typed `string | number` instead of
// `any`: any other key would previously fall through every branch
// silently leaving valA/valB `undefined`, sorting nothing, with no
// compiler signal that the key was never handled. Not reachable today
// (BiddersFilterControls.tsx's "Sort by" select is the only caller, and
// it only ever sets these three), but this makes that guarantee checked
// at compile time instead of merely true by inspection.
export type BidderSortKey = "id" | "name" | "status";

export interface BidderSortConfig {
  key: BidderSortKey;
  direction: "asc" | "desc";
}

/**
 * The Bidders tab's search, filters (status, ticket payment, ticket
 * source) and sort, and the list they produce. Split out of
 * useBiddersState.ts.
 */
export function useBidderFilters(bidders: Bidder[], attendees: Attendee[]) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const [sortConfig, setSortConfig] = useState<BidderSortConfig | null>({
    key: "id",
    direction: "asc",
  });

  const sortedBidders = useMemo(() => {
    const filtered = bidders.filter(b => {
      const matchesSearch =
        b.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.id.includes(searchTerm);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "checked-in" && b.checkedIn) ||
        (statusFilter === "pending" && !b.checkedIn && !b.isProxy) ||
        (statusFilter === "proxy" && b.isProxy);

      const { attendee, isGuest } = getBidderAttendeeInfo(b, attendees);

      const isPaid = isGuest || attendee?.paymentStatus.toLowerCase() === "paid";

      const matchesPayment =
        paymentFilter === "all" ||
        (paymentFilter === "paid" && isPaid) ||
        (paymentFilter === "pending" && !isPaid && !!attendee);

      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "general" && (!attendee || attendee.sheet === "tickets")) ||
        (sourceFilter === "sponsors" && attendee?.sheet === "sponsor tickets") ||
        (sourceFilter === "staff" && attendee?.sheet === "staff tickets");

      return matchesSearch && matchesStatus && matchesPayment && matchesSource;
    });

    return [...filtered].sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;

      let valA: string | number;
      let valB: string | number;

      if (key === "id") {
        valA = parseInt(a.id);
        valB = parseInt(b.id);
      } else if (key === "name") {
        valA = `${a.lastName} ${a.firstName}`.toLowerCase();
        valB = `${b.lastName} ${b.firstName}`.toLowerCase();
      } else if (key === "status") {
        // Sort status: Checked In (2) > Proxy (1) > Not Present (0)
        valA = a.checkedIn ? 2 : a.isProxy ? 1 : 0;
        valB = b.checkedIn ? 2 : b.isProxy ? 1 : 0;
      }

      if (valA < valB) return direction === "asc" ? -1 : 1;
      if (valA > valB) return direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [bidders, attendees, searchTerm, statusFilter, paymentFilter, sourceFilter, sortConfig]);

  // Distinguishes "nothing has ever loaded" from "filtered down to nothing" -
  // BiddersTable.tsx uses this to pick the right empty-state message,
  // matching Items.tsx's own search/no-data distinction.
  const hasActiveFilters = searchTerm !== "" || statusFilter !== "all" || paymentFilter !== "all" || sourceFilter !== "all";

  return {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    paymentFilter,
    setPaymentFilter,
    sourceFilter,
    setSourceFilter,
    sortConfig,
    setSortConfig,
    sortedBidders,
    hasActiveFilters,
  };
}
