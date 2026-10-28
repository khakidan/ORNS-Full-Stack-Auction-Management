/**
 * The Apps Scripts take the app's Config from each run's arguments
 * (useRunSettings_ in each 00_Class_GlobalVariables.gs) instead of a
 * `_Settings` tab that only the browser kept up to date (ROADMAP B11).
 *
 * Loaded via helpers/loadGasClass, not a Node reimplementation.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";

const BID_MANAGEMENT = "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet";
const ITEMS = "scripts/GoogleAppsScriptsCode/ItemsSpreadsheet";

/** A spreadsheet whose _Settings tab holds `rows` - or, without rows, one that fails any tab read. */
function spreadsheet(rows?: unknown[][]) {
  return {
    getSheetByName: (name: string) => {
      if (!rows) throw new Error(`read the ${name} tab`);
      return name === "_Settings" ? { getDataRange: () => ({ getValues: () => rows }) } : null;
    },
  };
}

describe("Bid Management script", () => {
  const load = () => loadGasClasses(
    [`${BID_MANAGEMENT}/00_Class_GlobalVariables.gs`, `${BID_MANAGEMENT}/Class_GoogleAIStudio.gs`],
    ["GlobalVariables", "useReceiptRunSettings_"]
  );

  it("gets the receipt folder and logo from the run, never reading the _Settings tab", () => {
    const { GlobalVariables, useReceiptRunSettings_ } = load();

    useReceiptRunSettings_("this-years-receipts", { ornsLogoID: "the-logo" });

    expect(new GlobalVariables({ activeSpreadSheet: spreadsheet() }).config).toEqual({ ornsLogoID: "the-logo", receiptFolderID: "this-years-receipts" });
  });

  it("has no settings at all for a run that passed none (an old caller), rather than falling back to _Settings", () => {
    const { GlobalVariables, useReceiptRunSettings_ } = load();

    useReceiptRunSettings_(null, undefined);

    expect(new GlobalVariables({ activeSpreadSheet: spreadsheet() }).config).toEqual({ receiptFolderID: null });
  });
});

describe("Items script", () => {
  const load = () => loadGasClasses([`${ITEMS}/00_Class_GlobalVariables.gs`], ["GlobalVariables", "useRunSettings_"]);
  const tab = [
    ["Setting Key", "ID Value"],
    ["ornsLogoID", "old-logo"],
    ["auctionDevFolderID", "last-years-folder"],
    ["avery8163LabelTemplateID", "template"],
  ];

  it("lays the run's settings over _Settings, so the Config's logo and folder win and the template still comes from the tab", () => {
    const { GlobalVariables, useRunSettings_ } = load();

    useRunSettings_({ ornsLogoID: "the-logo", auctionDevFolderID: "this-years-print" });

    expect(new GlobalVariables({ activeSpreadSheet: spreadsheet(tab) }).config).toMatchObject({
      ornsLogoID: "the-logo",
      auctionDevFolderID: "this-years-print",
      avery8163LabelTemplateID: "template",
    });
  });

  it("keeps the tab's value where the Config's is blank", () => {
    const { GlobalVariables, useRunSettings_ } = load();

    useRunSettings_({ ornsLogoID: "", auctionDevFolderID: "this-years-print" });

    expect(new GlobalVariables({ activeSpreadSheet: spreadsheet(tab) }).config.ornsLogoID).toBe("old-logo");
  });
});
