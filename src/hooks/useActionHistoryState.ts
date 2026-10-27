import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { errorTextFrom, fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { postJson } from "@/services/apiClient";

/** One row of the Action History spreadsheet, as GET /api/action-history returns it. */
export interface ActionRecord {
  id: string;
  timestamp: string;
  who: string;
  role: string;
  source: string;
  area: string;
  action: string;
  target: string;
  summary: string;
  before: string;
  after: string;
  location: string;
  /** Blank, "Undone by ...", or "Can't be undone: ...". */
  undo: string;
  undoOf: string;
  undoable: boolean;
}

export const ALL = "all";

/** Settings > Action History: loads the log, filters it, creates the spreadsheet, and runs Undo. */
export function useActionHistoryState() {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [enablingTracking, setEnablingTracking] = useState(false);
  const [search, setSearch] = useState("");
  const [area, setArea] = useState(ALL);
  const [who, setWho] = useState(ALL);
  const [source, setSource] = useState(ALL);

  const fetchActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/action-history`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(data, "Couldn't load the Action History"));
      setConfigured(!!data.spreadsheetId);
      setSpreadsheetUrl(data.url || "");
      setActions(data.actions || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const createSpreadsheet = async () => {
    setCreating(true);
    try {
      await postJson("/api/action-history/create", {}, "Couldn't create the Action History spreadsheet");
      toast.success("Action History spreadsheet created - actions are recorded from now on.");
      await fetchActions();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  /** Installs the on-edit trigger in the Items and Tickets spreadsheets, so edits made there directly are recorded too. */
  const enableEditTracking = async (itemsSpreadsheetId: string, ticketsSpreadsheetId: string) => {
    setEnablingTracking(true);
    try {
      const data = await postJson<{ success: boolean; results: { name: string; success: boolean; error?: string }[] }>(
        "/api/action-history/edit-tracking",
        { itemsSpreadsheetId, ticketsSpreadsheetId },
        "Couldn't turn on edit tracking"
      );
      const failed = data.results.filter((r) => !r.success);
      if (failed.length) toast.error(`Edit tracking couldn't be turned on for ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}`, { duration: 15000 });
      else toast.success("Edits made directly in the Items and Tickets spreadsheets are now recorded.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEnablingTracking(false);
    }
  };

  /** Resolves whether the undo went through (a refusal is toasted, with the server's reason). */
  const undo = async (action: ActionRecord): Promise<boolean> => {
    setUndoingId(action.id);
    try {
      await postJson(`/api/action-history/${encodeURIComponent(action.id)}/undo`, {}, "Couldn't undo that");
      toast.success(`Undid "${action.summary}"`);
      await fetchActions();
      return true;
    } catch (e: any) {
      toast.error(e.message, { duration: 10000 });
      return false;
    } finally {
      setUndoingId(null);
    }
  };

  const options = useMemo(() => ({
    areas: [...new Set(actions.map((a) => a.area).filter(Boolean))].sort(),
    people: [...new Set(actions.map((a) => a.who).filter(Boolean))].sort(),
    sources: [...new Set(actions.map((a) => a.source).filter(Boolean))].sort(),
  }), [actions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return actions.filter((a) =>
      (area === ALL || a.area === area) &&
      (who === ALL || a.who === who) &&
      (source === ALL || a.source === source) &&
      (!term || [a.summary, a.action, a.target, a.who, a.location].some((f) => f.toLowerCase().includes(term)))
    );
  }, [actions, search, area, who, source]);

  return {
    actions: filtered,
    totalCount: actions.length,
    configured,
    spreadsheetUrl,
    loading,
    creating,
    undoingId,
    fetchActions,
    createSpreadsheet,
    undo,
    enablingTracking,
    enableEditTracking,
    filters: { search, setSearch, area, setArea, who, setWho, source, setSource, options },
  };
}
