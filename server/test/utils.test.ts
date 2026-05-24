import { describe, it, expect, vi, afterEach } from "vitest";
import { getCategoryBase } from "../utils/categoryHelpers";
import { calculatePayPalSurcharge } from "../utils/financeUtils";
import { normalizeRange } from "../utils/rangeUtils";
import { validateEnv } from "../utils/validateEnv";
import { getColumnLetter } from "../utils/columnUtils";
import { checkIdempotency, saveIdempotency } from "../utils/idempotency";
import { sheetCache, clearCacheForSpreadsheet, CACHE_TTL } from "../utils/sheetCache";
import { Request, Response } from "express";

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

  it("When two required variables are missing, process.exit(1) is still called and not skipped", () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("GEMINI_API_KEY", "");
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

  it("A variable set to '0' does NOT trigger process.exit", () => {
    vi.stubEnv("SESSION_SECRET", "0");
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubEnv("SCRIPT_ID_BID_MANAGEMENT", "test");
    vi.stubEnv("SCRIPT_ID_ITEM_ENTRY", "test");
    vi.stubEnv("SCRIPT_ID_TICKETS", "test");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { 
      throw new Error("process.exit called"); 
    });

    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
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

  it("Classroom Art category maps to base 101", () => {
    expect(getCategoryBase("Classroom Art")).toBe(101);
  });

  it("Fitness category maps to base 401", () => {
    expect(getCategoryBase("Fitness")).toBe(401);
  });

  it("Kids Activities category maps to base 501", () => {
    expect(getCategoryBase("Kids Activities")).toBe(501);
    expect(getCategoryBase("Kids Activity")).toBe(501);
    expect(getCategoryBase("kids")).toBe(501);
  });

  it("Retail category maps to base 601", () => {
    expect(getCategoryBase("Retail")).toBe(601);
  });

  it("Entertainment & Experiences category maps to base 701", () => {
    expect(getCategoryBase("Entertainment & Experiences")).toBe(701);
    expect(getCategoryBase("Entertainment and Experiences")).toBe(701);
    expect(getCategoryBase("some experience")).toBe(701);
  });

  it("Food category maps to base 801", () => {
    expect(getCategoryBase("Food")).toBe(801);
  });

  it("Services category maps to base 901", () => {
    expect(getCategoryBase("Services")).toBe(901);
    expect(getCategoryBase("some service")).toBe(901);
  });

  it("Classroom Baskets category maps to base 1001", () => {
    expect(getCategoryBase("Classroom Baskets")).toBe(1001);
    expect(getCategoryBase("Classroom Basket")).toBe(1001);
  });

  it("Travel category maps to base 1101", () => {
    expect(getCategoryBase("Travel")).toBe(1101);
  });

  it("Live category maps to base 1301", () => {
    expect(getCategoryBase("Live")).toBe(1301);
  });

  it("Movie Night category maps to base 1401", () => {
    expect(getCategoryBase("Movie Night")).toBe(1401);
    expect(getCategoryBase("just movie")).toBe(1401);
  });

  it("Open Appeal category maps to base 1601", () => {
    expect(getCategoryBase("Open Appeal")).toBe(1601);
    expect(getCategoryBase("some appeal")).toBe(1601);
  });

  it("handles case-insensitivity (all-uppercase input)", () => {
    expect(getCategoryBase("FOOD")).toBe(801);
    expect(getCategoryBase("FITNESS")).toBe(401);
  });

  it("handles trimming (extra leading/trailing whitespace)", () => {
    expect(getCategoryBase("  Food  ")).toBe(801);
    expect(getCategoryBase(" \tRetail\n ")).toBe(601);
  });

  it("handles & vs and variants (Arts, Crafts & Jewelry and Arts, Crafts and Jewelry)", () => {
    expect(getCategoryBase("Arts, Crafts & Jewelry")).toBe(201);
    expect(getCategoryBase("Arts, Crafts and Jewelry")).toBe(201);
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

  it("A bid amount of 0 — asserts total is fixed fee surcharge, surcharge is positive, no crash", () => {
    const { total, surcharge } = calculatePayPalSurcharge(0);
    expect(total).toBe(0.51);
    expect(surcharge).toBe(0.51);
    expect(total).not.toBeNaN();
    expect(surcharge).toBeGreaterThan(0);
  });

  it("A very large bid amount (10000) — asserts exact 2 decimal places", () => {
    const { total, surcharge } = calculatePayPalSurcharge(10000);
    expect(total).toBe(10362.13);
    expect(surcharge).toBe(362.13);
    expect(total.toString()).toMatch(/^\d+\.\d{2}$/);
    expect(surcharge.toString()).toMatch(/^\d+\.\d{2}$/);
  });

  it("Surcharge is always greater than zero for any positive bid amount", () => {
    const bids = [0.01, 1, 10, 50, 250];
    for (const bid of bids) {
      const { surcharge } = calculatePayPalSurcharge(bid);
      expect(surcharge).toBeGreaterThan(0);
    }
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

describe("columnUtils - getColumnLetter", () => {
  it("Index 0 returns \"A\"", () => {
    expect(getColumnLetter(0)).toBe("A");
  });

  it("Index 25 returns \"Z\"", () => {
    expect(getColumnLetter(25)).toBe("Z");
  });

  it("Index 26 returns \"AA\"", () => {
    expect(getColumnLetter(26)).toBe("AA");
  });

  it("Index 27 returns \"AB\"", () => {
    expect(getColumnLetter(27)).toBe("AB");
  });

  it("Index 51 returns \"AZ\"", () => {
    expect(getColumnLetter(51)).toBe("AZ");
  });

  it("Index 52 returns \"BA\"", () => {
    expect(getColumnLetter(52)).toBe("BA");
  });

  it("A negative index returns an empty string or throws", () => {
    expect(getColumnLetter(-1)).toBe("");
    expect(getColumnLetter(-5)).toBe("");
  });

  it("Index 701 returns \"ZZ\" — upper double-letter boundary", () => {
    expect(getColumnLetter(701)).toBe("ZZ");
  });

  it("A fractional index 1.9 returns \"B\" as produced by the current implementation", () => {
    expect(getColumnLetter(1.9)).toBe("B");
  });
});

describe("idempotency", () => {
  it("saveIdempotency with a valid key stores the response — a subsequent checkIdempotency call with the same key finds it", () => {
    const key = "test-key-idemp-1";
    const data = { success: true, value: 456 };
    saveIdempotency(key, data);

    const jsonMock = vi.fn();
    const mockReq = {} as unknown as Request;
    const mockRes = {
      json: jsonMock
    } as unknown as Response & MockIdempotencyRes;

    const result = checkIdempotency(mockReq, mockRes, key);
    expect(result).not.toBeNull();
    expect(jsonMock).toHaveBeenCalledWith({ success: true, value: 456, duplicated: true });
  });

  it("saveIdempotency with an empty string key does nothing — checkIdempotency returns null", () => {
    const jsonMock = vi.fn();
    const mockReq = {} as unknown as Request;
    const mockRes = {
      json: jsonMock
    } as unknown as Response & MockIdempotencyRes;

    saveIdempotency("", { success: true });
    const result = checkIdempotency(mockReq, mockRes, "");
    expect(result).toBeNull();
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it("checkIdempotency with a key that was never saved returns null", () => {
    const jsonMock = vi.fn();
    const mockReq = {} as unknown as Request;
    const mockRes = {
      json: jsonMock
    } as unknown as Response & MockIdempotencyRes;

    const result = checkIdempotency(mockReq, mockRes, "non-existent-key-123");
    expect(result).toBeNull();
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it("saveIdempotency overwrites the first save when called with the same key twice", () => {
    const key = "test-key-overwrite-2";
    saveIdempotency(key, { name: "initial" });
    saveIdempotency(key, { name: "updated" });

    const jsonMock = vi.fn();
    const mockReq = {} as unknown as Request;
    const mockRes = {
      json: jsonMock
    } as unknown as Response & MockIdempotencyRes;

    const result = checkIdempotency(mockReq, mockRes, key);
    expect(result).not.toBeNull();
    expect(jsonMock).toHaveBeenCalledWith({ name: "updated", duplicated: true });
  });

  it("checkIdempotency returns null for key that does not exist without calling res.json", () => {
    const jsonMock = vi.fn();
    const mockReq = {} as unknown as Request;
    const mockRes = {
      json: jsonMock
    } as unknown as Response & MockIdempotencyRes;

    const result = checkIdempotency(mockReq, mockRes, "no-exist-no-call");
    expect(result).toBeNull();
    expect(jsonMock).not.toHaveBeenCalled();
  });
});

interface MockIdempotencyRes {
  json: ReturnType<typeof vi.fn>;
}

describe("sheetCache", () => {
  afterEach(() => {
    sheetCache.clear();
  });

  it("CACHE_TTL is exactly 5000", () => {
    expect(CACHE_TTL).toBe(5000);
  });

  it("clearCacheForSpreadsheet with a spreadsheetId removes all keys starting with it and leaves other spreadsheets untouched", () => {
    sheetCache.set("sheetIdA:range1", { data: "abc", timestamp: Date.now() });
    sheetCache.set("sheetIdB:range2", { data: "xyz", timestamp: Date.now() });

    clearCacheForSpreadsheet("sheetIdA");

    expect(sheetCache.has("sheetIdA:range1")).toBe(false);
    expect(sheetCache.has("sheetIdB:range2")).toBe(true);
  });

  it("clearCacheForSpreadsheet with an empty string does nothing and does not throw", () => {
    sheetCache.set("sheetIdA:range1", { data: "abc", timestamp: Date.now() });

    expect(() => clearCacheForSpreadsheet("")).not.toThrow();
    expect(sheetCache.has("sheetIdA:range1")).toBe(true);
  });

  it("clearCacheForSpreadsheet operation leaves other spreadSheet keys intact when clearing one database ID", () => {
    sheetCache.set("spread1:rangeA", { data: "val1", timestamp: Date.now() });
    sheetCache.set("spread2:rangeB", { data: "val2", timestamp: Date.now() });

    clearCacheForSpreadsheet("spread1");

    expect(sheetCache.has("spread1:rangeA")).toBe(false);
    expect(sheetCache.has("spread2:rangeB")).toBe(true);
  });

  it("clearCacheForSpreadsheet is a no-op when the cache contains no entries for that spreadsheetId", () => {
    sheetCache.set("spread1:rangeA", { data: "val1", timestamp: Date.now() });

    clearCacheForSpreadsheet("spreadNonExistent ID");

    expect(sheetCache.has("spread1:rangeA")).toBe(true);
    expect(sheetCache.size).toBe(1);
  });
});
