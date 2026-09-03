/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { extractId } from "./useConfigSettingsState";

describe("extractId", () => {
  it("returns an empty string for empty/undefined input", () => {
    expect(extractId("")).toBe("");
    expect(extractId(undefined as unknown as string)).toBe("");
  });

  it("returns a bare, already-clean ID unchanged (trimmed)", () => {
    expect(extractId("1AbC-XyZ_123")).toBe("1AbC-XyZ_123");
    expect(extractId("  1AbC-XyZ_123  ")).toBe("1AbC-XyZ_123");
  });

  it("extracts a script ID from an Apps Script project editor URL", () => {
    const url = "https://script.google.com/home/projects/1AbC-XyZ_123/edit";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("extracts a spreadsheet/doc ID from a /d/ URL", () => {
    const url = "https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit#gid=0";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("extracts a folder ID from a Drive /folders/ URL", () => {
    const url = "https://drive.google.com/drive/folders/1AbC-XyZ_123";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("extracts an ID from an id= query parameter", () => {
    const url = "https://drive.google.com/open?id=1AbC-XyZ_123";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("prefers the /d/ pattern over a coincidental 'id=' substring elsewhere in the same URL", () => {
    // "#gid=0" itself contains the substring "id=" - if the /d/ branch's
    // own regex ever stopped matching, this would silently fall through
    // to the id= branch and extract "0" instead of the real spreadsheet ID.
    const url = "https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit#gid=0";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
    expect(extractId(url)).not.toBe("0");
  });

  it("extracts a folder ID even when the URL also has an unrelated id=-shaped query param", () => {
    const url = "https://drive.google.com/drive/folders/1AbC-XyZ_123?resourcekey=id%3Dxyz";
    expect(extractId(url)).toBe("1AbC-XyZ_123");
  });

  it("falls back to the raw trimmed input when no known Google URL pattern matches", () => {
    expect(extractId("not-a-url-just-an-id")).toBe("not-a-url-just-an-id");
    expect(extractId("  https://example.com/unrelated  ")).toBe("https://example.com/unrelated");
  });
});
