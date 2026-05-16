import { useState, useEffect } from "react";
import { getSheetData, updateSheetData } from "@/lib/google-api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Guest {
  name: string;
  email: string;
}

interface Attendee {
  id: string;
  sheet: string;
  rowIndex: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ticketsPurchased: string;
  hasGuests: string;
  guestsInfo: Guest[];
  paymentMethod: string;
  paymentStatus: string;
  totalPaid: string;
}

export default function TicketAttendeeTab() {
  const spreadsheetId = localStorage.getItem("auctionTicketsSpreadsheetId");
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAttendees();
  }, [spreadsheetId]);

  const updatePaymentStatus = async (attendee: Attendee, newStatus: string) => {
    if (!spreadsheetId) return;
    
    try {
      // Payment status is in column R (index 17)
      await updateSheetData(spreadsheetId, `${attendee.sheet}!R${attendee.rowIndex}`, [[newStatus]]);
      setAttendees(attendees.map(a => a.id === attendee.id ? { ...a, paymentStatus: newStatus } : a));
      toast.success("Payment status updated");
    } catch (e) {
      console.error(e);
      toast.error("Failed to update payment status");
    }
  };

  const fetchAttendees = async () => {
    if (!spreadsheetId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      const sheetsToFetch = ["tickets", "staff tickets", "sponsor tickets"];
      let allAttendees: Attendee[] = [];
      
      for (const sheetName of sheetsToFetch) {
        try {
          const data = await getSheetData(spreadsheetId, `${sheetName}!A:S`);
          if (data.values && data.values.length > 1) {
            const rows = data.values.slice(1).map((row: any[], i: number) => {
              const guests: Guest[] = [];
              if (row[7] || row[8] || row[9]) guests.push({ name: `${row[7] || ''} ${row[8] || ''}`.trim(), email: row[9]?.toString() || '' });
              if (row[10] || row[11] || row[12]) guests.push({ name: `${row[10] || ''} ${row[11] || ''}`.trim(), email: row[12]?.toString() || '' });
              if (row[13] || row[14] || row[15]) guests.push({ name: `${row[13] || ''} ${row[14] || ''}`.trim(), email: row[15]?.toString() || '' });

              return {
                id: `${sheetName}-${i}`,
                sheet: sheetName,
                rowIndex: i + 2,
                firstName: row[0]?.toString() || "",
                lastName: row[1]?.toString() || "",
                email: row[2]?.toString() || "",
                phone: row[3]?.toString() || "",
                ticketsPurchased: row[4]?.toString() || "0",
                hasGuests: row[5]?.toString() || "",
                guestsInfo: guests,
                paymentMethod: row[16]?.toString() || "",
                paymentStatus: row[17]?.toString() || "",
                totalPaid: row[18]?.toString() || ""
              };
            }).filter((a: Attendee) => a.firstName || a.lastName);
            allAttendees = [...allAttendees, ...rows];
          }
        } catch (e) {
          console.error(`Could not fetch ${sheetName}`, e);
        }
      }
      
      setAttendees(allAttendees);
    } catch (e) {
      console.error(e);
      toast.error("Failed to fetch attendees");
    } finally {
      setLoading(false);
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
                        <div className="text-xs text-muted-foreground mt-1 truncate" title={a.email}>{a.email}</div>
                        <div className="text-xs text-muted-foreground">{a.phone}</div>
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
                                 <span className="font-medium text-slate-700">{g.name}</span>
                                 {g.email && <span className="text-[10px] text-muted-foreground break-all">{g.email}</span>}
                               </div>
                             ))}
                           </div>
                         ) : (
                           <div className="mt-0.5 text-muted-foreground italic font-light">No guests</div>
                         )}
                      </TableCell>
                      <TableCell>
                        <Select value={a.paymentStatus || 'Pending'} onValueChange={(val) => updatePaymentStatus(a, val)}>
                          <SelectTrigger className={`w-full ${a.paymentStatus?.toLowerCase() === 'paid' ? 'bg-green-50' : 'bg-amber-50'}`}>
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
