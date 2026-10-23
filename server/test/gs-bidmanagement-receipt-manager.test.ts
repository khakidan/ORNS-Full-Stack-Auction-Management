/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_Receipt.gs's
 * `Receipt.fromData` and `Class_GoogleAIStudio.gs`'s `createIndividualReceipt`
 * validation - `Class_ReceiptManager.gs` used to build a bidder's receipt
 * itself (`findBidderColInBidSheet_`/`buildReceipt_`, re-reading the
 * Bid-Management/Bidder-Numbers sheets independently of
 * server/services/emailService.ts's own copy of the same logic); Node now
 * resolves it once (server/services/receiptDataService.ts) and passes the
 * finished data in as a parameter, reconstructed here via `Receipt.fromData`.
 * See docs/agents/CHANGELOG.md's Code Hardening item #2 and
 * CHANGELOG.md for the full history.
 *
 * Deliberately NOT tested here: the full Doc-generation/PayPal-invoice
 * pipeline (`ReceiptManager.getOrCreateInvoiceUrl`/`processBatch_`,
 * `ReceiptDoc`/`DocumentApp`/`DriveApp` output) - `ReceiptManager`'s
 * constructor isn't designed for dependency injection (it always
 * constructs a real `AuctionItemManager`/`EmailManager`, which in turn
 * touch `SpreadsheetApp.getActiveSpreadsheet()`), so exercising it here
 * would mean faking global Apps Script services rather than testing real
 * behavior - the same scoping call already made for the Items-spreadsheet's
 * document generators (see gs-items-google-ai-studio.test.ts) and the
 * Tickets-spreadsheet's label doc (see gs-tickets-google-ai-studio.test.ts).
 *
 * Loaded via helpers/loadGasClass, not a Node reimplementation.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";

const { Receipt } = loadGasClasses(
  ["scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_Receipt.gs"],
  ["Receipt"]
);

