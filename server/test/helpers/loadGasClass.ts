import fs from "fs";
import path from "path";
import vm from "vm";

/**
 * Loads a class declared in a Google Apps Script (.gs) reference file by
 * evaluating its real source text in a sandboxed vm context, so tests
 * exercise the actual file content instead of a reimplementation that
 * could drift from it.
 *
 * Apps-Script-only globals that involve real I/O or environment state
 * (UrlFetchApp, PropertiesService, etc.) are deliberately NOT provided
 * here - classes designed for testability (like PayPalService) accept
 * injected overrides instead of touching those globals at all when
 * overrides are given. If a loaded class's code path ever reaches one of
 * those without an override, it throws a ReferenceError, which is the
 * correct failure mode for a test harness that has no such global to
 * give it. Pure, deterministic Apps Script utilities with a trivial
 * Node equivalent (e.g. Utilities.base64Encode) ARE polyfilled below,
 * since there's nothing to mock or control about them.
 */
export function loadGasClass<T = new (...args: any[]) => any>(relativePathFromRepoRoot: string, className: string): T {
  const filePath = path.resolve(__dirname, "../../../", relativePathFromRepoRoot);
  const source = fs.readFileSync(filePath, "utf8");

  const sandbox: Record<string, unknown> = {
    console,
    Utilities: {
      base64Encode: (input: string) => Buffer.from(input, "utf8").toString("base64"),
    },
  };
  vm.createContext(sandbox);
  const script = new vm.Script(`${source}\nglobalThis.__loadGasClass_export__ = ${className};`, { filename: filePath });
  script.runInContext(sandbox);

  return sandbox.__loadGasClass_export__ as T;
}
