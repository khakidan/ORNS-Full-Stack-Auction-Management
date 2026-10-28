import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { CheckCircle2, HandHeart, Link2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { DataTableWrapper } from "@/components/DataTableWrapper";
import { FormField } from "@/components/FormField";
import { RefreshableListCard } from "@/components/RefreshableListCard";
import { useAuction } from "@/context/AuctionContext";
import { Volunteer, VolunteerStatus, useVolunteersAdminState } from "@/hooks/useVolunteersAdminState";
import { cn } from "@/lib/utils";

const STATUS: Record<VolunteerStatus, { label: string; className: string }> = {
  invited: { label: "Invited", className: "bg-blue-50 text-blue-700 border-blue-200" },
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  deactivated: { label: "Ended", className: "bg-slate-100 text-slate-600 border-slate-200" },
  revoked: { label: "Revoked", className: "bg-red-50 text-red-700 border-red-200" },
};

const when = (iso?: string) => (iso ? format(new Date(iso), "MMM d, h:mm a") : "—");

/**
 * Settings > Users > Volunteers (Administrators): connect the shared
 * volunteer Google account, invite people outside @orns.org with a
 * one-time sign-in link, and see who signed in. Links only work while the
 * auction is Live; access ends when it's Closed.
 */
export default function VolunteersAdmin() {
  const { auctionState } = useAuction();
  const state = useVolunteersAdminState();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [revoking, setRevoking] = useState<Volunteer | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !/@orns\.org$/i.test(email.trim());
  const hasEnded = state.volunteers.some((v) => v.status === "deactivated" || v.status === "revoked");

  const sendInvite = async () => {
    if (await state.invite(name.trim(), email.trim())) {
      setInviteOpen(false);
      setName("");
      setEmail("");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-muted-foreground" />
            Volunteer Google Account
          </CardTitle>
          <CardDescription>
            Volunteers don't have ORNS Google accounts, so the app reads and writes the spreadsheets for them as this shared
            account. It needs Editor access to the three auction spreadsheets, the receipt folders and the Action History.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          {state.account?.connected ? (
            <span className="flex items-center gap-2 text-sm" data-testid="volunteer-account-status">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Connected: {state.account.email}
              {state.account.connectedBy && <span className="text-muted-foreground">· by {state.account.connectedBy} on {when(state.account.connectedAt)}</span>}
            </span>
          ) : (
            <span className="text-sm text-amber-700" data-testid="volunteer-account-status">
              Not connected - volunteer links won't work until {state.account?.email || "the volunteer account"} is connected.
            </span>
          )}
          <Button variant="outline" onClick={() => { window.location.href = "/auth/volunteer-account/connect"; }}>
            {state.account?.connected ? "Reconnect" : "Connect"}
          </Button>
        </CardContent>
      </Card>

      <RefreshableListCard
        icon={<HandHeart className="w-5 h-5 text-primary" />}
        title="Volunteers"
        description={`People outside @orns.org who help on the night. They see only Bid Management, sign in with a one-time link that works while the auction is Live (it's ${auctionState === "live" ? "Live now" : auctionState === "closed" ? "Closed" : "in Prep"}), and their access ends when it's Closed.`}
        loading={state.loading}
        onRefresh={state.fetchVolunteers}
      >
        <div className="flex flex-wrap gap-2 mb-4">
          <Button className="gap-2" onClick={() => setInviteOpen(true)}>
            <Send className="w-4 h-4" /> Invite Volunteer
          </Button>
          {hasEnded && (
            <LoadingButton variant="outline" loading={state.busyId === "clear"} onClick={state.clearEnded}>
              Clear ended volunteers
            </LoadingButton>
          )}
        </div>

        <DataTableWrapper<Volunteer>
          items={state.volunteers}
          loading={state.loading}
          columnCount={6}
          header={
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-36">Signed in</TableHead>
              <TableHead className="w-32">Last seen</TableHead>
              <TableHead className="w-48 text-right">Actions</TableHead>
            </TableRow>
          }
          emptyMessage="No volunteers invited yet."
          renderRow={(v) => (
            <TableRow key={v.id} data-testid={`volunteer-row-${v.email}`}>
              <TableCell className="font-medium">{v.name}</TableCell>
              <TableCell>{v.email}</TableCell>
              <TableCell>
                <Badge variant="outline" className={cn("font-normal", STATUS[v.status].className)} title={v.deactivatedReason === "auction_closed" ? "Ended when the auction closed" : undefined}>
                  {STATUS[v.status].label}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{when(v.redeemedAt)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{v.lastSeenAt ? formatDistanceToNow(new Date(v.lastSeenAt), { addSuffix: true }) : "—"}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <LoadingButton size="sm" variant="ghost" loading={state.busyId === v.id} onClick={() => state.resend(v)}>
                    {v.status === "invited" ? "Resend" : "Send new link"}
                  </LoadingButton>
                  {(v.status === "invited" || v.status === "active") && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRevoking(v)}>
                      Revoke
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )}
        />
      </RefreshableListCard>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a Volunteer</DialogTitle>
            <DialogDescription>
              They'll get an email from your ORNS address with a one-time sign-in link. It works once the auction is Live, on one device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</FormField>
            <FormField label="Email">{(id) => <Input id={id} type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />}</FormField>
            {/@orns\.org$/i.test(email.trim()) && (
              <p className="text-sm text-amber-700">@orns.org staff sign in with their own account - give them a role under Staff Roles instead.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <LoadingButton loading={state.busyId === "invite"} disabled={!name.trim() || !emailValid} onClick={sendInvite} icon={<Send className="w-4 h-4" />}>
              Send Invitation
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke volunteer access?"
        description={revoking ? `${revoking.name} (${revoking.email}) will be signed out within 30 seconds, and their link will stop working.` : ""}
        confirmLabel="Revoke"
        variant="destructive"
        isLoading={!!revoking && state.busyId === revoking.id}
        onConfirm={async () => {
          if (revoking && (await state.revoke(revoking))) setRevoking(null);
        }}
      />
    </div>
  );
}