describe("Receipt.fromData", () => {
  it("reconstructs a full Receipt from a plain data object", () => {
    const receipt = Receipt.fromData({
      bidId: "101",
      firstName: "Alice",
      lastName: "One",
      email: "alice@example.com",
      itemsWon: ["801"],
      itemNames: ["Pizza Night"],
      itemPrices: [50],
      totalCost: 50,
    });

    expect(receipt).toBeInstanceOf(Receipt);
    expect(receipt.getDisplayName()).toBe("Alice One");
    expect(receipt.hasWinningItems()).toBe(true);
    expect(receipt.itemsWon).toEqual(["801"]);
    expect(receipt.itemNames).toEqual(["Pizza Night"]);
    expect(receipt.itemPrices).toEqual([50]);
    expect(receipt.totalCost).toBe(50);
  });

  it("defaults array fields to empty and totalCost to 0 when omitted", () => {
    const receipt = Receipt.fromData({ bidId: "101", firstName: "Alice", lastName: "One", email: "alice@example.com" });

    expect(receipt.hasWinningItems()).toBe(false);
    expect(receipt.itemsWon).toEqual([]);
    expect(receipt.itemNames).toEqual([]);
    expect(receipt.itemPrices).toEqual([]);
    expect(receipt.totalCost).toBe(0);
    expect(receipt.paymentUrl).toBeNull();
    expect(receipt.adjustedTotal).toBeNull();
  });

  it("carries paymentUrl/adjustedTotal through when Node already resolved the invoice (Code Hardening item #2, Step 2)", () => {
    const receipt = Receipt.fromData({
      bidId: "101",
      firstName: "Alice",
      lastName: "One",
      email: "alice@example.com",
      itemsWon: ["801"],
      itemNames: ["Pizza Night"],
      itemPrices: [50],
      totalCost: 50,
      paymentUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2-TEST",
      adjustedTotal: 51.75,
    });

    expect(receipt.paymentUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-TEST");
    expect(receipt.adjustedTotal).toBe(51.75);
  });
});

describe("GoogleAIStudio.createIndividualReceipt - validation before ReceiptManager is ever touched", () => {
  const { GoogleAIStudio } = loadGasClasses(
    [
      "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/00_Class_GlobalVariables.gs",
      "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs",
    ],
    ["GoogleAIStudio"]
  );

  // GoogleAIStudio extends GlobalVariables, whose constructor touches
  // SpreadsheetApp.getActiveSpreadsheet() unless given explicit overrides
  // - passed here purely so construction succeeds in the sandbox; neither
  // value is ever read before createIndividualReceipt's own validation
  // returns (Class_ReceiptManager.gs is deliberately NOT loaded here - if
  // createIndividualReceipt reached `new ReceiptManager()` before that
  // validation, the failure would instead be "ReceiptManager is not
  // defined", a different error, proving the validate-first ordering was
  // violated).
  const fakeOverrides = { activeSpreadSheet: {}, config: {} };

  it("returns a clean error for an empty bidder ID, before ReceiptManager.gs is ever touched", () => {
    const studio = new GoogleAIStudio(fakeOverrides);
    expect(studio.createIndividualReceipt("", null, { bidId: "1" })).toEqual({
      success: false,
      error: "Provided Bidder ID is empty or invalid.",
    });
  });

  it("returns a clean error when no receipt data is provided, before ReceiptManager.gs is ever touched", () => {
    const studio = new GoogleAIStudio(fakeOverrides);
    expect(studio.createIndividualReceipt("101", null, null)).toEqual({
      success: false,
      error: "No receipt data provided.",
    });
  });

  it("returns a clean error when receiptData has no paymentUrl, before ReceiptManager.gs is ever touched (Code Hardening item #2, Step 2: Node must always resolve the invoice before calling this)", () => {
    const studio = new GoogleAIStudio(fakeOverrides);
    expect(studio.createIndividualReceipt("101", null, { bidId: "101", itemsWon: ["801"] })).toEqual({
      success: false,
      error: "No payment URL provided.",
    });
  });
});

describe("apiCreateIndividualReceipt / apiCreateAllReceipts bridge functions", () => {
  it("apiCreateIndividualReceipt converts a thrown error to { success: false, error }", () => {
    // No overrides reach GoogleAIStudio through this bare bridge call, so
    // construction itself throws (no real SpreadsheetApp in this sandbox) -
    // the try/catch must still convert that into the {success:false} shape
    // the Node app expects, exactly as it would for a real production
    // error.
    const { apiCreateIndividualReceipt } = loadGasClasses(
      [
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/00_Class_GlobalVariables.gs",
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs",
      ],
      ["apiCreateIndividualReceipt"]
    );
    const result = apiCreateIndividualReceipt("", null, null);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("apiCreateAllReceipts converts a thrown error to { success: false, error }", () => {
    const { apiCreateAllReceipts } = loadGasClasses(
      [
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/00_Class_GlobalVariables.gs",
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs",
      ],
      ["apiCreateAllReceipts"]
    );
    const result = apiCreateAllReceipts(null, []);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

describe("apiCreateIndividualReceipt / apiCreateAllReceipts declare every parameter Node sends (regression)", () => {
  // These two bridge functions used to be declared with fewer parameters
  // than server/services/receiptService.ts actually sends via the Apps
  // Script Execution API (parameters: [bidderId, folderID, receiptData] /
  // [folderID, receipts] - the middle `emailReceipt` parameter was
  // removed entirely once Code Hardening item #2's Step 5 deleted the
  // GAS-side email path it gated, which nothing ever actually triggered)
  // - since JS silently drops extra call-site arguments that don't bind
  // to a declared parameter, every real production call was resolving a
  // receipt in Node and then throwing it away before it ever reached
  // createIndividualReceipt/createAllReceipts. `new GoogleAIStudio()`'s
  // construction always throws in this sandbox (no SpreadsheetApp
  // override reaches a bare bridge call, see the describe block above),
  // so the only way to pin the fix without also faking global Apps
  // Script services is to assert on the function's own declared arity
  // directly. See CHANGELOG.md.
  it("apiCreateIndividualReceipt declares all 3 parameters (bidderId, folderID, receiptData)", () => {
    const { apiCreateIndividualReceipt } = loadGasClasses(
      [
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/00_Class_GlobalVariables.gs",
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs",
      ],
      ["apiCreateIndividualReceipt"]
    );
    expect(apiCreateIndividualReceipt.length).toBe(3);
  });

  it("apiCreateAllReceipts declares all 3 parameters (folderID, receipts, fileName)", () => {
    const { apiCreateAllReceipts } = loadGasClasses(
      [
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/00_Class_GlobalVariables.gs",
        "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs",
      ],
      ["apiCreateAllReceipts"]
    );
    // fileName: Node prints receipts in parts, one named PDF per part.
    expect(apiCreateAllReceipts.length).toBe(3);
  });
});
