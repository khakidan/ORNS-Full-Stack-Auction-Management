/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { RefreshableListCard } from "./RefreshableListCard";

describe("RefreshableListCard", () => {
  it("renders the icon, title, description, and children", () => {
    render(
      <RefreshableListCard icon={<span data-testid="icon" />} title="Open Bug Reports" description="Still marked Open." loading={false} onRefresh={vi.fn()}>
        <div>table body</div>
      </RefreshableListCard>
    );

    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Open Bug Reports")).toBeInTheDocument();
    expect(screen.getByText("Still marked Open.")).toBeInTheDocument();
    expect(screen.getByText("table body")).toBeInTheDocument();
  });

  it("calls onRefresh when the Refresh button is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <RefreshableListCard icon={null} title="T" description="D" loading={false} onRefresh={onRefresh}>
        <div />
      </RefreshableListCard>
    );

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("disables the Refresh button and spins its icon while loading", () => {
    render(
      <RefreshableListCard icon={null} title="T" description="D" loading={true} onRefresh={vi.fn()}>
        <div />
      </RefreshableListCard>
    );

    const button = screen.getByRole("button", { name: /refresh/i });
    expect(button).toBeDisabled();
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
  });

  it("does not disable or spin the Refresh button when not loading", () => {
    render(
      <RefreshableListCard icon={null} title="T" description="D" loading={false} onRefresh={vi.fn()}>
        <div />
      </RefreshableListCard>
    );

    const button = screen.getByRole("button", { name: /refresh/i });
    expect(button).not.toBeDisabled();
    expect(button.querySelector("svg")?.getAttribute("class")).not.toContain("animate-spin");
  });
});
