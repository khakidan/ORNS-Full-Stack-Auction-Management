import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  buildReportFilename,
  buildReportMarkdown,
  writeLocalReportFallback,
  uploadScreenshotToDrive,
  appendBugReportToSheet,
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
            "- [2026-09-03T14:32:00.000Z] **ERROR**: TypeError: x is undefined",
            "https://drive.google.com/file/d/x/view",
          ]],
        },
      })
    );
  });
});
