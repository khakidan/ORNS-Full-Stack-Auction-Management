/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AttentionDot, WorkflowTabsShell } from "./WorkflowTabsShell";

window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const tabs = [
  { value: "one", label: "Tab One", content: <div>Content One</div> },
  { value: "two", label: "Tab Two", content: <div>Content Two</div> },
];

describe("WorkflowTabsShell - header", () => {
  it("renders the title and description", () => {
    render(
      <WorkflowTabsShell
        title="Auction Items Management"
        description="The database for all auction items."
        spreadsheetId=""
        auctionState="prep"
        defaultTab="one"
        tabs={tabs}
      />
    );

    expect(screen.getByText("Auction Items Management")).toBeInTheDocument();
    expect(screen.getByText("The database for all auction items.")).toBeInTheDocument();
  });

  it.each([
    ["prep", "Prep Mode"],
    ["live", "Auction Live"],
    ["closed", "Auction Closed"],
  ] as const)("shows only the %s badge (%s)", (state, label) => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" auctionState={state} defaultTab="one" tabs={tabs} />
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    for (const other of ["Prep Mode", "Auction Live", "Auction Closed"].filter((l) => l !== label)) {
      expect(screen.queryByText(other)).not.toBeInTheDocument();
    }
  });

  it("shows the Open Spreadsheet button only when spreadsheetId is set", () => {
    const { rerender } = render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" auctionState="prep" defaultTab="one" tabs={tabs} />
    );
    expect(screen.queryByText("Open Spreadsheet")).not.toBeInTheDocument();

    rerender(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="sheet-123" auctionState="prep" defaultTab="one" tabs={tabs} />
    );
    expect(screen.getByText("Open Spreadsheet")).toBeInTheDocument();
  });

  it("defaults headerAlign to sm:items-end", () => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" auctionState="prep" defaultTab="one" tabs={tabs} />
    );
    const header = screen.getByText("T").closest("div")?.parentElement;
    expect(header?.className).toContain("sm:items-end");
  });

  it("uses sm:items-center when headerAlign is 'center'", () => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" auctionState="prep" defaultTab="one" tabs={tabs} headerAlign="center" />
    );
    const header = screen.getByText("T").closest("div")?.parentElement;
    expect(header?.className).toContain("sm:items-center");
    expect(header?.className).not.toContain("sm:items-end");
  });
});

describe("WorkflowTabsShell - tabs", () => {
  it("renders a trigger per tab and shows the defaultTab's content initially", () => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" auctionState="prep" defaultTab="two" tabs={tabs} />
    );

    expect(screen.getByRole("tab", { name: "Tab One" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tab Two" })).toBeInTheDocument();
    expect(screen.getByText("Content Two")).toBeVisible();
  });

  it("shows a tab's indicator after its label, named for screen readers", () => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" auctionState="prep" defaultTab="one"
        tabs={[tabs[0], { ...tabs[1], indicator: <AttentionDot label="Needs attention" /> }]} />
    );

    expect(screen.getByRole("tab", { name: "Tab Two Needs attention" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tab One" })).toBeInTheDocument();
  });

  it("switches content when a different tab is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" auctionState="prep" defaultTab="one" tabs={tabs} />
    );

    await user.click(screen.getByRole("tab", { name: "Tab Two" }));

    expect(screen.getByText("Content Two")).toBeVisible();
  });
});
