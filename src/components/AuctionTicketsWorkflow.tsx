import { useState, useEffect } from "react";
import { getSheetData, getBaseUrl } from "@/lib/google-api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlaySquare, Download, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface Attendee {
  id: string;
  sheet: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ticketsPurchased: string;
  hasGuests: string;
  guestsInfo: string[];
  paymentMethod: string;
  paymentStatus: string;
  totalPaid: string;
}

export default function AuctionTicketsWorkflow() {
  const spreadsheetId = localStorage.getItem("auctionTicketsSpreadsheetId");
  const scriptId = localStorage.getItem("auctionTicketsScriptId");

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAttendees();
  }, [spreadsheetId]);

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
              const guests = [];
              if (row[7] || row[8]) guests.push(`${row[7] || ''} ${row[8] || ''}`.trim());
              if (row[10] || row[11]) guests.push(`${row[10] || ''} ${row[11] || ''}`.trim());
              if (row[13] || row[14]) guests.push(`${row[13] || ''} ${row[14] || ''}`.trim());

              return {
                id: `${sheetName}-${i}`,
                sheet: sheetName,
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
          // Allow it to fail gracefully for specific missing sheets
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

  const runScript = async (functionName: string, label: string) => {
    if (!spreadsheetId || !scriptId) {
      toast.error("Please configure the Auction Tickets Spreadsheet ID and Script ID in Settings.");
      return;
    }

    try {
      toast.loading(`Running ${label}...`, { id: functionName });
      const res = await fetch(`${getBaseUrl()}/api/script/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ functionName, parameters: [spreadsheetId], scriptId })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      toast.success(`${label} completed!`, { id: functionName });
    } catch (e: any) {
      toast.error(`Error: ${e.message}`, { id: functionName });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Auction Tickets</h2>
          <p className="text-muted-foreground mt-2">
            Manage bidders, check-ins, and prepare bidder documents for the day of the auction.
          </p>
        </div>
        {spreadsheetId && (
          <Button variant="outline" onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, "_blank")}>
            Open Spreadsheet
          </Button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 flex flex-col min-h-0">
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
                               <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                                 {a.guestsInfo.map((g, idx) => (
                                   <li key={idx} className="truncate">{g}</li>
                                 ))}
                               </ul>
                             ) : (
                               <span className="text-muted-foreground italic">No guests</span>
                             )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 mb-1">
                              {a.paymentStatus.toLowerCase() === 'paid' ? (
                                <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Paid: {a.totalPaid}</Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-200">{a.paymentStatus || 'Pending'}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="w-5 h-5 text-primary" /> Generate Assets</CardTitle>
              <CardDescription>
                Run automated scripts to generate required materials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full justify-start gap-2" variant="secondary" onClick={() => runScript('apiCreateBidderLabels', 'Create Bidder Labels')}>
                <PlaySquare className="w-4 h-4 text-emerald-600" />
                Create Bidder Labels Document
              </Button>
              <Button className="w-full justify-start gap-2" variant="secondary" onClick={() => runScript('apiSyncBiddersToMain', 'Sync Bidders')}>
                <PlaySquare className="w-4 h-4 text-emerald-600" />
                Sync Bidders to Main Bid Management
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
