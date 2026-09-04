/**
 * @vitest-environment jsdom
 *
 * useBundling is only ever consumed through AuctionItemsTab.tsx, and
 * AuctionItemsTab.test.tsx/BundlingDialog.test.tsx both mock it wholesale
 * via vi.mock() - so none of its real logic has ever run under the test
 * suite. Tested directly via renderHook, matching the pattern already
 * established for useBiddersData.ts/useAuctionStatusData.ts.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useBundling } from "./useBundling";
import { AuctionItem } from "@/types";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

function makeItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "801", rowIndex: 2, category: "Food", name: "Pizza Night", description: "A pizza dinner",
    value: "$50.00", openingBid: "$22.50", minRaise: "$5.00", donor: "Joe's Pizza",
    itemType: "Certificate", status: "Active", bundleId: "", bundledDateTime: "",
    ...overrides,
  } as AuctionItem;
}

const onBundleComplete = vi.fn();

describe("useBundling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("openBundlingModal", () => {
    it("refuses to open with fewer than 2 items selected", () => {
      const items = [makeItem()];
      const { result } = renderHook(() => useBundling(items, { 2: true }, "ss-id", [], onBundleComplete));

      act(() => result.current.openBundlingModal());

      expect(toast.error).toHaveBeenCalledWith("Select at least 2 items to bundle");
      expect(result.current.isBundling).toBe(false);
    });

    it("merges description/donor and computes auto bids from the combined value of selected items", () => {
      const items = [
        makeItem({ rowIndex: 2, id: "801", name: "Pizza Night", description: "A pizza dinner", value: "$50.00", donor: "Joe's Pizza" }),
        makeItem({ rowIndex: 3, id: "803", name: "Sushi Dinner", description: "A sushi dinner", value: "$150.00", donor: "Sushi Place" }),
      ];
      const { result } = renderHook(() => useBundling(items, { 2: true, 3: true }, "ss-id", [], onBundleComplete));

      act(() => result.current.openBundlingModal());

      expect(result.current.isBundling).toBe(true);
      expect(result.current.bundleDetails.value).toBe("$200.00");
      expect(result.current.bundleDetails.donor).toBe("Joe's Pizza, Sushi Place");
      expect(result.current.bundleDetails.description).toContain("Pizza Night");
      expect(result.current.bundleDetails.description).toContain("Sushi Dinner");
      // 45% opening bid, hardcoded-ladder raise for $200 (150-300 tier -> $10)
      expect(result.current.bundleDetails.openingBid).toBe("$90.00");
      expect(result.current.bundleDetails.minRaise).toBe("$10.00");
    });
  });

  describe("executeBundle", () => {
    function setupBundlingModal(overrides: Partial<AuctionItem> = {}) {
      const items = [
        makeItem({ rowIndex: 2, id: "801" }),
        makeItem({ rowIndex: 3, id: "803", ...overrides }),
      ];
      const hook = renderHook(() => useBundling(items, { 2: true, 3: true }, "ss-id", [], onBundleComplete));
      act(() => hook.result.current.openBundlingModal());
      act(() => hook.result.current.setBundleDetails(prev => ({ ...prev, name: "Test Bundle" })));
      return hook;
    }

    it("stays in the executing state until the request actually resolves (no double-submit window)", async () => {
      let resolveFetch: (v: any) => void;
      mockedFetchWithRetry.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
      const { result } = setupBundlingModal();

      let executePromise: Promise<void>;
      act(() => {
        executePromise = result.current.executeBundle();
      });

      // The fetch hasn't resolved yet - the button must still be disabled.
      expect(result.current.isExecutingBundle).toBe(true);

      await act(async () => {
        resolveFetch!({ ok: true, status: 200, json: async () => ({ ui_history_log: { bundle_item_name: "Test Bundle", bundle_token: "BND-1" } }) });
        await executePromise;
      });

      expect(result.current.isExecutingBundle).toBe(false);
    });

    it("happy path: shows success toast, resets bundle state, and calls onBundleComplete", async () => {
      mockedFetchWithRetry.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ui_history_log: { bundle_item_name: "Test Bundle", bundle_token: "BND-123" } }),
      } as Response);
      const { result } = setupBundlingModal();

      await act(async () => {
        await result.current.executeBundle();
      });

      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Test Bundle"));
      expect(result.current.isBundling).toBe(false);
      expect(onBundleComplete).toHaveBeenCalled();
    });

    it("shows a real error message (not a crash) when the response isn't ok and has no error field", async () => {
      mockedFetchWithRetry.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);
      const { result } = setupBundlingModal();

      await act(async () => {
        await result.current.executeBundle();
      });

      expect(toast.error).toHaveBeenCalledWith("Failed to bundle items (status 500)");
      expect(result.current.isExecutingBundle).toBe(false);
      // Bundle stays open so the user's entered details aren't lost.
      expect(result.current.isBundling).toBe(true);
    });

    it("requires a name and category before submitting", async () => {
      const items = [makeItem({ rowIndex: 2 }), makeItem({ rowIndex: 3, id: "803" })];
      const { result } = renderHook(() => useBundling(items, { 2: true, 3: true }, "ss-id", [], onBundleComplete));

      await act(async () => {
        await result.current.executeBundle();
      });

      expect(toast.error).toHaveBeenCalledWith("Bundle Name and Category are required");
      expect(fetchWithRetry).not.toHaveBeenCalled();
    });
  });

  describe("handleRestoreBundle", () => {
    it("happy path: restores and calls onBundleComplete", async () => {
      mockedFetchWithRetry.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ui_history_log: { original_item_names: ["Pizza Night", "Sushi Dinner"] } }),
      } as Response);
      const { result } = renderHook(() => useBundling([], {}, "ss-id", [], onBundleComplete));

      await act(async () => {
        await result.current.handleRestoreBundle("BND-123");
      });

      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Pizza Night"));
      expect(onBundleComplete).toHaveBeenCalled();
    });

    it("shows a real error message (not a crash) when the response isn't ok and has no error field", async () => {
      mockedFetchWithRetry.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response);
      const { result } = renderHook(() => useBundling([], {}, "ss-id", [], onBundleComplete));

      await act(async () => {
        await result.current.handleRestoreBundle("BND-missing");
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Failed to restore bundle"));
      });
      expect(onBundleComplete).not.toHaveBeenCalled();
    });

    it("does nothing when no bundle token is provided", async () => {
      const { result } = renderHook(() => useBundling([], {}, "ss-id", [], onBundleComplete));

      await act(async () => {
        await result.current.handleRestoreBundle("");
      });

      expect(fetchWithRetry).not.toHaveBeenCalled();
    });
  });
});
