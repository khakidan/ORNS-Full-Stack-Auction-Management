import { UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NewAttendeeEntry {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  tickets: string;
}

interface AddAttendeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newEntry: NewAttendeeEntry;
  onNewEntryChange: (entry: NewAttendeeEntry) => void;
  onSubmit: () => void;
}

export function AddAttendeeDialog({
  open,
  onOpenChange,
  newEntry,
  onNewEntryChange,
  onSubmit,
}: AddAttendeeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button className="gap-2 w-full md:w-auto">
            <UserPlus className="w-4 h-4" />
            Add Entry
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Entry</DialogTitle>
          <DialogDescription>Manually add a sponsor, staff member, or offline ticket buyer.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Name</Label>
            <div className="col-span-3 flex gap-2">
              <Input placeholder="First" value={newEntry.firstName} onChange={e => onNewEntryChange({ ...newEntry, firstName: e.target.value })} />
              <Input placeholder="Last" value={newEntry.lastName} onChange={e => onNewEntryChange({ ...newEntry, lastName: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Email</Label>
            <Input className="col-span-3" value={newEntry.email} onChange={e => onNewEntryChange({ ...newEntry, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Phone</Label>
            <Input className="col-span-3" value={newEntry.phone} onChange={e => onNewEntryChange({ ...newEntry, phone: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Source</Label>
            <Select value={newEntry.source} onValueChange={v => onNewEntryChange({ ...newEntry, source: v })}>
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tickets">General Tickets</SelectItem>
                <SelectItem value="sponsor tickets">Sponsor</SelectItem>
                <SelectItem value="staff tickets">Staff</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Tickets</Label>
            <Input type="number" className="col-span-3" value={newEntry.tickets} onChange={e => onNewEntryChange({ ...newEntry, tickets: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit}>Save Entry</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
