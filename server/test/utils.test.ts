import { describe, it, expect, vi, afterEach } from "vitest";
import { getCategoryBase } from "../utils/categoryHelpers";
import { calculatePayPalSurcharge } from "../utils/financeUtils";
import { normalizeRange } from "../utils/rangeUtils";
import { validateEnv } from "../utils/validateEnv";

describe("validateEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("completes without throwing when all required vars are present", () => {
    vi.stubEnv("SESSION_SECRET", "test");
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubEnv("SCRIPT_ID_BID_MANAGEMENT", "test");
    vi.stubEnv("SCRIPT_ID_ITEM_ENTRY", "test");
    vi.stubEnv("SCRIPT_ID_TICKETS", "test");

    // Should not throw or exit
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { 
      throw new Error("process.exit called"); 
    });
    
    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("calls process.exit(1) if a required var is missing", () => {
    // missing SESSION_SECRET
    vi.stubEnv("SESSION_SECRET", ""); 
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubEnv("SCRIPT_ID_BID_MANAGEMENT", "test");
    vi.stubEnv("SCRIPT_ID_ITEM_ENTRY", "test");
    vi.stubEnv("SCRIPT_ID_TICKETS", "test");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { 
      throw new Error(`process.exit(${code})`); 
      return undefined as never;
    });

    expect(() => validateEnv()).toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("categoryHelpers - getCategoryBase", () => {
  it("returns base for Arts, Crafts & Jewelry and variants", () => {
    expect(getCategoryBase("Arts, Crafts & Jewelry")).toBe(201);
    expect(getCategoryBase("Arts, Crafts and Jewelry")).toBe(201);
    expect(getCategoryBase("Jewelry")).toBe(201);
  });

  it("returns base for Health & Beauty and variants", () => {
    expect(getCategoryBase("Health & Beauty")).toBe(301);
    expect(getCategoryBase("Health and Beauty")).toBe(301);
    expect(getCategoryBase("Health")).toBe(301);
    expect(getCategoryBase("Beauty")).toBe(301);
  });

  it("priority: returns 1501 for sports categories containing 'raffle'", () => {
    // If it includes sports but also raffle, it should be 1501
    expect(getCategoryBase("Sports Raffle")).toBe(1501);
    expect(getCategoryBase("Raffle Sports")).toBe(1501);
  });

  it("returns 1201 for sports memorabilia and tickets", () => {
    expect(getCategoryBase("Sports Memorabilia")).toBe(1201);
    expect(getCategoryBase("Tickets")).toBe(1201);
  });

  it("returns 1 for unrecognized category name", () => {
    expect(getCategoryBase("Unknown Category")).toBe(1);
    expect(getCategoryBase("Zebra")).toBe(1);
  });

  it("returns 1 for empty string", () => {
    expect(getCategoryBase("")).toBe(1);
  });
});

describe("financeUtils - calculatePayPalSurcharge", () => {
  it("rounds total and surcharge to 2 decimal places", () => {
    const { total, surcharge } = calculatePayPalSurcharge(123.456);
    expect(total.toString()).toMatch(/^\d+\.\d{2}$/);
    expect(surcharge.toString()).toMatch(/^\d+\.\d{2}$/);
  });

  it("ensures total - surcharge equals original bidAmount to 2 decimal places", () => {
    const bidAmount = 100;
    const { total, surcharge } = calculatePayPalSurcharge(bidAmount);
    expect(Number((total - surcharge).toFixed(2))).toBe(bidAmount);
  });

  it("verifies known input/output pair ($100.00 bid)", () => {
    // Formula: (100 + 0.49) / (1 - 0.0349) = 100.49 / 0.9651 = 104.1239...
    // Rounded total: 104.12
    // Surcharge: 104.12 - 100 = 4.12
    const { total, surcharge } = calculatePayPalSurcharge(100);
    expect(total).toBe(104.12);
    expect(surcharge).toBe(4.12);
  });
});

describe("rangeUtils - normalizeRange", () => {
  it("quotes a plain sheet name without !", () => {
    expect(normalizeRange("Sheet1")).toBe("'Sheet1'");
  });

  it("quotes hyphenated sheet name with range", () => {
    expect(normalizeRange("Auction-Items!A:Z")).toBe("'Auction-Items'!A:Z");
  });

  it("returns already quoted range unchanged", () => {
    expect(normalizeRange("'Auction-Items'!A:Z")).toBe("'Auction-Items'!A:Z");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeRange("")).toBe("");
  });

  it("escapes single quotes in sheet names (O'Brien -> 'O''Brien')", () => {
    expect(normalizeRange("O'Brien!A1")).toBe("'O''Brien'!A1");
    expect(normalizeRange("O'Brien")).toBe("'O''Brien'");
  });
});
