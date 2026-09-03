/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_GoogleAIStudio.gs's
 * `_executeGeneration` (the shared success/error-wrapping contract all 8
 * api* document-generation bridge functions rely on) and the injectable
 * `itemManager` override.
 *
 * Deliberately NOT tested here: the 8 `create*` methods' actual document
 * output (createBundlingDoc, createItemLabels, etc.) - each constructs a
 * real DocumentApp/SlidesApp/DriveApp-backed generator, and faithfully
 * mocking those chained builder APIs (insertParagraph().setHeading()....)
 * for 7 different generators was judged not worth the effort versus the
 * safety it would buy - the same scoping call made for
 * BidManagementSpreadsheet's ReceiptDoc. See refactor-opportunities.md.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";

const { GoogleAIStudio } = loadGasClasses(
  ["scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_GoogleAIStudio.gs"],
  ["GoogleAIStudio"]
);

describe("GoogleAIStudio._executeGeneration", () => {
  it("returns { success: true, message } when the generator action succeeds", () => {
    const studio = new GoogleAIStudio();
    const result = studio._executeGeneration(() => {}, "Done!", "testLabel");
    expect(result).toEqual({ success: true, message: "Done!" });
  });

  it("returns { success: false, error } instead of throwing when the generator action fails", () => {
    const studio = new GoogleAIStudio();
    const result = studio._executeGeneration(
      () => { throw new Error("Drive quota exceeded"); },
      "Done!",
      "testLabel"
    );
    expect(result).toEqual({ success: false, error: "Error: Drive quota exceeded" });
  });

  it("never lets the caller see a raw thrown exception, regardless of what the action throws", () => {
    const studio = new GoogleAIStudio();
    expect(() => studio._executeGeneration(() => { throw "a bare string throw"; }, "msg", "label")).not.toThrow();
    const result = studio._executeGeneration(() => { throw "a bare string throw"; }, "msg", "label");
    expect(result.success).toBe(false);
  });
});

describe("GoogleAIStudio itemManager override", () => {
  it("uses the injected itemManager instead of constructing a real one", () => {
    const fakeItemManager = { marker: "this is the fake" };
    const studio = new GoogleAIStudio({ itemManager: fakeItemManager });
    expect(studio.itemManager).toBe(fakeItemManager);
  });

  it("lazily constructs a real AuctionItemManager when no override is given", () => {
    // AuctionItemManager.gs is deliberately NOT loaded here, so the real
    // fallback path (`new AuctionItemManager()`) throws ReferenceError -
    // the correct failure mode per loadGasClass.ts's own testing philosophy,
    // and proof the getter doesn't silently swallow a missing override.
    const studio = new GoogleAIStudio();
    expect(() => studio.itemManager).toThrow(/AuctionItemManager is not defined/);
  });
});
