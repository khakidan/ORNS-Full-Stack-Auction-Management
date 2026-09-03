/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_GoogleAIStudio.gs's
 * injectable `bidderManager` override and the fetch-before-construct
 * ordering in `createBidderLabels` - bidders are looked up and validated
 * BEFORE BidderLabelsDoc (which copies the Avery template into Drive) is
 * ever constructed, so a hard error (unmatched bidders, missing sync) never
 * leaves an orphaned empty Drive doc behind.
 *
 * Deliberately NOT tested here: the full label-document generation itself
 * (BidderLabelsDoc/DocumentApp/DriveApp output) - same scoping call made for
 * the Items-spreadsheet's 8 document generators, see
 * gs-items-google-ai-studio.test.ts and refactor-opportunities.md.
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

describe("GoogleAIStudio bidderManager override", () => {
  it("uses the injected bidderManager instead of constructing a real one", () => {
    const fakeBidderManager = { marker: "this is the fake" };
    const studio = new GoogleAIStudio({ bidderManager: fakeBidderManager });
    expect(studio.bidderManager).toBe(fakeBidderManager);
  });

  it("lazily throws building a real BidderManager only when no override is given", () => {
    // Class_BidderManager.gs is deliberately NOT loaded here, so the real
    // fallback path (`new BidderManager()`) throws ReferenceError - the
    // correct failure mode per loadGasClass.ts's own testing philosophy.
    expect(() => new GoogleAIStudio()).toThrow(/BidderManager is not defined/);
  });

  it("propagates getAllBidders's hard error without ever reaching BidderLabelsDoc construction", () => {
    // BidderLabelsDoc.gs is deliberately NOT loaded here. If createBidderLabels
    // called `new BidderLabelsDoc(...)` before this throw, the failure would
    // instead be "BidderLabelsDoc is not defined" - a different error, proving
    // the fetch-then-construct ordering was violated.
    const fakeBidderManager = {
      getAllBidders: () => { throw new Error("unmatched bidders: Ghost Person"); },
    };
    const studio = new GoogleAIStudio({ bidderManager: fakeBidderManager });

    expect(() => studio.createBidderLabels(null, "bm-id")).toThrow("unmatched bidders: Ghost Person");
  });

  it("passes bidManagementSpreadsheetId through to getAllBidders", () => {
    let receivedId: string | undefined;
    const fakeBidderManager = {
      getAllBidders: (id: string) => { receivedId = id; throw new Error("stop here"); },
    };
    const studio = new GoogleAIStudio({ bidderManager: fakeBidderManager });

    expect(() => studio.createBidderLabels("folder-1", "bm-id-42")).toThrow("stop here");
    expect(receivedId).toBe("bm-id-42");
  });
});

describe("apiCreateBidderLabels bridge function", () => {
  it("is exported and converts a thrown error to { success: false, error }", () => {
    const { apiCreateBidderLabels } = loadGasClasses(
      ["scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_GoogleAIStudio.gs"],
      ["apiCreateBidderLabels"]
    );
    // With no BidderManager.gs loaded and no overrides available to a bare
    // function call, GoogleAIStudio() throws building its default
    // BidderManager - apiCreateBidderLabels's try/catch must still convert
    // that into the {success:false} shape the Node app expects, exactly as
    // it would for a real hard-error (e.g. unmatched bidders).
    const result = apiCreateBidderLabels("folder-1", "bm-id");
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});
