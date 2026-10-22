/**
 * Every Apps Script project must load without a ReferenceError in the
 * order Apps Script stores its files.
 *
 * Apps Script runs a project's files top to bottom in that order, so
 * `class ReceiptManager extends GlobalVariables` fails if the file
 * defining GlobalVariables comes later. Files uploaded through the Apps
 * Script API (`clasp push`) are stored sorted by name, ignoring case,
 * whatever order they're sent in (`filePushOrder` in .clasp.json did not
 * help) - confirmed on 2026-10-22 with projects.getContent, after every
 * function in all three scripts failed with "GlobalVariables is not
 * defined" / "DocService is not defined". So the base classes' files are
 * named to sort first: 00_Class_GlobalVariables, 01_Class_GlobalStyles,
 * 02_Class_DriveService, 03_Class_DocService / 03_Class_SlidesService.
 *
 * This loads each project's real .gs files in that sorted order, each
 * file its own script sharing one global scope, as Apps Script runs them.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../../scripts/GoogleAppsScriptsCode");
const PROJECTS = ["BidManagementSpreadsheet", "ItemsSpreadsheet", "TicketsSpreadsheet"];

/** Apps Script's stored order: by name without extension, ignoring case. */
export function appsScriptOrder(fileNames: string[]): string[] {
  const key = (f: string) => f.replace(/\.gs$/, "").toLowerCase();
  return [...fileNames].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

describe("appsScriptOrder", () => {
  it("matches the order Apps Script stored a real push in (Tickets v9)", () => {
    const sent = ["Class_GlobalVariables", "Class_GlobalStyles", "Class_DriveService", "Class_DocService", "Class_Bidder", "Class_BidderLabelsDoc", "Class_GoogleAIStudio", "Class_TemplateManager", "menu"];
    expect(appsScriptOrder(sent)).toEqual([
      "Class_Bidder", "Class_BidderLabelsDoc", "Class_DocService", "Class_DriveService", "Class_GlobalStyles",
      "Class_GlobalVariables", "Class_GoogleAIStudio", "Class_TemplateManager", "menu",
    ]);
  });

  it("ignores case, as in Bid-Management v28 (API_PAYPAL_TESTS before AuctionItemManager_UnitTests)", () => {
    expect(appsScriptOrder(["AuctionItemManager_UnitTests", "API_PAYPAL_TESTS"])).toEqual(["API_PAYPAL_TESTS", "AuctionItemManager_UnitTests"]);
  });
});

describe.each(PROJECTS)("%s deployed files", (project) => {
  it("never pushes subfolders (not-deployed/ holds reference code that must stay out of the live script)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, project, ".clasp.json"), "utf8"));
    expect(config.skipSubdirectories).toBe(true);
  });

  it("contains no PayPal code - the app's server handles PayPal, and a script copy could be run by hand from the editor", () => {
    const files = fs.readdirSync(path.join(ROOT, project)).filter((f) => f.endsWith(".gs"));
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROOT, project, file), "utf8");
      expect(source, file).not.toMatch(/api-m(\.sandbox)?\.paypal\.com|new PayPalService\s*\(|function checkPendingPayPalInvoices/);
    }
  });
});

describe.each(PROJECTS)("%s load order", (project) => {
  it("loads every file without using a class before its file has run", () => {
    const files = fs.readdirSync(path.join(ROOT, project)).filter((f) => f.endsWith(".gs"));
    // Only what top-level code needs; nothing here runs a function body.
    const context = vm.createContext({ console });
    for (const file of appsScriptOrder(files)) {
      const source = fs.readFileSync(path.join(ROOT, project, file), "utf8");
      expect(() => new vm.Script(source, { filename: file }).runInContext(context), file).not.toThrow();
    }
  });
});
