/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_GoogleAIStudio.gs's
 * `createBidderLabels` - it used to re-derive bidder numbers itself (via an
 * injected `BidderManager` cross-reading the Bid-Management spreadsheet by
 * name/email matching); it now just receives an already-fetched, already-
 * matched `{name, number}[]` list built by Node
 * (server/services/syncService.ts's getBidderLabelList, called from
 * server/routes/productionRoutes.ts before this Apps Script function ever
 * runs) - see refactor-opportunities.md's Code Hardening item #5.
 *
 * Deliberately NOT tested here: the full label-document generation itself
 * (BidderLabelsDoc/DocumentApp/DriveApp output, and the resulting
 * bidders.map(b => new Bidder(...)) conversion, which only runs once that
 * pipeline is reached) - same scoping call made for the Items-spreadsheet's
 * 8 document generators, see gs-items-google-ai-studio.test.ts and
 * refactor-opportunities.md. This file only pins the validate-before-
 * construct ordering: an empty/missing bidders list must throw before
 * BidderLabelsDoc (not loaded here) is ever touched.
 *
 * Loaded via helpers/loadGasClass, not a Node reimplementation.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";

const { GoogleAIStudio } = loadGasClasses(
  ["scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_GoogleAIStudio.gs"],
  ["GoogleAIStudio"]
);

describe("GoogleAIStudio.createBidderLabels", () => {
  it("throws a clear error when an empty bidders array is given, before BidderLabelsDoc is ever touched", () => {
    // BidderLabelsDoc.gs is deliberately NOT loaded here. If createBidderLabels
    // reached `new BidderLabelsDoc(...)` before this throw, the failure would
    // instead be "BidderLabelsDoc is not defined" - a different error, proving
    // the validate-before-construct ordering was violated.
    const studio = new GoogleAIStudio();
    expect(() => studio.createBidderLabels("folder-1", [])).toThrow(/No bidders were provided/);
  });

  it("throws the same error when bidders is omitted entirely", () => {
    const studio = new GoogleAIStudio();
    expect(() => studio.createBidderLabels("folder-1")).toThrow(/No bidders were provided/);
  });
});

describe("apiCreateBidderLabels bridge function", () => {
  it("is exported and converts a thrown error to { success: false, error }", () => {
    const { apiCreateBidderLabels } = loadGasClasses(
      ["scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_GoogleAIStudio.gs"],
      ["apiCreateBidderLabels"]
    );
    // No bidders passed - createBidderLabels's own validation throws, and
    // apiCreateBidderLabels's try/catch must still convert that into the
    // {success:false} shape the Node app expects.
    const result = apiCreateBidderLabels("folder-1", []);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toMatch(/No bidders were provided/);
  });
});
