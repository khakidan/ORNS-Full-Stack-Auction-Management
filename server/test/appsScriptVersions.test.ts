/**
 * Version.gs and server/generated/appsScriptVersions.ts must match the
 * repo's Apps Script code. If this fails, a file under
 * scripts/GoogleAppsScriptsCode/ changed without `npm run gas:stamp` -
 * run it and commit the result, or the Settings page will report the
 * scripts "Out of date" even after they're deployed.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { describe, it, expect } from "vitest";
import { EXPECTED_APPS_SCRIPT_VERSIONS } from "../generated/appsScriptVersions";
import { PROJECTS, SCRIPTS_ROOT, deployedFiles, fingerprint, stampedVersion } from "../../scripts/apps-script/fingerprint.mjs";

const projects = Object.keys(PROJECTS) as (keyof typeof EXPECTED_APPS_SCRIPT_VERSIONS)[];

describe.each(projects)("%s version stamp", (project) => {
  it("Version.gs holds the current fingerprint (else run `npm run gas:stamp`)", () => {
    expect(stampedVersion(project)).toBe(fingerprint(project));
  });

  it("the server expects that same fingerprint", () => {
    expect(EXPECTED_APPS_SCRIPT_VERSIONS[project]).toBe(fingerprint(project));
  });

  it("apiGetVersion reports it", () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS_ROOT, project, "Version.gs"), "utf8"), context);
    expect(vm.runInContext("apiGetVersion()", context)).toEqual({ success: true, version: fingerprint(project) });
  });
});

describe("fingerprint", () => {
  it("covers appsscript.json and every top-level .gs file except Version.gs, and nothing in subfolders", () => {
    const files: string[] = deployedFiles("BidManagementSpreadsheet");
    expect(files).toContain("appsscript.json");
    expect(files).toContain("00_Class_GlobalVariables.gs");
    expect(files).not.toContain("Version.gs");
    expect(files.some((f) => f.includes("PayPal"))).toBe(false);
  });

  it("changes when a file is deleted - a deletion-only change still gets pushed", () => {
    const dir = fs.mkdtempSync(path.join(SCRIPTS_ROOT, "..", ".fp-test-"));
    const name = path.basename(dir);
    try {
      // fingerprint() reads SCRIPTS_ROOT/<project>, so point it at a sibling copy.
      const rel = path.join("..", name);
      fs.writeFileSync(path.join(dir, "a.gs"), "const a = 1;");
      fs.writeFileSync(path.join(dir, "b.gs"), "const b = 2;");
      const before = fingerprint(rel);
      fs.unlinkSync(path.join(dir, "b.gs"));
      expect(fingerprint(rel)).not.toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
