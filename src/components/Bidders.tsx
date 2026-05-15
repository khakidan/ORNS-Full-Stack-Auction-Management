// src/components/Bidders.tsx
import { useState } from "react";
import { useAuction, Bidder } from "@/hooks/useAuction";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, CheckCircle, UserCheck, Clock, Loader2, ArrowUpDown, ChevronUp, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { updateSheetData, getBaseUrl, getSheetData } from "@/lib/google-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function Bidders() {
  const { bidders, loading, checkInBidder, fetchBidders } = useAuction();
  const [searchTerm, setSearchTerm] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [isSubmittingWalkIn, setIsSubmittingWalkIn] = useState(false);
  const [walkInForm, setWalkInForm] = useState({ firstName: "", lastName: "", email: "" });

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>({
    key: "id",
    direction: "asc",
  });

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const filteredBidders = bidders
    .filter(b =>
      b.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.id.includes(searchTerm)
    );

  const sortedBidders = [...filteredBidders].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;

    let valA: any;
    let valB: any;

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

  const markAsProxy = async (bidder: Bidder) => {
    if (!bidder) return;
    setProcessingId(bidder.id);
    try {
      const spreadsheetId = localStorage.getItem("spreadsheetId");
      const sheetName = localStorage.getItem("bidderNumbersSheet") || "Bidder-Numbers";

      // Dynamically find the row to prevent sorting bugs
      const data = await getSheetData(spreadsheetId!, `${sheetName}!A:A`);
      const rowIndex = data.values.findIndex((row: any) => row[0]?.toString() === bidder.id) + 1;

      if (rowIndex > 1) {
        await updateSheetData(spreadsheetId!, `${sheetName}!F${rowIndex}`, [[true]]);
        toast.success(`${bidder.firstName} ${bidder.lastName} marked as Proxy Bidder`);
        fetchBidders();
      } else {
        throw new Error("Bidder not found in sheet.");
      }
    } catch (err) {
      toast.error("Failed to mark as proxy");
    } finally {
      setProcessingId(null);
    }
  };

  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInForm.firstName || !walkInForm.lastName) {
      toast.error("First and Last name are required");
      return;
    }

    setIsSubmittingWalkIn(true);
    const scriptId = localStorage.getItem("bidManagementScriptId");
    const spreadsheetId = localStorage.getItem("spreadsheetId");
    try {
      const res = await fetch(`${getBaseUrl()}/api/bidders/walk-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...walkInForm, scriptId, spreadsheetId }),
        credentials: "include"
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create walk-in ticket");
      }

      const result = await res.json();
      toast.success(`Walk-in created: Bidder ${result.bidder.id} - ${result.bidder.firstName} ${result.bidder.lastName}`);

      setIsWalkInOpen(false);
      setWalkInForm({ firstName: "", lastName: "", email: "" });
      fetchBidders();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsSubmittingWalkIn(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by last name..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <Dialog open={isWalkInOpen} onOpenChange={setIsWalkInOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2">
                <UserPlus className="w-4 h-4" />
                New Walk-In Ticket
              </Button>
            }
          />
          <DialogContent>
            <form onSubmit={handleWalkInSubmit}>
              <DialogHeader>
                <DialogTitle>New Walk-In Ticket</DialogTitle>
                <DialogDescription>
                  Enter the details for a new walk-in bidder. This will create a new bidder number and mark them as checked in.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="firstName" className="text-right">
                    First Name
                  </Label>
                  <Input
                    id="firstName"
                    value={walkInForm.firstName}
                    onChange={(e) => setWalkInForm(prev => ({ ...prev, firstName: e.target.value }))}
                    className="col-span-3"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="lastName" className="text-right">
                    Last Name
                  </Label>
                  <Input
                    id="lastName"
                    value={walkInForm.lastName}
                    onChange={(e) => setWalkInForm(prev => ({ ...prev, lastName: e.target.value }))}
                    className="col-span-3"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="email" className="text-right">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Optional"
                    value={walkInForm.email}
                    onChange={(e) => setWalkInForm(prev => ({ ...prev, email: e.target.value }))}
                    className="col-span-3"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsWalkInOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmittingWalkIn}>
                  {isSubmittingWalkIn ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Ticket"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bidder Check-In</CardTitle>
          <CardDescription>
            Search by last name. Mark bidders as present or as proxy bidders.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[650px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 z-10">
                <TableRow>
                  <TableHead 
                    className="w-24 cursor-pointer hover:text-primary transition-colors group"
                    onClick={() => handleSort("id")}
                  >
                    <div className="flex items-center gap-1.5">
                      ID
                      {sortConfig?.key === "id" ? (
                        sortConfig.direction === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:text-primary transition-colors group"
                    onClick={() => handleSort("name")}
                  >
                    <div className="flex items-center gap-1.5">
                      Name
                      {sortConfig?.key === "name" ? (
                        sortConfig.direction === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead 
                    className="cursor-pointer hover:text-primary transition-colors group"
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center gap-1.5">
                      Status
                      {sortConfig?.key === "status" ? (
                        sortConfig.direction === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={5} className="h-12 animate-pulse" /></TableRow>
                  ))
                ) : sortedBidders.length > 0 ? (
                  sortedBidders.map((bidder) => (
                    <TableRow key={bidder.id}>
                      <TableCell className="font-mono font-bold">{bidder.id}</TableCell>
                      <TableCell>
                        <div className="font-medium">{bidder.firstName} {bidder.lastName}</div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                        {bidder.email || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {bidder.checkedIn ? (
                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                              <CheckCircle className="w-3 h-3 mr-1" /> Checked In
                            </Badge>
                          ) : !bidder.isProxy ? (
                            <Badge variant="outline">
                              <Clock className="w-3 h-3 mr-1" /> Not Present
                            </Badge>
                          ) : null}
                          {bidder.isProxy && (
                            <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">
                              Proxy Bidder
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {!bidder.checkedIn && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => checkInBidder(bidder)}
                            disabled={processingId === bidder.id}
                          >
                            Check In
                          </Button>
                        )}
                        {!bidder.isProxy && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => markAsProxy(bidder)}
                            disabled={processingId === bidder.id}
                          >
                            <UserCheck className="w-4 h-4" />
                            Proxy Bidder
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      No bidders found matching "{searchTerm}"
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}