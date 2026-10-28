import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorTextFrom, fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { postJson, postJsonOnce } from "@/services/apiClient";
import { useAuction } from "@/context/AuctionContext";

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
  /** What Undo will write, worked out by the server from the row's Undo Data. */
  undoPreview: string;
}

export const ALL = "all";

/** Actions loaded at a time (the server's PAGE_SIZE); a live refresh reloads up to MAX_RELOAD. */
const PAGE_SIZE = 300;
const MAX_RELOAD = 1000;

/** Settings > Action History: loads the log, filters it, creates the spreadsheet, and runs Undo. */
export function useActionHistoryState() {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  /** How many actions the log holds in all, and whether older ones than those loaded remain. */
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedCount = useRef(0);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [enablingTracking, setEnablingTracking] = useState(false);
  /** Whether direct edits in the Items and Tickets spreadsheets are recorded; null until known (or if the scripts can't say). */
  const [trackingOn, setTrackingOn] = useState<boolean | null>(null);
  /** Who turned edit tracking on, and when - their on-edit trigger does the recording. */
  const [trackingTurnedOn, setTrackingTurnedOn] = useState<{ by: string; at: string } | null>(null);
  const [search, setSearch] = useState("");
  const [area, setArea] = useState(ALL);
  const [who, setWho] = useState(ALL);
  const [source, setSource] = useState(ALL);

  const { dataVersion, lastChangedKeys, checkForChanges } = useAuction();

  const getPage = async (query: string) => {
    const res = await fetchWithRetry(`${getBaseUrl()}/api/action-history?${query}`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorTextFrom(data, "Couldn't load the Action History"));
    return data;
  };

  /**
   * Loads the newest actions (ROADMAP A15 - the log comes a page at a
   * time). `silent`: a live refresh (someone acted elsewhere) - no loading
   * state, and as many as are already showing, so older pages stay.
   */
  const fetchActions = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const limit = options?.silent ? Math.min(Math.max(loadedCount.current, PAGE_SIZE), MAX_RELOAD) : PAGE_SIZE;
      const data = await getPage(`limit=${limit}`);
      setConfigured(!!data.spreadsheetId);
      setSpreadsheetUrl(data.url || "");
      const loaded: ActionRecord[] = data.actions || [];
      loadedCount.current = loaded.length;
      setActions(loaded);
      setTotal(data.total ?? loaded.length);
      setHasMore(!!data.more);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Adds the next page of older actions below those showing. */
  const loadMore = async () => {
    const last = actions[actions.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const data = await getPage(`limit=${PAGE_SIZE}&before=${encodeURIComponent(last.id)}`);
      // The last action showing was deleted from the sheet by hand: start over.
      if (data.restart) return await fetchActions();
      const older: ActionRecord[] = data.actions || [];
      loadedCount.current += older.length;
      setActions((prev) => [...prev, ...older]);
      setTotal(data.total ?? total);
      setHasMore(!!data.more);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const fetchTrackingStatus = useCallback(async () => {
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/action-history/edit-tracking`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setTrackingOn(res.ok && typeof data.on === "boolean" ? data.on : null);
      setTrackingTurnedOn(res.ok && data.turnedOn ? data.turnedOn : null);
    } catch {
      setTrackingOn(null);
      setTrackingTurnedOn(null);
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  useEffect(() => {
    if (configured) fetchTrackingStatus();
  }, [configured, fetchTrackingStatus]);

  // Live refresh: new actions by anyone appear without reloading.
  useEffect(() => {
    if (!dataVersion || !lastChangedKeys) return;
    if (lastChangedKeys.includes("*") || lastChangedKeys.includes("action-history")) fetchActions({ silent: true });
  }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const createSpreadsheet = async () => {
    setCreating(true);
    try {
      await postJsonOnce("/api/action-history/create", {}, "Couldn't create the Action History spreadsheet");
      toast.success("Action History spreadsheet created - actions are recorded from now on.");
      await fetchActions();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  /**
   * Turns recording of edits made directly in the Items and Tickets
   * spreadsheets on or off (on installs the on-edit trigger in each).
   */
  const setEditTracking = async (enabled: boolean, itemsSpreadsheetId: string, ticketsSpreadsheetId: string) => {
    const verb = enabled ? "on" : "off";
    setEnablingTracking(true);
    try {
      const data = await postJson<{ success: boolean; results: { name: string; success: boolean; error?: string }[] }>(
        "/api/action-history/edit-tracking",
        { enabled, itemsSpreadsheetId, ticketsSpreadsheetId },
        `Couldn't turn ${verb} edit tracking`
      );
      const failed = data.results.filter((r) => !r.success);
      if (failed.length) toast.error(`Edit tracking couldn't be turned ${verb} for ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}`, { duration: 15000 });
      else toast.success(enabled ? "Edits made directly in the Items and Tickets spreadsheets are now recorded." : "Edits made directly in the Items and Tickets spreadsheets are no longer recorded.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      await fetchTrackingStatus();
      setEnablingTracking(false);
    }
  };

  /** Resolves whether the undo went through (a refusal is toasted, with the server's reason). */
  const undo = async (action: ActionRecord): Promise<boolean> => {
    setUndoingId(action.id);
    try {
      await postJsonOnce(`/api/action-history/${encodeURIComponent(action.id)}/undo`, {}, "Couldn't undo that");
      toast.success(`Undid "${action.summary}"`);
      await fetchActions();
      // Reload whatever the Undo changed (bidders, items, tickets...) on
      // this screen now, rather than on the next live-refresh tick.
      checkForChanges?.();
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
    totalCount: total,
    loadedCount: actions.length,
    hasMore,
    loadingMore,
    loadMore,
    configured,
    spreadsheetUrl,
    loading,
    creating,
    undoingId,
    fetchActions,
    createSpreadsheet,
    undo,
    enablingTracking,
    trackingOn,
    trackingTurnedOn,
    setEditTracking,
    filters: { search, setSearch, area, setArea, who, setWho, source, setSource, options },
  };
}
