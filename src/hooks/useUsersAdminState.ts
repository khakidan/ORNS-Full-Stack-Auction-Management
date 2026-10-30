import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorTextFrom, fetchWithRetry, getBaseUrl } from "@/services/google-api";
import type { Role } from "@/lib/permissions";
import type { SetRoleRequest } from "../../shared/apiTypes";

export interface StaffUser {
  email: string;
  role: Role;
  /** Set on the server (FULL_ADMIN_EMAILS) - can't be changed in the app. */
  bootstrap: boolean;
  assignedBy?: string;
  assignedAt?: string;
  lastLoginAt?: string;
}

/** The Users tab's staff list: loads everyone who has signed in or has a role, and changes roles. */
export function useUsersAdminState() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/users`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(data, "Couldn't load users"));
      setUsers(data.users || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  /** Gives `email` a role ("user" removes an admin role). Resolves whether it was saved. */
  const setRole = async (email: string, role: Role): Promise<boolean> => {
    setSavingEmail(email);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/users/${encodeURIComponent(email)}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role } satisfies SetRoleRequest),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(data, "Couldn't change the role"));
      toast.success(`Updated ${email}`);
      await fetchUsers();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setSavingEmail(null);
    }
  };

  return { users, loading, savingEmail, fetchUsers, setRole };
}
