/**
 * @vitest-environment jsdom
 *
 * EditAuctionItemDialog.tsx replaces the 9 separate per-field
 * EditableCell inline editors that used to live directly in
 * AuctionItemRow.tsx with a single dialog covering every editable field
 * at once - mirrors EditAttendeeDialog.tsx's pattern on the Attendee
 * List exactly (see EditAttendeeDialog.test.tsx's own convention: the
 * real Dialog is left unmocked). `@/components/ui/select` is mocked here
 * (matching BundlingDialog.test.tsx's convention) since the real
 * base-ui Select needs jsdom stubs (pointerCapture/scrollIntoView) this
 * file doesn't set up.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { EditAuctionItemDialog } from "./EditAuctionItemDialog";
import { AuctionItem } from "@/types";

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)} data-testid="mock-select">
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

function makeItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "101",
    name: "Vintage Camera",
    category: "Collectibles",
    description: "Old camera",
    value: "$100.00",
    openingBid: "$45.00",
    minRaise: "$5.00",
    donor: "Donor A",
    itemType: "Physical Item",
    status: "Active",
    bundleId: "",
    bundledDateTime: "",
    allowMultipleWinners: false,
    rowIndex: 2,
    ...overrides,
  };
}

function renderDialog(item: AuctionItem | null, overrides: Partial<Parameters<typeof EditAuctionItemDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <EditAuctionItemDialog
      item={item}
      open={true}
      onOpenChange={onOpenChange}
      categories={["Collectibles", "Decor", "Jewelry"]}
      onSave={onSave}
      isSaving={false}
      {...overrides}
    />
  );
  return { onSave, onOpenChange };
}

describe("EditAuctionItemDialog - labels", () => {
  // FormField links each label to its box, so screen readers announce it
  // and clicking the label focuses the box.
  it("each text field can be found by its label", async () => {
    renderDialog(makeItem());

    expect(screen.getByLabelText("Name")).toHaveValue("Vintage Camera");
    expect(screen.getByLabelText("Value")).toHaveValue("$100.00");
    expect(screen.getByLabelText("Opening Bid")).toHaveValue("$45.00");
    expect(screen.getByLabelText("Min Raise")).toHaveValue("$5.00");
    expect(screen.getByLabelText("Donor")).toHaveValue("Donor A");

    await userEvent.setup().click(screen.getByText("Donor"));
    expect(screen.getByLabelText("Donor")).toHaveFocus();
  });
});

describe("EditAuctionItemDialog - prefill", () => {
  it("prefills every editable field from the item", () => {
    renderDialog(makeItem());

    expect(screen.getByDisplayValue("101")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vintage Camera")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Old camera")).toBeInTheDocument();
    expect(screen.getByDisplayValue("$100.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("$45.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("$5.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Donor A")).toBeInTheDocument();
  });

  it("re-prefills when switching to a different item", () => {
    const itemA = makeItem({ rowIndex: 2, name: "Item A" });
    const { rerender } = render(
      <EditAuctionItemDialog item={itemA} open={true} onOpenChange={() => {}} categories={[]} onSave={() => {}} isSaving={false} />
    );
    expect(screen.getByDisplayValue("Item A")).toBeInTheDocument();

    const itemB = makeItem({ rowIndex: 3, name: "Item B" });
    rerender(
      <EditAuctionItemDialog item={itemB} open={true} onOpenChange={() => {}} categories={[]} onSave={() => {}} isSaving={false} />
    );
    expect(screen.getByDisplayValue("Item B")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Item A")).not.toBeInTheDocument();
  });
});

describe("EditAuctionItemDialog - saving", () => {
  it("only sends the fields that actually changed", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeItem({ rowIndex: 5 }));

    const nameInput = screen.getByDisplayValue("Vintage Camera");
    await user.clear(nameInput);
    await user.type(nameInput, "Antique Camera");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(5, [
      { field: "name", value: "Antique Camera" },
    ]);
  });

  it("sends multiple changed fields together", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeItem({ rowIndex: 5, value: "$100.00" }));

    const nameInput = screen.getByDisplayValue("Vintage Camera");
    await user.clear(nameInput);
    await user.type(nameInput, "Antique Camera");

    const valueInput = screen.getByDisplayValue("$100.00");
    await user.clear(valueInput);
    await user.type(valueInput, "$150.00");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    const changes = onSave.mock.calls[0][1];
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: "name", value: "Antique Camera" },
        { field: "value", value: "$150.00" },
      ])
    );
    expect(changes).toHaveLength(2);
  });

  it("closes without calling onSave when nothing changed", async () => {
    const user = userEvent.setup();
    const { onSave, onOpenChange } = renderDialog(makeItem());

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("changing category sends the category field", async () => {
    const { onSave } = renderDialog(makeItem({ rowIndex: 5, category: "Collectibles" }));

    const categorySelect = screen.getAllByTestId("mock-select")[0];
    fireEvent.change(categorySelect, { target: { value: "Decor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(5, [{ field: "category", value: "Decor" }]);
  });

  it("clicking Cancel calls onOpenChange(false) without saving", async () => {
    const user = userEvent.setup();
    const { onSave, onOpenChange } = renderDialog(makeItem());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("EditAuctionItemDialog - Allow Multiple Winners", () => {
  it("prefills the checkbox unchecked for a normal (non-repeatable) item", () => {
    renderDialog(makeItem({ allowMultipleWinners: false }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("prefills the checkbox checked for a repeatable item", () => {
    renderDialog(makeItem({ allowMultipleWinners: true }));
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("checking the box sends allowMultipleWinners=true", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeItem({ rowIndex: 5, allowMultipleWinners: false }));

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(5, [
      { field: "allowMultipleWinners", value: true },
    ]);
  });

  it("unchecking an already-repeatable item sends allowMultipleWinners=false", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeItem({ rowIndex: 5, allowMultipleWinners: true }));

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(5, [
      { field: "allowMultipleWinners", value: false },
    ]);
  });

  it("leaving the checkbox untouched does not include it among the saved changes", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(makeItem({ rowIndex: 5 }));

    const nameInput = screen.getByDisplayValue("Vintage Camera");
    await user.clear(nameInput);
    await user.type(nameInput, "Antique Camera");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    const changes = onSave.mock.calls[0][1];
    expect(changes.some((c: any) => c.field === "allowMultipleWinners")).toBe(false);
  });
});
