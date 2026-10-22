import { script_v1 } from "googleapis";
import { appsScriptDevMode } from "./appsScriptMode";

/**
 * Runs one Apps Script function through the Apps Script API (scripts.run)
 * and returns what it returned.
 *
 * Throws if the script itself failed - an uncaught error, the 6-minute
 * time limit, a missing deployment. The thrown message is the script's
 * real error ("Exceeded maximum execution time"), not the API's generic
 * "ScriptError".
 *
 * A `{ success: false, error }` result is returned, not thrown - every
 * api* bridge function catches its own errors and reports them that way,
 * so callers must check `result.success`.
 */
export async function runAppsScript(
  script: script_v1.Script,
  scriptId: string,
  functionName: string,
  parameters: unknown[]
): Promise<any> {
  const response = await script.scripts.run({
    scriptId,
    requestBody: {
      function: functionName,
      parameters,
      devMode: appsScriptDevMode(),
    },
  });

  if (response.data.error) {
    const details = response.data.error.details?.[0] as { errorMessage?: string } | undefined;
    throw new Error(details?.errorMessage || response.data.error.message || "Apps Script Execution Error");
  }
  return response.data.response?.result;
}

/** True when an api* bridge function reported its own failure. */
export function isAppsScriptFailure(result: any): result is { success: false; error?: string } {
  return Boolean(result) && result.success === false;
}
