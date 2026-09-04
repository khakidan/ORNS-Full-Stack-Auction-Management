import { Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

interface BiddersFilterControlsProps {
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  paymentFilter: string;
  onPaymentFilterChange: (value: string) => void;
  sourceFilter: string;
  onSourceFilterChange: (value: string) => void;
}

export function BiddersFilterControls({
  statusFilter,
  onStatusFilterChange,
  paymentFilter,
  onPaymentFilterChange,
  sourceFilter,
  onSourceFilterChange,
}: BiddersFilterControlsProps) {
  return (
    <>
      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="h-10 w-37.5">
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
        <SelectTrigger className="h-10 w-37.5">
          <SelectValue placeholder="Payment">{(value: string) => PAYMENT_LABELS[value] ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Payments</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
        <SelectTrigger className="h-10 w-37.5">
          <SelectValue placeholder="Source">{(value: string) => SOURCE_LABELS[value] ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="general">General</SelectItem>
          <SelectItem value="sponsors">Sponsors</SelectItem>
          <SelectItem value="staff">Staff</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
