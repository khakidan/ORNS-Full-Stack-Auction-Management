/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AppsScriptVersionsCard from "./AppsScriptVersionsCard";

vi.mock("@/services/google-api", () => ({ getAppsScriptVersions: vi.fn() }));
import { getAppsScriptVersions } from "@/services/google-api";

describe("AppsScriptVersionsCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks only when asked, not on load", () => {
    render(<AppsScriptVersionsCard />);
    expect(getAppsScriptVersions).not.toHaveBeenCalled();
    expect(screen.getByText("Check Script Versions")).toBeInTheDocument();
  });

  it("shows each script's result", async () => {
    vi.mocked(getAppsScriptVersions).mockResolvedValue([
      { label: "Bid Management", expected: "aaa", live: "aaa", status: "ok" },
      { label: "Item Entry", expected: "bbb", live: "old", status: "outdated" },
      { label: "Tickets", expected: "ccc", live: null, status: "error", error: "The caller does not have permission" },
    ]);
    render(<AppsScriptVersionsCard />);

    await userEvent.click(screen.getByText("Check Script Versions"));

    await waitFor(() => expect(screen.getByText("Up to date")).toBeInTheDocument());
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    expect(screen.getByText("Live old, expected bbb")).toBeInTheDocument();
    expect(screen.getByText("Couldn't check")).toBeInTheDocument();
    expect(screen.getByText("The caller does not have permission")).toBeInTheDocument();
  });

  it("shows the error when the check itself fails", async () => {
    vi.mocked(getAppsScriptVersions).mockRejectedValue(new Error("Failed to check the Apps Script versions"));
    render(<AppsScriptVersionsCard />);

    await userEvent.click(screen.getByText("Check Script Versions"));

    await waitFor(() => expect(screen.getByText("Failed to check the Apps Script versions")).toBeInTheDocument());
  });
});
