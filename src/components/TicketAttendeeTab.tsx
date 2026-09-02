import { useState, useEffect } from "react";
import { updateSheetData, getSheetData } from "@/lib/google-api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Users, Loader2, Pencil, Check, X, Trash2, UserPlus, Filter, Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { Attendee, Guest } from "@/types";

const EditableCell = ({ value: initialValue, onSave, placeholder = "N/A", disabled = false }: { value: string, onSave: (newVal: string) => Promise<void>, placeholder?: string, disabled?: boolean }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleSave = async () => {
    if (value === initialValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setValue(initialValue);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input 
          autoFocus 
          value={value} 
          onChange={e => setValue(e.target.value)} 
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="h-8 min-w-[100px] text-sm px-2"
        />
        <IconButton
          variant="ghost"
          aria-label="Save"
          className="h-8 w-8 text-green-600"
          icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          onClick={handleSave}
          disabled={saving}
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      <div className={`text-base truncate ${!initialValue ? 'text-muted-foreground italic' : ''}`} title={initialValue || placeholder}>
        {initialValue || placeholder}
      </div>
      {!disabled && (
        <button onClick={() => setEditing(true)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition-opacity">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default function TicketAttendeeTab() {
  const { config } = useConfig();
  const spreadsheetId = config.auctionTicketsSpreadsheetId;
  const { attendees, setAttendees, loading, addAttendee, removeAttendee, fetchAttendees, isAuctionClosed } = useAuction();

  const [filterSource, setFilterSource] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [attendeeToDelete, setAttendeeToDelete] = useState<Attendee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newEntry, setNewEntry] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    source: "tickets",
    tickets: "1"
  });

  const filteredAttendees = attendees.filter(a => {
    const matchesSource = filterSource === "all" || a.sheet === filterSource;
    const searchLow = searchTerm.toLowerCase();
    const matchesSearch = 
      a.firstName.toLowerCase().includes(searchLow) || 
      a.lastName.toLowerCase().includes(searchLow) || 
      a.email.toLowerCase().includes(searchLow);
    return matchesSource && matchesSearch;
  });

  const updateField = async (attendee: Attendee, field: string, newValue: string, guestIndex?: number) => {
    if (!spreadsheetId) return;
    
    let col = 'A';
    if (field === 'lastName') col = 'B';
    if (field === 'email') {
      col = 'C';
      if (attendee.sheet === 'tickets') {
        if (guestIndex === 1) col = 'J';
        else if (guestIndex === 2) col = 'N';
        else if (guestIndex === 3) col = 'R';
      } else {
        if (guestIndex === 1) col = 'J';
        else if (guestIndex === 2) col = 'M';
        else if (guestIndex === 3) col = 'P';
      }
    }
    if (field === 'phone') col = 'D';

    const previousAttendees = [...attendees];

    // Optimistic update
    setAttendees(prev => prev.map(a => {
      if (a.id !== attendee.id) return a;
      if (guestIndex === undefined) {
        return { ...a, [field]: newValue };
      } else {
        return {
          ...a,
          guestsInfo: a.guestsInfo.map(g => g.guestIndex === guestIndex ? { ...g, email: newValue } : g)
        };
      }
    }));

    // Background sync
    updateSheetData(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newValue]])
      .then(() => toast.success("Updated successfully"))
      .catch(e => {
        console.error(e);
        // Rollback
        setAttendees(previousAttendees);
        toast.error("Failed to sync updates—rolling back...");
      });
  };

  const updatePaymentStatus = async (attendee: Attendee, newStatus: string) => {
    if (!spreadsheetId) return;

    const previousAttendees = [...attendees];
    
    // Optimistic update
    setAttendees(prev => prev.map(a => a.id === attendee.id ? { ...a, paymentStatus: newStatus } : a));

    // Background sync
    const col = attendee.sheet === 'tickets' ? 'U' : 'R'; // Just an estimate, might differ per sheet
    updateSheetData(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newStatus]])
      .then(() => toast.success("Payment status updated"))
      .catch(e => {
        console.error(e);
        // Rollback
        setAttendees(previousAttendees);
        toast.error("Failed to sync updates—rolling back...");
      });
  };

  const handleAddSubmit = async () => {
    if (!newEntry.firstName || !newEntry.lastName) {
      toast.error("Name is required");
      return;
    }

    const row = new Array(25).fill("");
    row[0] = newEntry.firstName;
    row[1] = newEntry.lastName;
    row[2] = newEntry.email;
    row[3] = newEntry.phone;
    row[4] = newEntry.tickets;
    
    if (newEntry.source !== 'tickets') {
      row[16] = "Paid"; // Payment Status
      row[17] = "$0";   // Total Paid
    } else {
       row[19] = "Manual";
       row[20] = "Pending";
       row[21] = "$0";
    }

    await addAttendee(newEntry.source, row);
    setIsAddDialogOpen(false);
    setNewEntry({ firstName: "", lastName: "", email: "", phone: "", source: "tickets", tickets: "1" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
             <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
             <Input 
               placeholder="Search attendees..." 
               className="pl-9 h-10" 
               value={searchTerm}
               onChange={e => setSearchTerm(e.target.value)}
             />
          </div>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-[180px] h-10">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="tickets">General Tickets</SelectItem>
              <SelectItem value="sponsor tickets">Sponsors</SelectItem>
              <SelectItem value="staff tickets">Staff</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <Button variant="outline" onClick={fetchAttendees} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {!isAuctionClosed && (
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
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
                      <Input placeholder="First" value={newEntry.firstName} onChange={e => setNewEntry({...newEntry, firstName: e.target.value})} />
                      <Input placeholder="Last" value={newEntry.lastName} onChange={e => setNewEntry({...newEntry, lastName: e.target.value})} />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Email</Label>
                    <Input className="col-span-3" value={newEntry.email} onChange={e => setNewEntry({...newEntry, email: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Phone</Label>
                    <Input className="col-span-3" value={newEntry.phone} onChange={e => setNewEntry({...newEntry, phone: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Source</Label>
                    <Select value={newEntry.source} onValueChange={v => setNewEntry({...newEntry, source: v})}>
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
                    <Input type="number" className="col-span-3" value={newEntry.tickets} onChange={e => setNewEntry({...newEntry, tickets: e.target.value})} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleAddSubmit}>Save Entry</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {isAuctionClosed && (
            <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 h-10 px-4">
              Auction Closed (Read Only)
            </Badge>
          )}
      </div>
    </div>

      <Card className="flex flex-col min-h-0">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Attendee List</CardTitle>
          <CardDescription>
            {filteredAttendees.length} entries found across participating sources.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0 min-h-[400px]">
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="border-t">
               <Table className="w-full">
                <TableHeader>
                  <TableRow className="bg-slate-50/50">
                    <TableHead className="w-[30%]">Name & Contact</TableHead>
                    <TableHead className="w-[12%] text-center">Source</TableHead>
                    <TableHead className="w-[8%] text-center">Tix</TableHead>
                    <TableHead className="w-[25%]">Guests</TableHead>
                    <TableHead className="w-[20%]">Payment</TableHead>
                    <TableHead className="w-[5%]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAttendees.length === 0 ? (
                     <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                          No results match your filters.
                        </TableCell>
                     </TableRow>
                  ) : (
                    filteredAttendees.map(a => (
                      <TableRow key={a.id} className="align-top hover:bg-slate-50/30">
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex gap-1">
                               <EditableCell value={a.firstName} onSave={val => updateField(a, 'firstName', val)} placeholder="First" disabled={isAuctionClosed} />
                               <EditableCell value={a.lastName} onSave={val => updateField(a, 'lastName', val)} placeholder="Last" disabled={isAuctionClosed} />
                            </div>
                            <EditableCell value={a.email} onSave={val => updateField(a, 'email', val)} placeholder="Email" disabled={isAuctionClosed} />
                            <EditableCell value={a.phone} onSave={val => updateField(a, 'phone', val)} placeholder="Phone" disabled={isAuctionClosed} />
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
                                <EditableCell value={g.email} onSave={val => updateField(a, 'email', val, g.guestIndex)} placeholder="Guest Email" disabled={isAuctionClosed} />
                              </div>
                            ))}
                            {a.guestsInfo.length === 0 && <span className="text-muted-foreground italic text-sm">No guests listed</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                             <Select value={a.paymentStatus || 'Pending'} onValueChange={(val) => updatePaymentStatus(a, val)} disabled={isAuctionClosed}>
                               <SelectTrigger className={`h-9 text-sm ${a.paymentStatus?.toLowerCase() === 'paid' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
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
                               onClick={() => setAttendeeToDelete(a)}
                             />
                           )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
               </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!attendeeToDelete} onOpenChange={(open) => !open && setAttendeeToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 font-bold">
              <Trash2 className="w-5 h-5" /> Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently clear <strong>{attendeeToDelete?.firstName} {attendeeToDelete?.lastName}</strong>'s entry? 
              This action will remove the record from the database and cannot be undone easily.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAttendeeToDelete(null)}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={async () => {
                if (!attendeeToDelete) return;
                setIsDeleting(true);
                try {
                  await removeAttendee(attendeeToDelete);
                } finally {
                  setIsDeleting(false);
                  setAttendeeToDelete(null);
                }
              }}
              disabled={isDeleting}
              className="flex items-center gap-2"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
