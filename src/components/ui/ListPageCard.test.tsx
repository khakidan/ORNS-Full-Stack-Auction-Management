/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ListPageCard } from "./ListPageCard";

describe("ListPageCard", () => {
  it("renders CardContent with p-0, merging in any extra contentClassName", () => {
    render(
      <ListPageCard title="Title" description="Description" contentClassName="flex-1 overflow-auto">
        <div>content</div>
      </ListPageCard>
    );

    const content = screen.getByText("content").parentElement;
    const classes = content?.className.split(/\s+/) ?? [];
    expect(classes).toContain("p-0");
    expect(classes).toContain("flex-1");
    expect(classes).toContain("overflow-auto");
  });

  it("renders the optional icon inline with the title, and omits it entirely when not given", () => {
    const { rerender } = render(
      <ListPageCard icon={<span data-testid="icon" />} title="Title" description="Description">
        <div>content</div>
      </ListPageCard>
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();

    rerender(
      <ListPageCard title="Title" description="Description">
        <div>content</div>
      </ListPageCard>
    );
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
  });

  it("merges an extra className onto the root Card", () => {
    render(
      <ListPageCard title="Title" description="Description" className="flex flex-col min-h-0">
        <div>content</div>
      </ListPageCard>
    );

    const heading = screen.getByText("Title");
    // heading (CardTitle) -> CardHeader -> Card
    const card = heading.parentElement?.parentElement;
    const classes = card?.className.split(/\s+/) ?? [];
    expect(classes).toContain("min-h-0");
  });
});
