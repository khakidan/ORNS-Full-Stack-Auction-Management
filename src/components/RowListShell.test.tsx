/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RowListShell } from "./RowListShell";

describe("RowListShell - loading", () => {
  it("renders skeletonRowCount pulsing placeholder rows and no items/empty-state while loading", () => {
    const { container } = render(
      <RowListShell
        items={["a", "b"]}
        loading
        skeletonRowCount={4}
        emptyIcon={<span>icon</span>}
        emptyMessage="empty"
        renderRow={(item) => <div key={item}>{item}</div>}
      />
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });

  it("defaults skeletonRowCount to 6 when not provided", () => {
    const { container } = render(
      <RowListShell
        items={[]}
        loading
        emptyIcon={<span>icon</span>}
        emptyMessage="empty"
        renderRow={(item) => <div key={String(item)}>{String(item)}</div>}
      />
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(6);
  });
});

describe("RowListShell - empty state", () => {
  it("shows the empty icon and message when items is empty and not loading", () => {
    render(
      <RowListShell
        items={[]}
        emptyIcon={<span>empty-icon</span>}
        emptyMessage="Nothing here yet."
        renderRow={(item) => <div key={String(item)}>{String(item)}</div>}
      />
    );

    expect(screen.getByText("empty-icon")).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});

describe("RowListShell - rows", () => {
  it("renders one row per item via renderRow, in order", () => {
    render(
      <RowListShell
        items={["Alice", "Bob", "Carol"]}
        emptyIcon={<span>icon</span>}
        emptyMessage="empty"
        renderRow={(name) => <div key={name}>{name}</div>}
      />
    );

    const rendered = screen.getAllByText(/Alice|Bob|Carol/).map((el) => el.textContent);
    expect(rendered).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("renders rows without AnimatePresence by default", () => {
    render(
      <RowListShell
        items={["only"]}
        emptyIcon={<span>icon</span>}
        emptyMessage="empty"
        renderRow={(name) => <div data-testid="row">{name}</div>}
      />
    );

    expect(screen.getByTestId("row")).toBeInTheDocument();
  });

  it("still renders rows correctly when animated is true", () => {
    render(
      <RowListShell
        items={["only"]}
        animated
        emptyIcon={<span>icon</span>}
        emptyMessage="empty"
        renderRow={(name) => <div data-testid="row">{name}</div>}
      />
    );

    expect(screen.getByTestId("row")).toBeInTheDocument();
  });
});
