/**
 * @vitest-environment jsdom
 *
 * Live refresh (ROADMAP A16): when the change feed says a spreadsheet or
 * the Config changed, AuctionContext reloads just that data - Bid
 * Management -> bidders (then winners), auction status and setup status;
 * Items -> items; Tickets -> attendees; "config" -> the Config - quietly,
 * and a server restart ("reset") reloads everything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

const fetchBidders = vi.fn(async () => {});
const fetchWinners = vi.fn(async () => {});
const refreshItems = vi.fn(async () => {});
const fetchAttendees = vi.fn(async () => {});
const fetchAuctionStatus = vi.fn(async () => {});
const fetchSetupStatus = vi.fn(async () => {});
const reloadConfig = vi.fn(async () => {});
let onRemoteChange: (changed: Set<string>, reset: boolean) => Promise<void>;
let onSignedOut: (() => void) | undefined;
const checkAuth = vi.fn(async () => {});

vi.mock("./ConfigContext", () => ({
  useConfig: () => ({
    config: { bidManagementSpreadsheetId: "bm", auctionItemsSpreadsheetId: "it", auctionTicketsSpreadsheetId: "tk", bidderNumbersSheet: "Bidder-Numbers", bidManagementSheet: "Bid-Management" },
    reloadConfig,
  }),
}));
// Signed out, so the initial full load doesn't run and only live-refresh reloads are counted.
vi.mock("./AuthContext", () => ({ useAuth: () => ({ authenticated: false, user: null, checkAuth }) }));
vi.mock("@/hooks/useBiddersData", () => ({ useBiddersData: () => ({ bidders: [], fetchBidders, setLoading: vi.fn() }) }));
vi.mock("@/hooks/useAuctionItems", () => ({ useAuctionItems: () => ({ items: [], refresh: refreshItems }) }));
vi.mock("@/hooks/useAttendeesData", () => ({ useAttendeesData: () => ({ attendees: [], fetchAttendees }) }));
vi.mock("@/hooks/useWinnersData", () => ({ useWinnersData: () => ({ fetchWinners }) }));
vi.mock("@/hooks/useAuctionStatusData", () => ({
  useAuctionStatusData: () => ({ fetchAuctionStatus, fetchSetupStatus, requestCloseAuction: vi.fn(), requestGoLive: vi.fn() }),
}));
vi.mock("@/hooks/useChangeFeed", () => ({
  useChangeFeed: (_enabled: boolean, handler: typeof onRemoteChange, _me?: string, signedOut?: () => void) => {
    onRemoteChange = handler;
    onSignedOut = signedOut;
    return vi.fn();
  },
}));
vi.mock("@/services/apiClient", () => ({ postJson: vi.fn() }));

import { AuctionProvider, useAuction } from "./AuctionContext";

let seen: { dataVersion: number; lastChangedKeys: string[] } | null = null;
function Probe() {
  const { dataVersion, lastChangedKeys } = useAuction();
  seen = { dataVersion, lastChangedKeys };
  return null;
}

const reloaded = () => ({
  bidders: fetchBidders.mock.calls.length,
  winners: fetchWinners.mock.calls.length,
  items: refreshItems.mock.calls.length,
  attendees: fetchAttendees.mock.calls.length,
  status: fetchAuctionStatus.mock.calls.length,
  setup: fetchSetupStatus.mock.calls.length,
  config: reloadConfig.mock.calls.length,
});

beforeEach(() => {
  vi.clearAllMocks();
  render(<AuctionProvider><Probe /></AuctionProvider>);
});

describe("AuctionContext live refresh", () => {
  it("a Bid Management change reloads bidders (quietly, then winners), auction status and setup status - nothing else", async () => {
    await act(() => onRemoteChange(new Set(["bm"]), false));
    expect(reloaded()).toEqual({ bidders: 1, winners: 1, items: 0, attendees: 0, status: 1, setup: 1, config: 0 });
    expect(fetchBidders).toHaveBeenCalledWith({ silent: true });
    expect(seen).toEqual({ dataVersion: 1, lastChangedKeys: ["bm"] });
  });

  it.each([
    ["the Items spreadsheet", "it", { items: 1 }],
    ["the Tickets spreadsheet", "tk", { attendees: 1 }],
    ["the Config", "config", { config: 1 }],
  ])("a change to %s reloads only that", async (_label, key, expected) => {
    await act(() => onRemoteChange(new Set([key]), false));
    expect(reloaded()).toEqual({ bidders: 0, winners: 0, items: 0, attendees: 0, status: 0, setup: 0, config: 0, ...expected });
  });

  it("a spreadsheet this page doesn't show reloads nothing, but still bumps the version for other screens", async () => {
    await act(() => onRemoteChange(new Set(["someone-elses-sheet"]), false));
    expect(Object.values(reloaded()).every((n) => n === 0)).toBe(true);
    expect(seen?.dataVersion).toBe(1);
  });

  it("a server restart (reset) reloads everything", async () => {
    await act(() => onRemoteChange(new Set(), true));
    expect(reloaded()).toEqual({ bidders: 1, winners: 1, items: 1, attendees: 1, status: 1, setup: 1, config: 1 });
    expect(seen?.lastChangedKeys).toEqual(["*"]);
  });
});

describe("AuctionContext sign-in ending", () => {
  it("re-checks the sign-in when the change feed hears it has ended (a 401), so the sign-in screen shows", () => {
    onSignedOut?.();
    expect(checkAuth).toHaveBeenCalledTimes(1);
  });
});
