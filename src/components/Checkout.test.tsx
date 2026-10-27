// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Checkout from "./Checkout";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl, getSheetData, postOnce } from "@/services/google-api";

vi.mock("@/services/google-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/google-api")>()),
  fetchWithRetry: vi.fn(),
  postOnce: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  getSheetData: vi.fn(),
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: {
      bidManagementSpreadsheetId: "mock-spreadsheet-id",
      auctionItemsSpreadsheetId: "mock-items-spreadsheet-id",
      receiptFolderId: "mock-folder-id",
      // A renamed Bidder-Numbers tab, so the receipt tests below show the configured names
      // (not hardcoded defaults) reach the server (ROADMAP.md L1).
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidders 2026",
      paypalIsSandbox: false
    }
  })
}));

const mockBidders = [
  { id: "101", firstName: "Jane", lastName: "Doe", email: "jane@test.com", checkedOut: false, paid: false },
  { id: "102", firstName: "John", lastName: "Smith", email: "john@test.com", checkedOut: false, paid: false }
];

const mockItems = [
  { id: "item1", name: "Art Class" },
  { id: "item2", name: "Pizza Party" }
];

// bidGridWins/fetchWinners stand in for AuctionContext's useWinnersData:
// the same Bid-Management read and parse, so each test's getSheetData
// mock still decides who won.
vi.mock("@/context/AuctionContext", async () => {
  const { useCallback, useState } = await vi.importActual<typeof import("react")>("react");
  const { parseBidGrid } = await vi.importActual<typeof import("@/lib/bidGridParsing")>("@/lib/bidGridParsing");
  const { getSheetData } = await import("@/services/google-api");
  return {
    useAuction: () => {
      const [bidGridWins, setBidGridWins] = useState<ReturnType<typeof parseBidGrid>>([]);
      const fetchWinners = useCallback(async () => {
        const data = await getSheetData("test-spreadsheet-id", "Bid-Management!A:ZZ");
        setBidGridWins(parseBidGrid(data?.values));
        return true;
      }, []);
      return {
        bidders: mockBidders,
        items: mockItems,
        loading: false,
        fetchAllData: vi.fn(),
        attendees: [],
        bidGridWins,
        fetchWinners,
      };
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn()
  }
}));

