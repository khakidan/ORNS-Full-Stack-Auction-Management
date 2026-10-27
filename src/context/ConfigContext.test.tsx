/**
 * @vitest-environment jsdom
 *
 * ConfigContext reads the shared Config from the server (GET /api/config)
 * once someone is signed in - any role, no separate sign-in - and saves it
 * back through POST /api/config.
 */
import React from "react";
import "@testing-library/jest-dom";
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigProvider, useConfig } from "./ConfigContext";
import { Config } from "@/types";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: () => "",
  errorTextFrom: (data: any, fallback: string) => data?.error || fallback,
}));
vi.mock("@/services/apiClient", () => ({ postJson: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let mockAuthenticated: boolean | null = true;
vi.mock("./AuthContext", () => ({ useAuth: () => ({ authenticated: mockAuthenticated }) }));

import { fetchWithRetry } from "@/services/google-api";
import { postJson } from "@/services/apiClient";
import { toast } from "sonner";

const FAKE_CONFIG: Config = {
  auctionItemsSpreadsheetId: "items-id",
  auctionTicketsSpreadsheetId: "tickets-id",
  bidManagementSpreadsheetId: "bm-id",
  bidderNumbersSheet: "Bidder-Numbers",
  bidManagementSheet: "Bid-Management",
  receiptFolderId: "receipt-folder",
  forPrintFolderId: "print-folder",
  ornsLogoId: "logo-id",
  ticketPrice: "35",
  auctionItemsScriptId: "items-script",
  auctionTicketsScriptId: "tickets-script",
  bidManagementScriptId: "bm-script",
  bugReportsSpreadsheetId: "bug-reports-id",
  bugReportsFolderId: "bug-reports-folder",
  paypalIsSandbox: false,
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider>{children}</ConfigProvider>;

describe("ConfigContext", () => {
  beforeEach(() => {
    mockAuthenticated = true;
    vi.mocked(fetchWithRetry).mockReset().mockResolvedValue(json(FAKE_CONFIG));
    vi.mocked(postJson).mockReset();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  it("loads the shared Config from the server once signed in, whatever the role", async () => {
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchWithRetry).toHaveBeenCalledWith("/api/config", { credentials: "include" });
    expect(result.current.config).toEqual(FAKE_CONFIG);
  });

  it("doesn't ask the server while signed out", async () => {
    mockAuthenticated = false;
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchWithRetry).not.toHaveBeenCalled();
    expect(result.current.config.bidManagementSpreadsheetId).toBe("");
  });

  it("keeps only Config's own fields, defaulting any the server leaves out", async () => {
    const { bidderNumbersSheet: _omit, ...rest } = FAKE_CONFIG;
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ ...rest, auctionItemsSheet: "stale" }));
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual({ ...FAKE_CONFIG, bidderNumbersSheet: "Bidder-Numbers" });
    expect(result.current.config).not.toHaveProperty("auctionItemsSheet");
  });

  it("says so when the settings can't be loaded, but a live refresh fails quietly", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ error: "nope" }, 500));
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

    await act(() => result.current.reloadConfig());
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("saves through the server and uses what it saved", async () => {
    vi.mocked(postJson).mockResolvedValue({ ...FAKE_CONFIG, ticketPrice: "40" });
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.saveConfig({ ...FAKE_CONFIG, ticketPrice: "40" }));

    expect(postJson).toHaveBeenCalledWith("/api/config", { ...FAKE_CONFIG, ticketPrice: "40" }, expect.any(String));
    expect(result.current.config.ticketPrice).toBe("40");
    expect(toast.success).toHaveBeenCalled();
  });

  it("shows the server's refusal and rethrows, leaving the Config as it was", async () => {
    vi.mocked(postJson).mockRejectedValue(new Error("You don't have permission to do that."));
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(act(() => result.current.saveConfig({ ...FAKE_CONFIG, ticketPrice: "1" }))).rejects.toThrow("permission");
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("permission"));
    expect(result.current.config.ticketPrice).toBe("35");
  });
});
