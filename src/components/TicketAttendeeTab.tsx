import { useState, useEffect } from "react";
import { getSheetData, updateSheetData } from "@/lib/google-api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Loader2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAttendees, Attendee, Guest } from "@/hooks/useAttendees";

const EditableEmail = ({ email, onSave, placeholder = "No email" }: { email: string, onSave: (newVal: string) => Promise<void>, placeholder?: string }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(email);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(email);
  }, [email]);

  const handleSave = async () => {
    if (value === email) {
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
      setValue(email);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 mt-1">
        <Input 
          autoFocus 
          value={value} 
          onChange={e => setValue(e.target.value)} 
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="h-6 w-[140px] text-xs px-2"
        />
        <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-3 h-3 animate-spin"/> : <Check className="w-3 h-3" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-red-600" onClick={() => { setValue(email); setEditing(false); }} disabled={saving}>
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 mt-1">
      <div className={`text-xs truncate ${!email ? 'text-muted-foreground italic' : 'text-muted-foreground'}`} title={email || placeholder}>
        {email || placeholder}
      </div>
      <button onClick={() => setEditing(true)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition-opacity">
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
};

export default function TicketAttendeeTab() {
  const spreadsheetId = localStorage.getItem("auctionTicketsSpreadsheetId");
  const { attendees, setAttendees, loading, fetchAttendees } = useAttendees();

  useEffect(() => {
    fetchAttendees(spreadsheetId);
  }, [spreadsheetId, fetchAttendees]);

  const updatePaymentStatus = async (attendee: Attendee, newStatus: string) => {
    if (!spreadsheetId) return;
    if (attendee.sheet !== 'tickets') return; // Cannot update sponsor/staff sheets
    
    try {
      // Payment status is in column U
      await updateSheetData(spreadsheetId, `${attendee.sheet}!U${attendee.rowIndex}`, [[newStatus]]);
      setAttendees(attendees.map(a => a.id === attendee.id ? { ...a, paymentStatus: newStatus } : a));
      toast.success("Payment status updated");
    } catch (e) {
      console.error(e);
      toast.error("Failed to update payment status");
    }
  };

  const updateEmail = async (attendee: Attendee, newEmail: string, guestIndex?: number) => {
    if (!spreadsheetId) return;
    
    let col = 'C';
    if (attendee.sheet === 'tickets') {
      if (guestIndex === 1) col = 'J';
      if (guestIndex === 2) col = 'N';
      if (guestIndex === 3) col = 'R';
    } else {
      if (guestIndex === 1) col = 'J';
      if (guestIndex === 2) col = 'M';
      if (guestIndex === 3) col = 'P';
    }

    try {
      await updateSheetData(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newEmail]]);
      
      setAttendees(attendees.map(a => {
        if (a.id !== attendee.id) return a;
        if (guestIndex === undefined) {
          return { ...a, email: newEmail };
        } else {
          return {
            ...a,
            guestsInfo: a.guestsInfo.map(g => g.guestIndex === guestIndex ? { ...g, email: newEmail } : g)
          };
        }
      }));
      toast.success(`Email updated for ${guestIndex ? 'guest' : 'attendee'}`);
    } catch (e) {
      console.error(e);
      toast.error("Failed to update email");
      throw e;
    }
  };

  return (
    <Card className="flex flex-col min-h-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Attendee List</CardTitle>
        <CardDescription>
          Combined listing of attendees from all ticket sources.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-0 min-h-[300px]">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : !spreadsheetId ? (
          <div className="flex justify-center items-center h-48 text-muted-foreground text-sm">
            No spreadsheet configured.
          </div>
        ) : (
          <div className="border border-x-0 border-b-0 overflow-x-auto pb-4">
             <Table className="w-full table-fixed min-w-[800px]">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead style={{ width: '25%' }}>Name & Contact</TableHead>
                  <TableHead style={{ width: '15%' }}>Source</TableHead>
                  <TableHead style={{ width: '10%' }}>Tickets</TableHead>
                  <TableHead style={{ width: '25%' }}>Guests</TableHead>
                  <TableHead style={{ width: '25%' }}>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendees.length === 0 ? (
                   <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No attendees found.
                      </TableCell>
                   </TableRow>
                ) : (
                  attendees.map(a => (
                    <TableRow key={a.id} className="align-top hover:bg-slate-50/50">
                      <TableCell>
                        <div className="font-medium text-foreground">{a.firstName} {a.lastName}</div>
                        <EditableEmail email={a.email} onSave={(val) => updateEmail(a, val)} placeholder="No email" />
                        <div className="text-xs text-muted-foreground mt-1">{a.phone}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs font-normal">
                          {a.sheet.replace('tickets', '').trim() || 'General'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-center w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                          {a.ticketsPurchased}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                         {a.guestsInfo.length > 0 ? (
                           <div className="space-y-2 mt-0.5">
                             {a.guestsInfo.map((g, idx) => (
                               <div key={idx} className="flex flex-col gap-0.5 pb-2 mb-2 border-b border-slate-100 last:border-0 last:pb-0 last:mb-0">
                                 <span className="font-medium text-slate-700">
                                   {g.name || `Guest ${idx + 1}`}
                                   {g.ownBidderNumber?.toLowerCase() === 'yes' && (
                                     <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1 leading-none font-normal bg-indigo-50 text-indigo-700 hover:bg-indigo-50 border-indigo-200">
                                       Own Bidder #
                                     </Badge>
                                   )}
                                 </span>
                                 <div className="-mt-1">
                                    <EditableEmail email={g.email} onSave={(val) => updateEmail(a, val, g.guestIndex)} placeholder="No email" />
                                 </div>
                               </div>
                             ))}
                           </div>
                         ) : (
                           <div className="mt-0.5 text-muted-foreground italic font-light">No guests</div>
                         )}
                      </TableCell>
                      <TableCell>
                        {a.sheet === 'tickets' ? (
                          <>
                            <Select value={a.paymentStatus || 'Pending'} onValueChange={(val) => updatePaymentStatus(a, val)}>
                              <SelectTrigger className={`w-full h-8 text-xs ${a.paymentStatus?.toLowerCase() === 'paid' ? 'bg-green-50' : 'bg-amber-50'}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Paid">Paid</SelectItem>
                                <SelectItem value="Pending">Pending</SelectItem>
                              </SelectContent>
                            </Select>
                            {a.paymentStatus?.toLowerCase() === 'paid' && (
                              <div className="text-xs text-green-700 mt-1">Paid: {a.totalPaid}</div>
                            )}
                            <div className="text-[10px] text-muted-foreground mt-1">
                              Via: {a.paymentMethod || 'Unknown'}
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 font-normal w-fit">
                              Paid
                            </Badge>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              Via: Comp
                            </div>
                          </div>
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
  );
}
