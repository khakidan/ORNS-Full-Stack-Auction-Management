import { ArrowUpDown, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BidderSortConfig } from "@/hooks/useBiddersState";

// SelectValue with no children renders the raw stored value, not the
// matching SelectItem's label - see component-standards.md's documented
// SelectValue failure mode (confirmed via a throwaway RTL render for the
// sibling AddAttendeeDialog.tsx case - the trigger showed the literal
// stored value instead of the item's label).
const STATUS_LABELS: Record<string, string> = {
  all: "All Statuses",
  "checked-in": "Checked In",
  pending: "Pending",
  proxy: "Proxy",
};

const PAYMENT_LABELS: Record<string, string> = {
  all: "All Payments",
  paid: "Paid",
  pending: "Pending",
};

const SOURCE_LABELS: Record<string, string> = {
  all: "All Sources",
  general: "General",
  sponsors: "Sponsors",
  staff: "Staff",
};

// Encodes a BidderSortConfig as one string so it can back a single Select
// (BiddersList.tsx dropped the old clickable-column-header sort UI when
// it moved off <table> markup - see CHANGELOG.md's "UI /
// Layout Tweaks" item).
const SORT_OPTIONS: { value: string; label: string; config: BidderSortConfig }[] = [
  { value: "id-asc", label: "Bidder # (Low to High)", config: { key: "id", direction: "asc" } },
  { value: "id-desc", label: "Bidder # (High to Low)", config: { key: "id", direction: "desc" } },
  { value: "name-asc", label: "Name (A to Z)", config: { key: "name", direction: "asc" } },
  { value: "name-desc", label: "Name (Z to A)", config: { key: "name", direction: "desc" } },
  // "Status" prefix deliberately dropped from these two labels' text (vs.
  // e.g. "Status (Checked-In First)") - it's redundant once shortened,
  // and the shorter strings keep the Sort by trigger's width (and the
  // whole filter row's total width) in check. See the width fix below.
  { value: "status-desc", label: "Checked-In First", config: { key: "status", direction: "desc" } },
  { value: "status-asc", label: "Not Present First", config: { key: "status", direction: "asc" } },
];

const SORT_LABELS: Record<string, string> = Object.fromEntries(SORT_OPTIONS.map((o) => [o.value, o.label]));

function sortConfigToValue(sortConfig: BidderSortConfig | null): string {
  if (!sortConfig) return "id-asc";
  return `${sortConfig.key}-${sortConfig.direction}`;
}

interface BiddersFilterControlsProps {
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  paymentFilter: string;
  onPaymentFilterChange: (value: string) => void;
  sourceFilter: string;
  onSourceFilterChange: (value: string) => void;
  sortConfig: BidderSortConfig | null;
  onSortConfigChange: (config: BidderSortConfig) => void;
}

export function BiddersFilterControls({
  statusFilter,
  onStatusFilterChange,
  paymentFilter,
  onPaymentFilterChange,
  sourceFilter,
  onSourceFilterChange,
  sortConfig,
  onSortConfigChange,
}: BiddersFilterControlsProps) {
  return (
    <>
      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger aria-label="Filter by check-in status" className="h-10 w-37.5 shrink-0">
          <Filter className="w-3.5 h-3.5 mr-2 opacity-70" />
          <SelectValue placeholder="Status">{(value: string) => STATUS_LABELS[value] ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="checked-in">Checked In</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="proxy">Proxy</SelectItem>
        </SelectContent>
      </Select>

      <Select value={paymentFilter} onValueChange={onPaymentFilterChange}>
        <SelectTrigger aria-label="Filter by payment" className="h-10 w-37.5 shrink-0">
          <SelectValue placeholder="Payment">{(value: string) => PAYMENT_LABELS[value] ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Payments</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
        <SelectTrigger aria-label="Filter by source" className="h-10 w-37.5 shrink-0">
          <SelectValue placeholder="Source">{(value: string) => SOURCE_LABELS[value] ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="general">General</SelectItem>
          <SelectItem value="sponsors">Sponsors</SelectItem>
          <SelectItem value="staff">Staff</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={sortConfigToValue(sortConfig)}
        onValueChange={(value) => {
          const option = SORT_OPTIONS.find((o) => o.value === value);
          if (option) onSortConfigChange(option.config);
        }}
      >
        <SelectTrigger aria-label="Sort bidders by" className="h-10 w-64 shrink-0">
          <ArrowUpDown className="w-3.5 h-3.5 mr-2 opacity-70" />
          <SelectValue placeholder="Sort by">{(value: string) => SORT_LABELS[value] ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
