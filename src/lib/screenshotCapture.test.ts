/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureScreenshot, blobToBase64 } from "./screenshotCapture";

const mockHtml2Canvas = vi.fn();
vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => mockHtml2Canvas(...args),
}));

describe("captureScreenshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"><p>app content</p></div>';
  });

  it("captures #root (not document.body) with foreignObjectRendering enabled - the oklch/Dialog-portal gotcha fix", async () => {
    const fakeCanvas = { toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["fake-png"], { type: "image/png" })) };
    mockHtml2Canvas.mockResolvedValue(fakeCanvas);

    const blob = await captureScreenshot();

    expect(mockHtml2Canvas).toHaveBeenCalledWith(
      document.getElementById("root"),
      expect.objectContaining({ foreignObjectRendering: true })
    );
    expect(blob).toBeInstanceOf(Blob);
  });

  it("returns null, not a throw, when html2canvas itself throws (e.g. the oklch parser bug this option works around)", async () => {
    mockHtml2Canvas.mockRejectedValue(new Error("Attempting to parse an unsupported color function \"oklch\""));

    const blob = await captureScreenshot();

    expect(blob).toBeNull();
  });

  it("returns null when #root doesn't exist, without attempting a capture", async () => {
    document.body.innerHTML = "";

    const blob = await captureScreenshot();

    expect(blob).toBeNull();
    expect(mockHtml2Canvas).not.toHaveBeenCalled();
  });
});

describe("blobToBase64", () => {
  it("strips the data: URL prefix, returning only the raw base64 payload", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const base64 = await blobToBase64(blob);

    expect(base64).not.toContain("data:");
    expect(base64).not.toContain(",");
    expect(base64.length).toBeGreaterThan(0);
  });
});
