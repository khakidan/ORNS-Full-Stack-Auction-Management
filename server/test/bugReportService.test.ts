import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  buildReportFilename,
  buildReportMarkdown,
  writeLocalReportFallback,
  uploadScreenshotToDrive,
  appendBugReportToSheet,
  parseReportRow,
  listOpenBugReports,
  findReportRow,
  markReportResolved,
  deleteScreenshotFromDrive,
} from "../services/bugReportService";
import { BugReportPayload } from "../../src/types";

const BASE_REPORT: BugReportPayload = {
  title: "Checkout button does nothing",
  description: "Clicked twice, no response.",
  type: "Bug",
  timestamp: "2026-09-03T14:32:07.142Z",
  route: "/BidManagement (workflow: bids, tab: checkout)",
  appState: "Bidders: 42\nItems: 10",
  browserInfo: "User-Agent: test-agent",
  consoleActivity: [{ level: "error", message: "TypeError: x is undefined", timestamp: "2026-09-03T14:32:00.000Z" }],
  screenshotBase64: null,
};

describe("buildReportFilename", () => {
  it("is filename-safe (no colons/periods from the ISO timestamp)", () => {
    const name = buildReportFilename(BASE_REPORT);
    expect(name).not.toMatch(/[:.]/);
  });

  it("produces a different filename each call even for the same title/timestamp - the collision-avoidance fix", () => {
    // A too-coarse timestamp let two reports submitted close together
    // silently overwrite each other on disk - the random suffix is what
    // actually prevents that, so this pins it directly.
    const a = buildReportFilename(BASE_REPORT);
    const b = buildReportFilename(BASE_REPORT);
    expect(a).not.toBe(b);
  });

  it("slugifies the title into the filename", () => {
    expect(buildReportFilename(BASE_REPORT)).toContain("checkout-button-does-nothing");
  });
});

describe("buildReportMarkdown", () => {
  it("includes title, type, timestamp, route, app state, browser info, description, and console activity", () => {
    const md = buildReportMarkdown(BASE_REPORT, null);
    expect(md).toContain("# Checkout button does nothing");
    expect(md).toContain("**Type:** Bug");
    expect(md).toContain("**Timestamp:** 2026-09-03T14:32:07.142Z");
    expect(md).toContain("Bidders: 42");
    expect(md).toContain("User-Agent: test-agent");
    expect(md).toContain("Clicked twice, no response.");
    expect(md).toContain("TypeError: x is undefined");
  });

  it("links to the screenshot as a relative sibling file, not an embedded base64 blob", () => {
    const md = buildReportMarkdown(BASE_REPORT, "2026-09-03-abc123.png");
    expect(md).toContain("![Screenshot](./2026-09-03-abc123.png)");
    expect(md).not.toContain("data:image");
  });

  it("renders '(none captured)' when the console buffer is empty", () => {
    const md = buildReportMarkdown({ ...BASE_REPORT, consoleActivity: [] }, null);
    expect(md).toContain("(none captured)");
  });
});

describe("writeLocalReportFallback", () => {
  const writtenPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(writtenPaths.splice(0).map((p) => fs.rm(p, { force: true })));
  });

  it("writes a self-contained .md file to disk with the report's real content", async () => {
    const { filePath } = await writeLocalReportFallback(BASE_REPORT);
    writtenPaths.push(filePath);

    expect(path.basename(path.dirname(filePath))).toBe("bug-reports");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("Checkout button does nothing");
  });

  it("writes the screenshot as a sibling .png file and links it, when one is present", async () => {
    const report = { ...BASE_REPORT, screenshotBase64: Buffer.from("fake-png-bytes").toString("base64") };
    const { filePath, screenshotPath } = await writeLocalReportFallback(report);
    writtenPaths.push(filePath);
    if (screenshotPath) writtenPaths.push(screenshotPath);

    expect(screenshotPath).not.toBeNull();
    const screenshotContent = await fs.readFile(screenshotPath!);
    expect(screenshotContent.toString()).toBe("fake-png-bytes");

    const mdContent = await fs.readFile(filePath, "utf-8");
    expect(mdContent).toContain(`![Screenshot](./${path.basename(screenshotPath!)})`);
  });
});

