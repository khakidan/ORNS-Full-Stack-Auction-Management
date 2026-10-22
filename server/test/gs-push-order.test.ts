/**
 * Every Apps Script project must load without a ReferenceError in the
 * order `clasp push` uploads its files.
 *
 * Apps Script runs a project's files top to bottom in that order, so
 * `class ReceiptManager extends GlobalVariables` fails if
 * Class_GlobalVariables.gs comes later. That happened on 2026-10-22:
 * the files were pushed alphabetically, and every function in the
 * Bid-Management script failed with "GlobalVariables is not defined".
 * Each folder's .clasp.json now lists base classes in `filePushOrder`.
 *
 * This loads each project's real .gs files the way clasp orders them
 * (filePushOrder first, then the rest alphabetically - see clasp's
 * build/src/core/files.js) and the way Apps Script runs them (each file
 * its own script, sharing one global scope).
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../../scripts/GoogleAppsScriptsCode");
const PROJECTS = ["BidManagementSpreadsheet", "ItemsSpreadsheet", "TicketsSpreadsheet"];

function pushOrder(project: string): string[] {
  const dir = path.join(ROOT, project);
  const config = JSON.parse(fs.readFileSync(path.join(dir, ".clasp.json"), "utf8"));
  const order: string[] = config.filePushOrder ?? [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".gs"));
  const rest = files.filter((f) => !order.includes(f)).sort((a, b) => a.localeCompare(b));
  return [...order, ...rest];
}

describe.each(PROJECTS)("%s push order", (project) => {
  it("lists only files that exist", () => {
    const dir = path.join(ROOT, project);
    const config = JSON.parse(fs.readFileSync(path.join(dir, ".clasp.json"), "utf8"));
    for (const file of config.filePushOrder) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
  });

  it("loads every file without using a class before its file has run", () => {
    // Only what top-level code needs; nothing here runs a function body.
    const context = vm.createContext({ console });
    for (const file of pushOrder(project)) {
      const source = fs.readFileSync(path.join(ROOT, project, file), "utf8");
      expect(() => new vm.Script(source, { filename: file }).runInContext(context), file).not.toThrow();
    }
  });
});
