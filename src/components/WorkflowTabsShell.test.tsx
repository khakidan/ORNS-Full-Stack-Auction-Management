/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { WorkflowTabsShell } from "./WorkflowTabsShell";

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
        isAuctionClosed={false}
        defaultTab="one"
        tabs={tabs}
      />
    );

    expect(screen.getByText("Auction Items Management")).toBeInTheDocument();
    expect(screen.getByText("The database for all auction items.")).toBeInTheDocument();
  });

  it("shows the Auction Closed badge only when isAuctionClosed", () => {
    const { rerender } = render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" isAuctionClosed={false} defaultTab="one" tabs={tabs} />
    );
    expect(screen.queryByText("Auction Closed")).not.toBeInTheDocument();

    rerender(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" isAuctionClosed={true} defaultTab="one" tabs={tabs} />
    );
    expect(screen.getByText("Auction Closed")).toBeInTheDocument();
  });

  it("shows the Open Spreadsheet button only when spreadsheetId is set", () => {
    const { rerender } = render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" isAuctionClosed={false} defaultTab="one" tabs={tabs} />
    );
    expect(screen.queryByText("Open Spreadsheet")).not.toBeInTheDocument();

    rerender(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="sheet-123" isAuctionClosed={false} defaultTab="one" tabs={tabs} />
    );
    expect(screen.getByText("Open Spreadsheet")).toBeInTheDocument();
  });

  it("defaults headerAlign to sm:items-end", () => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" isAuctionClosed={false} defaultTab="one" tabs={tabs} />
    );
    const header = screen.getByText("T").closest("div")?.parentElement;
    expect(header?.className).toContain("sm:items-end");
  });

  it("uses sm:items-center when headerAlign is 'center'", () => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" isAuctionClosed={false} defaultTab="one" tabs={tabs} headerAlign="center" />
    );
    const header = screen.getByText("T").closest("div")?.parentElement;
    expect(header?.className).toContain("sm:items-center");
    expect(header?.className).not.toContain("sm:items-end");
  });
});

describe("WorkflowTabsShell - tabs", () => {
  it("renders a trigger per tab and shows the defaultTab's content initially", () => {
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" isAuctionClosed={false} defaultTab="two" tabs={tabs} />
    );

    expect(screen.getByRole("tab", { name: "Tab One" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tab Two" })).toBeInTheDocument();
    expect(screen.getByText("Content Two")).toBeVisible();
  });

  it("switches content when a different tab is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkflowTabsShell title="T" description="D" spreadsheetId="" isAuctionClosed={false} defaultTab="one" tabs={tabs} />
    );

    await user.click(screen.getByRole("tab", { name: "Tab Two" }));

    expect(screen.getByText("Content Two")).toBeVisible();
  });
});
