import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorTextFrom, fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { postJson } from "@/services/apiClient";

export type VolunteerStatus = "invited" | "active" | "deactivated" | "revoked";

export interface Volunteer {
  id: string;
  email: string;
  name: string;
  status: VolunteerStatus;
  invitedBy: string;
  invitedAt: string;
  redeemedAt?: string;
  lastSeenAt?: string;
  deactivatedReason?: string;
}

export interface VolunteerAccount {
  connected: boolean;
  email: string;
  connectedBy?: string;
  connectedAt?: string;
}

/** Settings > Users > Volunteers: the shared account's status, the invite list, and invite / resend / revoke. */
export function useVolunteersAdminState() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [account, setAccount] = useState<VolunteerAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchVolunteers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/volunteers`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(data, "Couldn't load volunteers"));
      setVolunteers(data.volunteers || []);
      setAccount(data.account || null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVolunteers();
  }, [fetchVolunteers]);

  /** Runs one action, toasts the outcome, reloads the list. Resolves whether it worked. */
  const run = async (busy: string, path: string, body: unknown, success: string): Promise<boolean> => {
    setBusyId(busy);
    try {
      await postJson(path, body, "That didn't work");
      toast.success(success);
      await fetchVolunteers();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return {
    volunteers,
    account,
    loading,
    busyId,
    fetchVolunteers,
    invite: (name: string, email: string) => run("invite", "/api/volunteers", { name, email }, `Sent ${email} a sign-in link`),
    resend: (v: Volunteer) => run(v.id, `/api/volunteers/${encodeURIComponent(v.id)}/resend`, {}, `Sent ${v.email} a new link`),
    revoke: (v: Volunteer) => run(v.id, `/api/volunteers/${encodeURIComponent(v.id)}/revoke`, {}, `Ended ${v.email}'s access`),
    clearEnded: () => run("clear", "/api/volunteers/clear-ended", {}, "Cleared ended volunteers from the list"),
  };
}