describe("Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock special winners response (empty for happy path)
    vi.mocked(getSheetData).mockImplementation((spreadsheetId: string, range: string) => {
      if (range.startsWith("Special-Winners")) {
        return Promise.resolve({ values: [] });
      }
      // Mock the bid-management sheet response
      // Structure: First row is header, then data rows.
      // Format matches Checkout.tsx logic: header=[bidderId1, "", bidderId2, ""]
      // data row for item1: [itemId1, price1, itemId2, price2]
      if (range.includes("Bid-Management")) {
        return Promise.resolve({
          values: [
            ["101", "Info", "102", "Info"], // row 0: headers
            ["Header", "Details", "Header", "Details"], // row 1
            ["More", "Stuff", "More", "Stuff"], // row 2
            ["item1", "$50.00", "item2", "$75.00"] // row 3: winners values
          ]
        });
      }
      return Promise.resolve({ values: [] });
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("Renders bidder checkout information", async () => {
    render(<Checkout />);

    expect(await screen.findByText("Jane Doe")).toBeTruthy();
    expect(await screen.findByText("John Smith")).toBeTruthy();

    expect(screen.getByText("Art Class")).toBeTruthy();
    expect(screen.getAllByText("$50.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Pizza Party")).toBeTruthy();
    expect(screen.getAllByText("$75.00").length).toBeGreaterThan(0);
  });

  it("shows winners of every checkout status together in one list, with no Pending/Checked-Out tabs to switch between", async () => {
    // The Pending Checkout / Already Checked Out tabs were removed as
    // redundant with the Status quick-filter (which already isolates
    // "awaiting"/"review"/"paid" individually - the tabs only offered a
    // coarser 2-way version of the same split). Jane hasn't checked out;
    // John has - both should render in the same view with no tab click
    // required. See CHANGELOG.md.
    mockBidders[1].checkedOut = true;
    try {
      render(<Checkout />);

      expect(await screen.findByText("Jane Doe")).toBeTruthy();
      expect(await screen.findByText("John Smith")).toBeTruthy();
      expect(screen.queryByText("Pending Checkout")).toBeFalsy();
      expect(screen.queryByText("Already Checked Out")).toBeFalsy();
    } finally {
      mockBidders[1].checkedOut = false;
    }
  });

  it("Print All Receipts button calls the correct endpoint", async () => {
    vi.mocked(postOnce).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, part: 1, totalParts: 1, bidderCount: 2 })
    } as Response);

    render(<Checkout />);
    await screen.findByText("Jane Doe");

    const btn = screen.getByText("Print All Receipts");
    await userEvent.click(btn);

    // Click "Yes, Print" in the confirm dialog
    const confirmBtn = await screen.findByText("Yes, Print");
    await userEvent.click(confirmBtn);

    // Sent once (postOnce, never retried), asking for part 1.
    expect(postOnce).toHaveBeenCalledTimes(1);
    expect(postOnce).toHaveBeenCalledWith(expect.stringContaining("/receipts/generate-all"), {
      spreadsheetId: "mock-spreadsheet-id",
      receiptFolderId: "mock-folder-id",
      itemsSpreadsheetId: "mock-items-spreadsheet-id",
      bidderNumbersSheet: "Bidders 2026",
      bidManagementSheet: "Bid-Management",
      part: 1,
    });
  });

  describe("Print All Receipts in parts", () => {
    const partResponse = (part: number, totalParts: number) => ({
      ok: true, status: 200, json: async () => ({ success: true, part, totalParts, bidderCount: 60 })
    } as Response);

    const printAll = async () => {
      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getByText("Print All Receipts"));
      await userEvent.click(await screen.findByText("Yes, Print"));
    };

    it("asks for every part in turn and reports when all are printed", async () => {
      vi.mocked(postOnce)
        .mockResolvedValueOnce(partResponse(1, 3))
        .mockResolvedValueOnce(partResponse(2, 3))
        .mockResolvedValueOnce(partResponse(3, 3));

      await printAll();

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
        "All 3 parts of the receipts printed. They're in your Receipts folder.", { id: "batch-print" }
      ));
      expect(vi.mocked(postOnce).mock.calls.map(([, body]: any) => body.part)).toEqual([1, 2, 3]);
    });

    it("stops at the first failed part and says which parts were printed", async () => {
      vi.mocked(postOnce)
        .mockResolvedValueOnce(partResponse(1, 3))
        .mockResolvedValueOnce({
          ok: false, status: 500,
          json: async () => ({ error: "Internal Server Error", message: "Exceeded maximum execution time" })
        } as Response);

      await printAll();

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
        "Exceeded maximum execution time Parts 1-1 of 3 were printed; part 2 was not.",
        { id: "batch-print", duration: Infinity }
      ));
      expect(postOnce).toHaveBeenCalledTimes(2);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("says there is nothing to print when no bidder has won anything", async () => {
      vi.mocked(postOnce).mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ success: true, part: 0, totalParts: 0, bidderCount: 0 })
      } as Response);

      await printAll();

      await waitFor(() => expect(toast.info).toHaveBeenCalledWith(
        "No bidders have winning items yet, so there are no receipts to print.", { id: "batch-print" }
      ));
    });
  });

  it("Email All Winners button calls the correct endpoint", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({})
    } as Response);

    render(<Checkout />);
    await screen.findByText("Jane Doe");

    const btn = screen.getByText("Email All Winners");
    await userEvent.click(btn);

    // Click "Yes, Email" in the confirm dialog
    const confirmBtn = await screen.findByText("Yes, Email");
    await userEvent.click(confirmBtn);

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/receipts/email-all"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"spreadsheetId":"mock-spreadsheet-id"')
      })
    );
    const emailBody = JSON.parse(vi.mocked(fetchWithRetry).mock.calls[0][1]!.body as string);
    // No paypalIsSandbox: the server reads sandbox/live from Firestore
    // itself (ROADMAP.md M3).
    expect(emailBody).toEqual({
      spreadsheetId: "mock-spreadsheet-id",
      itemsSpreadsheetId: "mock-items-spreadsheet-id",
      bidderNumbersSheet: "Bidders 2026",
      bidManagementSheet: "Bid-Management",
      idempotencyKey: expect.any(String)
    });
  });

  it("Per-bidder receipt buttons", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({})
    } as Response);
    vi.mocked(postOnce).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, subtotal: 50 })
    } as Response);

    render(<Checkout />);
    await screen.findByText("Jane Doe");

    // Get Jane Doe's card by finding its title and traversing up to the card,
    // or just looking for the buttons within the specific parent.
    // Easiest is to target specific role or text, but we need row scoped. 
    // The name "Jane Doe" is an h3 inside a card. We can grab the card that contains "Jane Doe"
    const janeTitle = screen.getByText("Jane Doe");
    // WinnerCard root has "flex flex-col h-full shadow-sm" but no simple role.
    // We can use screen.getAllByText("Print Receipt")[0] if Jane is first.
    // Or we can find the closest element containing the specific bidder's UI.
    const allPrintBtns = screen.getAllByText("Print Receipt");
    const janePrintBtn = allPrintBtns[0]; // Since Jane is bidder 101, she should be first.

    await userEvent.click(janePrintBtn);

    // Sent once (postOnce, never retried) - a retry made a second PDF.
    expect(postOnce).toHaveBeenCalledWith(
      expect.stringContaining("/receipts/generate"),
      expect.objectContaining({ bidderId: "101" })
    );

    const allEmailBtns = screen.getAllByText("Email Receipt");
    const janeEmailBtn = allEmailBtns[0];
    
    await userEvent.click(janeEmailBtn);

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/receipts/email-only"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"bidderId":"101"')
      })
    );
    const emailOnlyCall = vi.mocked(fetchWithRetry).mock.calls.find(([url]) => String(url).includes("/receipts/email-only"))!;
    expect(JSON.parse(emailOnlyCall[1]!.body as string)).not.toHaveProperty("paypalIsSandbox");
  });

  it("A receipt the script failed to make shows an error, not 'Receipt Doc created!'", async () => {
    vi.mocked(postOnce).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Exception: Document is missing" })
    } as Response);

    render(<Checkout />);
    await screen.findByText("Jane Doe");
    await userEvent.click(screen.getAllByText("Print Receipt")[0]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Exception: Document is missing"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Empty state — no winners yet", async () => {
    // Override getSheetData to return empty values
    vi.mocked(getSheetData).mockImplementation(async () => ({ values: [] }));

    render(<Checkout />);

    expect(await screen.findByText("No winners found in this category.")).toBeTruthy();
    expect(screen.queryByText("Jane Doe")).toBeFalsy();
  });

  describe("Mark paid / payment method dialog", () => {
    it("opens the payment method dialog showing the bidder's name and total", async () => {
      render(<Checkout />);
      await screen.findByText("Jane Doe");

      await userEvent.click(screen.getAllByText("Checkout")[0]);

      expect(await screen.findByText("Select Payment Method")).toBeTruthy();
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/How is Jane Doe paying/)).toBeTruthy();
      expect(within(dialog).getByText("$50.00")).toBeTruthy(); // Jane (bidder 101) won only item1
    });

    it("Confirm Payment is disabled until a method is selected", async () => {
      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);
      await screen.findByText("Select Payment Method");

      const confirmBtn = screen.getByText("Confirm Payment").closest("button") as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(true);
      await userEvent.click(screen.getByText("Cash"));
      expect(confirmBtn.disabled).toBe(false);
    });

    // Regression test for a real production bug: this app used to send
    // "CASH"/"CHECK"/"PAYPAL" (uppercase, and "PAYPAL" instead of
    // "credit_card") to /api/auction/checkout-mark-paid, which the live
    // Apps Script bridge (Class_GoogleAIStudio.gs's recordPayment) only
    // ever recognized as lowercase "cash"/"check"/"credit_card" - every
    // checkout failed. Pin the exact string sent for each option so this
    // can't silently regress again.
    it.each([
      ["Cash", "cash"],
      ["Check", "check"],
      ["Credit Card / PayPal", "credit_card"],
    ])("sends paymentMethod %s as the exact string %s the live Apps Script bridge expects", async (label, expected) => {
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);
      await screen.findByText("Select Payment Method");

      await userEvent.click(screen.getByText(label));
      await userEvent.click(screen.getByText("Confirm Payment"));

      await waitFor(() => {
        expect(fetchWithRetry).toHaveBeenCalledWith(
          expect.stringContaining("/api/auction/checkout-mark-paid"),
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining(`"paymentMethod":"${expected}"`),
          })
        );
      });
    });

    // Regression guard for the PayPal-invoice-on-checkout fix
    // (checkoutMarkPaid's credit_card branch needs itemsSpreadsheetId to
    // create an invoice when one doesn't already exist - see
    // useCheckoutPaymentFlow.ts/auctionService.ts and CHANGELOG.md). A
    // future refactor that drops or renames this field anywhere in the
    // Checkout.tsx -> useCheckoutState.ts -> useCheckoutPaymentFlow.ts
    // chain would previously have passed every existing test here.
    it("includes itemsSpreadsheetId in the credit-card checkout request body", async () => {
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);
      await screen.findByText("Select Payment Method");
      await userEvent.click(screen.getByText("Credit Card / PayPal"));
      await userEvent.click(screen.getByText("Confirm Payment"));

      await waitFor(() => {
        expect(fetchWithRetry).toHaveBeenCalledWith(
          expect.stringContaining("/api/auction/checkout-mark-paid"),
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"itemsSpreadsheetId":"mock-items-spreadsheet-id"'),
          })
        );
      });
    });

    it("marks the bidder Paid immediately for an offline (cash/check) confirmation", async () => {
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);
      await screen.findByText("Select Payment Method");
      await userEvent.click(screen.getByText("Cash"));
      await userEvent.click(screen.getByText("Confirm Payment"));

      await waitFor(() => {
        // WinnerCard now renders "Paid" twice (a status chip plus the
        // footer state) - assert both are present instead of a single
        // ambiguous match.
        expect(screen.getAllByText("Paid").length).toBe(2);
      });
    });

    it("still shows Paid, plus the server's warning, when PayPal couldn't record a cash payment (ROADMAP.md L3)", async () => {
      const warning = "Bidder 101 is marked paid (Cash), but PayPal didn't record the payment on invoice INV2-X, so it can still be paid online. Mark it paid in the PayPal dashboard.";
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, warning }),
      } as Response);

      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);
      await screen.findByText("Select Payment Method");
      await userEvent.click(screen.getByText("Cash"));
      await userEvent.click(screen.getByText("Confirm Payment"));

      await waitFor(() => expect(screen.getAllByText("Paid").length).toBe(2));
      const { toast } = await import("sonner");
      expect(toast.warning).toHaveBeenCalledWith(warning, expect.anything());
    });

    it("shows Pending Verification (not Paid) when the server defers a credit-card checkout to the PayPal sweeper", async () => {
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ success: true, deferred: true }),
      } as Response);

      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);
      await screen.findByText("Select Payment Method");
      await userEvent.click(screen.getByText("Credit Card / PayPal"));
      await userEvent.click(screen.getByText("Confirm Payment"));

      await waitFor(() => {
        expect(screen.getByText("Pending Verification")).toBeTruthy();
      });
      expect(screen.queryByText("Paid")).toBeFalsy();
    });

    it("rolls back the optimistic update and shows an error toast when the checkout request fails", async () => {
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Unknown checkout payment method specified: cash" }),
      } as Response);

      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);
      await screen.findByText("Select Payment Method");
      await userEvent.click(screen.getByText("Cash"));
      await userEvent.click(screen.getByText("Confirm Payment"));

      // Optimistic "Paid" state should be reverted back to the Checkout button
      await waitFor(() => {
        expect(screen.getAllByText("Checkout").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("Paid")).toBeFalsy();

      const { toast } = await import("sonner");
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("reverted"));
    });

    it("shows a high-value confirmation warning instead of the payment dialog when the bidder won a Special-Winners item", async () => {
      vi.mocked(getSheetData).mockImplementation((_spreadsheetId: string, range: string) => {
        if (range.startsWith("Special-Winners")) {
          return Promise.resolve({ values: [["Gift Basket", "101"]] });
        }
        if (range.includes("Bid-Management")) {
          return Promise.resolve({
            values: [
              ["101", "Info", "102", "Info"],
              ["Header", "Details", "Header", "Details"],
              ["More", "Stuff", "More", "Stuff"],
              ["item1", "$50.00", "item2", "$75.00"],
            ],
          });
        }
        return Promise.resolve({ values: [] });
      });

      render(<Checkout />);
      await screen.findByText("Jane Doe");
      await userEvent.click(screen.getAllByText("Checkout")[0]);

      const { toast } = await import("sonner");
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("High-Value Alert"),
        expect.objectContaining({ description: expect.stringContaining("Gift Basket") })
      );
      // The payment dialog itself should not have opened yet
      expect(screen.queryByText("Select Payment Method")).toBeFalsy();
    });
  });
});
