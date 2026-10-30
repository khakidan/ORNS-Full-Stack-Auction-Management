/**
 * @vitest-environment jsdom
 *
 * Adding and deleting an item from the Auction Items tab (ROADMAP T7): the
 * real tab, dialogs (including the real Select) and hooks
 * (useAddAuctionItem, useDeleteAuctionItem), with only the API calls mocked.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import AuctionItemsTab from "./AuctionItemsTab";
import { postJson, HttpError } from "@/services/apiClient";
import { deleteAuctionItem } from "@/services/google-api";
import { toast } from "sonner";

window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/context/ConfigContext", () => ({ useConfig: () => ({ config: { auctionItemsSpreadsheetId: "items-sheet" } }) }));
vi.mock("@/context/AuctionContext", () => ({ useAuction: () => ({ isAuctionClosed: false }) }));

const ITEMS = [
  { id: "801", rowIndex: 2, name: "Pizza Night", description: "", category: "Food", value: "$50.00", openingBid: "$22.50", minRaise: "$5.00", donor: "Joe's", itemType: "Certificate", status: "Active", bundleId: "", bundledDateTime: "" },
  { id: "301", rowIndex: 3, name: "Spa Day", description: "", category: "Health & Beauty", value: "$100.00", openingBid: "$45.00", minRaise: "$5.00", donor: "Spa", itemType: "Certificate", status: "Active", bundleId: "", bundledDateTime: "" },
];
const { refresh, setItems } = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), setItems: vi.fn() }));
vi.mock("@/hooks/useAuctionItems", () => ({
  useAuctionItems: () => ({ items: ITEMS, setItems, categories: ["Food", "Health & Beauty"], valueCalculations: [], loading: false, refresh }),
}));

vi.mock("@/services/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/apiClient")>()),
  postJson: vi.fn(),
}));
vi.mock("@/services/google-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/google-api")>()),
  deleteAuctionItem: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() } }));

let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  user = userEvent.setup();
});

async function openAddDialog() {
  render(<AuctionItemsTab />);
  await user.click(screen.getByRole("button", { name: /Add New Item/ }));
  return screen.findByRole("dialog");
}

async function choose(dialog: HTMLElement, field: string, option: string) {
  await user.click(within(dialog).getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("adding an item", () => {
  it("sends exactly what was filled in, then refreshes the list and closes", async () => {
    vi.mocked(postJson).mockResolvedValue({ success: true, assigned_id: "802" });
    const dialog = await openAddDialog();

    await choose(dialog, "Category *", "Food");
    await user.type(within(dialog).getByLabelText("Name *"), "Dinner for Two");
    await user.type(within(dialog).getByLabelText("Description"), "At a local bistro");
    await user.type(within(dialog).getByLabelText("Value"), "$100.00");
    await user.type(within(dialog).getByLabelText("Donor"), "Jane Smith");
    await choose(dialog, "Type", "Certificate");
    await user.click(within(dialog).getByRole("checkbox", { name: "Allow Multiple Winners" }));
    await user.click(within(dialog).getByRole("button", { name: "Save Item" }));

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith("/api/auction/add-item", {
      spreadsheetId: "items-sheet",
      category: "Food",
      name: "Dinner for Two",
      description: "At a local bistro",
      value: "$100.00",
      donor: "Jane Smith",
      itemType: "Certificate",
      allowMultipleWinners: true,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }, "Failed to add the item");
    expect(toast.success).toHaveBeenCalledWith("Item added and sequenced successfully with ID 802");
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("uses one key per opening of the dialog, so a retried save can't add the item twice", async () => {
    vi.mocked(postJson).mockRejectedValueOnce(new HttpError("Quota exceeded", 429, {})).mockResolvedValue({ success: true, assigned_id: "802" });
    const dialog = await openAddDialog();
    await choose(dialog, "Category *", "Food");
    await user.type(within(dialog).getByLabelText("Name *"), "Dinner for Two");

    await user.click(within(dialog).getByRole("button", { name: "Save Item" }));
    await user.click(within(dialog).getByRole("button", { name: "Save Item" }));

    const [first, second] = vi.mocked(postJson).mock.calls.map(([, body]) => (body as any).idempotencyKey);
    expect(second).toBe(first);
  });

  it("refuses without a category or name, sending nothing", async () => {
    const dialog = await openAddDialog();
    await user.type(within(dialog).getByLabelText("Name *"), "Dinner for Two");

    await user.click(within(dialog).getByRole("button", { name: "Save Item" }));

    expect(toast.error).toHaveBeenCalledWith("Name and Category are required");
    expect(postJson).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the dialog open with the server's reason when the add fails", async () => {
    vi.mocked(postJson).mockRejectedValue(new HttpError("Category not found: Food", 400, {}));
    const dialog = await openAddDialog();
    await choose(dialog, "Category *", "Food");
    await user.type(within(dialog).getByLabelText("Name *"), "Dinner for Two");

    await user.click(within(dialog).getByRole("button", { name: "Save Item" }));

    expect(toast.error).toHaveBeenCalledWith("Failed to add item: Category not found: Food");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name *")).toHaveValue("Dinner for Two");
  });
});

describe("deleting an item", () => {
  async function askToDelete(name: string) {
    render(<AuctionItemsTab />);
    await user.click(screen.getByRole("button", { name: `Delete ${name}` }));
    return screen.findByRole("dialog");
  }

  it("asks first, and does nothing if the person cancels", async () => {
    const confirm = await askToDelete("Spa Day");
    expect(confirm).toHaveTextContent("Spa Day");

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(deleteAuctionItem).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deletes that item's row, hides it at once, then reloads", async () => {
    vi.mocked(deleteAuctionItem).mockResolvedValue({ success: true });
    const confirm = await askToDelete("Spa Day");

    await user.click(within(confirm).getByRole("button", { name: "Confirm Delete" }));

    expect(deleteAuctionItem).toHaveBeenCalledWith("items-sheet", 3);
    const hide = setItems.mock.calls[0][0] as (items: typeof ITEMS) => typeof ITEMS;
    expect(hide(ITEMS).map((i) => i.name)).toEqual(["Pizza Night"]);
    expect(toast.success).toHaveBeenCalledWith("Item deleted successfully");
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("puts the item back and says why when the delete fails", async () => {
    vi.mocked(deleteAuctionItem).mockRejectedValue(new Error("Missing required parameters for deletion"));
    const confirm = await askToDelete("Spa Day");

    await user.click(within(confirm).getByRole("button", { name: "Confirm Delete" }));

    expect(setItems).toHaveBeenLastCalledWith(ITEMS);
    expect(toast.error).toHaveBeenCalledWith("Failed to delete item: Missing required parameters for deletion");
    expect(refresh).not.toHaveBeenCalled();
  });
});
