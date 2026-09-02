import { Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        <SelectTrigger className="h-10 w-[150px]">
          <Filter className="w-3.5 h-3.5 mr-2 opacity-70" />
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="checked-in">Checked In</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="proxy">Proxy</SelectItem>
        </SelectContent>
      </Select>

      <Select value={paymentFilter} onValueChange={onPaymentFilterChange}>
        <SelectTrigger className="h-10 w-[150px]">
          <SelectValue placeholder="Payment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Payments</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
        <SelectTrigger className="h-10 w-[150px]">
          <SelectValue placeholder="Source" />
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