describe("uploadScreenshotToDrive", () => {
  it("creates the file in the given folder with the given filename and returns a real Drive view link", async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: "drive-file-id" } });
    const fakeDrive = { files: { create } } as any;

    const link = await uploadScreenshotToDrive(fakeDrive, "folder-abc", Buffer.from("png-bytes").toString("base64"), "report-1.png");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { name: "report-1.png", mimeType: "image/png", parents: ["folder-abc"] },
      })
    );
    expect(link).toBe("https://drive.google.com/file/d/drive-file-id/view");
  });
});

describe("parseReportRow", () => {
  it("maps A-K into the documented field order, the inverse of appendBugReportToSheet's write order", () => {
    const row = ["report-1", "2026-09-04T00:00:00.000Z", "Open", "Bug", "Title", "Description", "/route", "app state", "browser info", "console activity", "https://drive.google.com/file/d/x/view"];
    expect(parseReportRow(row)).toEqual({
      reportId: "report-1",
      timestamp: "2026-09-04T00:00:00.000Z",
      status: "Open",
      type: "Bug",
      title: "Title",
      description: "Description",
      route: "/route",
      appState: "app state",
      browserInfo: "browser info",
      consoleActivity: "console activity",
      screenshotLink: "https://drive.google.com/file/d/x/view",
    });
  });

  it("defaults every missing/short-row column to an empty string rather than undefined", () => {
    expect(parseReportRow(["report-1"])).toEqual({
      reportId: "report-1",
      timestamp: "",
      status: "",
      type: "",
      title: "",
      description: "",
      route: "",
      appState: "",
      browserInfo: "",
      consoleActivity: "",
      screenshotLink: "",
    });
  });
});

describe("listOpenBugReports", () => {
  it("drops the header row and filters to Status === 'open' (case-insensitive), dropping rows with no Report ID", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        values: [
          ["Report ID", "Timestamp", "Status"],
          ["report-1", "t1", "Open"],
          ["report-2", "t2", "Fixed"],
          ["report-3", "t3", "open"],
          ["", "t4", "Open"], // no report ID - dropped
        ],
      },
    });
    const fakeSheets = { spreadsheets: { values: { get } } } as any;

    const reports = await listOpenBugReports(fakeSheets, "sheet-id");

    expect(get).toHaveBeenCalledWith({ spreadsheetId: "sheet-id", range: "Bug-Reports!A:K" });
    expect(reports.map((r) => r.reportId)).toEqual(["report-1", "report-3"]);
  });

  it("returns an empty array, not a throw, when the sheet has no data rows", async () => {
    const get = vi.fn().mockResolvedValue({ data: {} });
    const fakeSheets = { spreadsheets: { values: { get } } } as any;

    expect(await listOpenBugReports(fakeSheets, "sheet-id")).toEqual([]);
  });
});

describe("findReportRow", () => {
  it("returns the 1-indexed sheet row and the screenshot link (column K) matching the Report ID in column A", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        values: [
          ["Report ID"],
          ["report-1", "", "", "", "", "", "", "", "", "", "https://drive.google.com/file/d/report-1-screenshot/view"],
          ["report-2"],
          ["report-3", "", "", "", "", "", "", "", "", "", "https://drive.google.com/file/d/report-3-screenshot/view"],
        ],
      },
    });
    const fakeSheets = { spreadsheets: { values: { get } } } as any;

    expect(await findReportRow(fakeSheets, "sheet-id", "report-3")).toEqual({
      rowIndex: 4,
      screenshotLink: "https://drive.google.com/file/d/report-3-screenshot/view",
    });
    expect(get).toHaveBeenCalledWith({ spreadsheetId: "sheet-id", range: "Bug-Reports!A:K" });
  });

  it("returns an empty screenshotLink when the matched row has no screenshot", async () => {
    const get = vi.fn().mockResolvedValue({ data: { values: [["Report ID"], ["report-1"]] } });
    const fakeSheets = { spreadsheets: { values: { get } } } as any;

    expect(await findReportRow(fakeSheets, "sheet-id", "report-1")).toEqual({ rowIndex: 2, screenshotLink: "" });
  });

  it("returns rowIndex -1 when the Report ID isn't found", async () => {
    const get = vi.fn().mockResolvedValue({ data: { values: [["Report ID"], ["report-1"]] } });
    const fakeSheets = { spreadsheets: { values: { get } } } as any;

    expect(await findReportRow(fakeSheets, "sheet-id", "does-not-exist")).toEqual({ rowIndex: -1, screenshotLink: "" });
  });
});

