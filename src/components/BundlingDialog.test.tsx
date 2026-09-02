/**
 * @vitest-environment jsdom
 * 
 * Test suite for the BundlingDialog component.
 * 
 * NOTE: This component is a pure props-driven form with mocked state. Because of this,
 * `fireEvent.change` is used for the name input test instead of `userEvent.type`. 
 * `userEvent.type` relies on the parent re-rendering to process consecutive keystrokes properly, 
 * which fails on controlled inputs backed by mocked setters. `fireEvent` sends the whole payload at once.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { BundlingDialog } from "./BundlingDialog";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      data-testid="mock-select"
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, onClick }: any) => (
    <span role="button" onClick={onClick} data-testid="suggestion-badge">
      {children}
    </span>
  ),
}));

// Base props used by every test — override what you need per test
const baseProps = {
  isBundling: true,
  setIsBundling: vi.fn(),
  bundleDetails: {
    name: "",
    category: "Food",
    value: "$200.00",
    openingBid: "$90.00",
    minRaise: "$10.00",
    donor: "Joe's Pizza / Sushi Place",
    description: "A combined dining experience.",
  },
  setBundleDetails: vi.fn(),
  categories: ["Food", "Art", "Travel"],
  getAiSuggestions: vi.fn(),
  aiSuggestions: [],
  loadingSuggestions: false,
  getAiDescriptionSuggestion: vi.fn(),
  loadingDescription: false,
  executeBundle: vi.fn(),
  isExecutingBundle: false,
};

describe("BundlingDialog", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it("renders the dialog title and description", () => {
    render(<BundlingDialog {...baseProps} />);
    expect(screen.getByText("Bundle Auction Items")).toBeInTheDocument();
    expect(screen.getByDisplayValue("$200.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Joe's Pizza / Sushi Place")).toBeInTheDocument();
  });

  it("renders pre-populated bundle details from props", () => {
    render(<BundlingDialog {...baseProps} />);
    expect(screen.getByDisplayValue("$200.00")).toBeInTheDocument(); // value
    expect(screen.getByDisplayValue("$90.00")).toBeInTheDocument();  // openingBid
    expect(screen.getByDisplayValue("$10.00")).toBeInTheDocument();  // minRaise
    expect(screen.getByDisplayValue("Joe's Pizza / Sushi Place")).toBeInTheDocument(); // donor
  });

  it('"Ask Gemini for Ideas" button calls getAiSuggestions', async () => {
    render(<BundlingDialog {...baseProps} />);
    await user.click(screen.getByText("Ask Gemini for Ideas"));
    expect(baseProps.getAiSuggestions).toHaveBeenCalledOnce();
  });

  it('"Ask Gemini for Ideas" button is disabled while loading', () => {
    render(<BundlingDialog {...baseProps} loadingSuggestions={true} />);
    const btn = screen.getByText("Ask Gemini for Ideas").closest("button");
    expect(btn).toBeDisabled();
  });

  it('"Ask Gemini for Description" button calls getAiDescriptionSuggestion', async () => {
    render(<BundlingDialog {...baseProps} />);
    await user.click(screen.getByText("Ask Gemini for Description"));
    expect(baseProps.getAiDescriptionSuggestion).toHaveBeenCalledOnce();
  });

  it('"Ask Gemini for Description" button is disabled while loading', () => {
    render(<BundlingDialog {...baseProps} loadingDescription={true} />);
    const btn = screen.getByText("Ask Gemini for Description").closest("button");
    expect(btn).toBeDisabled();
  });

  it("AI suggestions appear as badges when provided", () => {
    render(<BundlingDialog {...baseProps} aiSuggestions={["Night Out Package", "Dinner for Two"]} />);
    expect(screen.getByText("Night Out Package")).toBeInTheDocument();
    expect(screen.getByText("Dinner for Two")).toBeInTheDocument();
    expect(screen.getByText(/suggested by gemini/i)).toBeInTheDocument();
  });

  it("no suggestion badges when aiSuggestions is empty", () => {
    render(<BundlingDialog {...baseProps} aiSuggestions={[]} />);
    expect(screen.queryByText(/suggested by gemini/i)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("suggestion-badge")).toHaveLength(0);
  });

  it("clicking an AI suggestion badge calls setBundleDetails with that name", async () => {
    render(<BundlingDialog {...baseProps} aiSuggestions={["Night Out Package"]} />);
    await user.click(screen.getByText("Night Out Package"));
    expect(baseProps.setBundleDetails).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Night Out Package" })
    );
  });

  it('"Confirm Bundle & Merge Rows" button calls executeBundle', async () => {
    render(<BundlingDialog {...baseProps} />);
    await user.click(screen.getByText("Confirm Bundle & Merge Rows"));
    expect(baseProps.executeBundle).toHaveBeenCalledOnce();
  });

  it('"Confirm Bundle & Merge Rows" is disabled when isExecutingBundle is true', () => {
    render(<BundlingDialog {...baseProps} isExecutingBundle={true} />);
    const btn = screen.getByText("Confirm Bundle & Merge Rows").closest("button");
    expect(btn).toBeDisabled();
  });

  it('"Cancel" button calls setIsBundling with false', async () => {
    render(<BundlingDialog {...baseProps} />);
    await user.click(screen.getByText("Cancel"));
    expect(baseProps.setIsBundling).toHaveBeenCalledWith(false);
  });

  it("name input change calls setBundleDetails with updated name", () => {
    render(<BundlingDialog {...baseProps} />);
    const nameInput = screen.getByPlaceholderText(/ultimate family staycation/i);
    fireEvent.change(nameInput, { target: { value: 'Test Bundle Name' } });
    expect(baseProps.setBundleDetails).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Test Bundle Name' })
    );
  });
});