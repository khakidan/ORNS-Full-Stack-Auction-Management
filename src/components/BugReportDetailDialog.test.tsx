// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BugReportDetailDialog } from "./BugReportDetailDialog";
import { BugReportListItem } from "@/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const BASE_REPORT: BugReportListItem = {
  reportId: "report-1",
  timestamp: "2026-09-04T05:07:13.370Z",
  status: "Open",
  type: "UI Issue",
  title: "Clipping of Circular Checked In State",
  description: "The visual representation is getting clipped.",
  route: "/BidManagement (workflow: bids, tab: dashboard)",
  appState: "Bidders: 16",
  browserInfo: "User-Agent: test",
  consoleActivity: "(none captured)",
  screenshotLink: "https://drive.google.com/file/d/abc/view",
};

describe("BugReportDetailDialog", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing (no dialog content) when report is null", () => {
    render(<BugReportDetailDialog report={null} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Copy as Markdown")).not.toBeInTheDocument();
  });

  it("renders all report fields when a report is given", () => {
    render(<BugReportDetailDialog report={BASE_REPORT} onOpenChange={vi.fn()} />);

    expect(screen.getByText("Clipping of Circular Checked In State")).toBeInTheDocument();
    expect(screen.getByText("UI Issue")).toBeInTheDocument();
    expect(screen.getByText("The visual representation is getting clipped.")).toBeInTheDocument();
    expect(screen.getByText("Bidders: 16")).toBeInTheDocument();
    expect(screen.getByText("User-Agent: test")).toBeInTheDocument();
    expect(screen.getByText("(none captured)")).toBeInTheDocument();
    expect(screen.getByText("Open Screenshot")).toBeInTheDocument();
  });

  it("does not render a screenshot button when the report has no screenshot link", () => {
    render(<BugReportDetailDialog report={{ ...BASE_REPORT, screenshotLink: "" }} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Open Screenshot")).not.toBeInTheDocument();
  });

  it("copies the report formatted as Markdown to the clipboard and shows a confirmation", async () => {
    render(<BugReportDetailDialog report={BASE_REPORT} onOpenChange={vi.fn()} />);

    await userEvent.click(screen.getByText("Copy as Markdown"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copiedText = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(copiedText).toContain("# Clipping of Circular Checked In State");
    expect(copiedText).toContain("**Type:** UI Issue");
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });
});
