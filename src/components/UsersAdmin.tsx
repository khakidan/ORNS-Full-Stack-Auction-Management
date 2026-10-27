import { useState } from "react";
import { format } from "date-fns";
import { Lock, UserCog } from "lucide-react";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { DataTableWrapper } from "@/components/DataTableWrapper";
import { RefreshableListCard } from "@/components/RefreshableListCard";
import { useAuth } from "@/context/AuthContext";
import { useUsersAdminState, StaffUser } from "@/hooks/useUsersAdminState";
import { ROLE_LABELS, Role } from "@/lib/permissions";

const ROLES: Role[] = ["full_admin", "admin", "user"];

function RoleSelect({ value, disabled, onChange, id }: { value: Role; disabled?: boolean; onChange: (role: Role) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as Role)} disabled={disabled}>
      <SelectTrigger id={id} className="h-10 w-48" aria-label="Role">
        <SelectValue>{(v: string) => ROLE_LABELS[v as Role] ?? v}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * Settings > Users: who can do what. Every @orns.org address is a User when
 * they sign in; this is where specific addresses become Administrators or
 * Full Administrators. FULL_ADMIN_EMAILS addresses (set on the server) and
 * your own role can't be changed here.
 */
export default function UsersAdmin() {
  const { user: me } = useAuth();
  const { users, loading, savingEmail, fetchUsers, setRole } = useUsersAdminState();
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("admin");

  const addValid = /^[^\s@]+@orns\.org$/i.test(newEmail.trim());
  const handleAdd = async () => {
    if (await setRole(newEmail.trim().toLowerCase(), newRole)) setNewEmail("");
  };

  const isLocked = (u: StaffUser) => u.bootstrap || u.email === me?.email;

  return (
    <div className="space-y-6">
      <RefreshableListCard
        icon={<UserCog className="w-5 h-5 text-primary" />}
        title="Staff Roles"
        description="Every other @orns.org address is a User when they sign in. Administrators can do everything except use this Settings page; Users also can't set up, start or close the auction, or delete attendees."
        loading={loading}
        onRefresh={fetchUsers}
      >
        {/* Labels on one row and the three controls on the next, so the
            input, dropdown and button always line up (a stacked
            label + control column let the Select's hidden form input push
            its column out of line). Stacks on phones. */}
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,24rem)_auto_auto] sm:justify-start gap-x-3 gap-y-2 mb-6 items-center">
          <Label htmlFor="newStaffEmail">Give a role to</Label>
          <Label htmlFor="newStaffRole" className="hidden sm:block">Role</Label>
          <span className="hidden sm:block" />
          <Input id="newStaffEmail" className="h-10" placeholder="name@orns.org" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <RoleSelect id="newStaffRole" value={newRole} onChange={setNewRole} />
          <LoadingButton className="h-10" loading={savingEmail === newEmail.trim().toLowerCase()} disabled={!addValid} onClick={handleAdd}>
            Save Role
          </LoadingButton>
        </div>

        <DataTableWrapper<StaffUser>
          items={users}
          loading={loading}
          columnCount={3}
          header={
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className="w-56">Role</TableHead>
              <TableHead className="w-48">Last sign-in</TableHead>
            </TableRow>
          }
          emptyMessage="No users found."
          renderRow={(u) => (
            <TableRow key={u.email} data-testid={`staff-row-${u.email}`}>
              <TableCell className="font-medium">{u.email}</TableCell>
              <TableCell>
                {isLocked(u) ? (
                  <span className="flex items-center gap-1.5 text-sm" title={u.bootstrap ? "Set on the server (FULL_ADMIN_EMAILS)" : "You can't change your own role"}>
                    {ROLE_LABELS[u.role]}
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  </span>
                ) : (
                  <RoleSelect value={u.role} disabled={savingEmail === u.email} onChange={(role) => setRole(u.email, role)} />
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {u.lastLoginAt ? format(new Date(u.lastLoginAt), "MMM d, yyyy h:mm a") : "Never"}
              </TableCell>
            </TableRow>
          )}
        />
      </RefreshableListCard>
    </div>
  );
}