describe("deleteScreenshotFromDrive", () => {
  it("deletes the file whose ID is parsed from the real 'https://drive.google.com/file/d/<id>/view' link format uploadScreenshotToDrive builds, with supportsAllDrives - the Bug Screenshots folder lives in a Shared Drive, and Drive rejects a delete without it", async () => {
    const deleteFn = vi.fn().mockResolvedValue({});
    const fakeDrive = { files: { delete: deleteFn } } as any;

    await deleteScreenshotFromDrive(fakeDrive, "https://drive.google.com/file/d/abc123/view");

    expect(deleteFn).toHaveBeenCalledWith({ fileId: "abc123", supportsAllDrives: true });
  });

  it("no-ops without throwing when the link is empty or doesn't match the expected format", async () => {
    const deleteFn = vi.fn();
    const fakeDrive = { files: { delete: deleteFn } } as any;

    await deleteScreenshotFromDrive(fakeDrive, "");
    await deleteScreenshotFromDrive(fakeDrive, "not-a-drive-link");

    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("swallows a Drive API failure rather than throwing - a resolved report must not fail to save just because cleanup didn't work", async () => {
    const deleteFn = vi.fn().mockRejectedValue(new Error("Drive API down"));
    const fakeDrive = { files: { delete: deleteFn } } as any;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(deleteScreenshotFromDrive(fakeDrive, "https://drive.google.com/file/d/abc123/view")).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("markReportResolved", () => {
  it("writes 'Fixed' to column C of the given row only", async () => {
    const update = vi.fn().mockResolvedValue({});
    const fakeSheets = { spreadsheets: { values: { update } } } as any;

    await markReportResolved(fakeSheets, "sheet-id", 5);

    expect(update).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "Bug-Reports!C5",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Fixed"]] },
    });
  });
});

describe("appendBugReportToSheet", () => {
  it("appends exactly one row to Bug-Reports!A:K in the documented column order, defaulting Status to Open", async () => {
    const append = vi.fn().mockResolvedValue({});
    const fakeSheets = { spreadsheets: { values: { append } } } as any;

    await appendBugReportToSheet(fakeSheets, "sheet-id", BASE_REPORT, "report-id-123", "https://drive.google.com/file/d/x/view");

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "sheet-id",
        range: "Bug-Reports!A:K",
        requestBody: {
          values: [[
            "report-id-123",
            "2026-09-03T14:32:07.142Z",
            "Open",
            "Bug",
            "Checkout button does nothing",
            "Clicked twice, no response.",
            "/BidManagement (workflow: bids, tab: checkout)",
            "Bidders: 42\nItems: 10",
            "User-Agent: test-agent",
            // Leading "'" neutralizes spreadsheet formula injection (Sheets
            // treats a leading -, like this list's own "- [" bullet
            // prefix, as a formula trigger under valueInputOption:
            // USER_ENTERED) - Sheets hides the quote itself in the
            // rendered cell, so this is invisible to anyone viewing the row.
            "'- [2026-09-03T14:32:00.000Z] **ERROR**: TypeError: x is undefined",
            "https://drive.google.com/file/d/x/view",
          ]],
        },
      })
    );
  });
});
