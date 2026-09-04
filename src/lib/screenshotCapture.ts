/**
 * Best-effort DOM-to-canvas screenshot for a bug report. Dynamically
 * imports html2canvas rather than bundling it into the main app chunk -
 * it's only ever needed when someone submits a report with a screenshot
 * (see vite.config.ts's dedicated `vendor-html2canvas` manualChunks
 * branch, which keeps this out of the eagerly-loaded vendor-utils chunk).
 *
 * `foreignObjectRendering: true` is required, not optional, on this app:
 * html2canvas 1.4.x's own manual CSS-color parser throws on `oklch()`,
 * which src/index.css's entire base theme uses (Tailwind v4 / shadcn
 * token system). That option delegates painting to the browser's native
 * SVG renderer instead, sidestepping the parser entirely.
 *
 * Captures `#root` specifically, not `document.body` - this app's Dialog
 * (@base-ui/react/dialog) portals its content to document.body, so the
 * bug report dialog itself is a sibling of #root, not a descendant.
 * Capturing document.body would screenshot the report dialog covering
 * the page instead of the page behind it.
 */
export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const target = document.getElementById("root");
    if (!target) return null;

    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(target, { foreignObjectRendering: true });

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  } catch (error) {
    console.error("[BugReport] Screenshot capture failed - continuing without one:", error);
    return null;
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the "data:image/png;base64," prefix - the server only wants the raw payload.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
