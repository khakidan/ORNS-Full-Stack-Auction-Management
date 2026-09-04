/**
 * Best-effort DOM-to-canvas screenshot for a bug report. Dynamically
 * imports html2canvas rather than bundling it into the main app chunk -
 * it's only ever needed when someone submits a report with a screenshot
 * (see vite.config.ts's dedicated `vendor-html2canvas` manualChunks
 * branch, which keeps this out of the eagerly-loaded vendor-utils chunk).
 *
 * `foreignObjectRendering: true` alone is NOT enough on this app, despite
 * being the documented fix for html2canvas 1.4.x's oklch()-parsing crash
 * (confirmed live in a real submitted bug report before this fix - see
 * CHANGELOG.md). html2canvas's own `renderElement()` unconditionally
 * calls `parseBackgroundColor()` *before* it ever branches into the
 * foreignObjectRendering path, which reads
 * `getComputedStyle(document.body / documentElement).backgroundColor` -
 * and modern Chrome now serializes that computed value in whatever color
 * space it was declared in (oklch, for this app's Tailwind v4 theme)
 * rather than always downgrading to rgb(). `foreignObjectRendering` only
 * bypasses html2canvas's manual parser for the actual paint step; this
 * one pre-step still hits it regardless of that option. Worked around by
 * forcing a plain, parseable color onto the CLONED document's body/html
 * via `onclone` (the clone happens before this backgroundColor read, so
 * mutating the clone - not the live page - is both sufficient and safe).
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
    const canvas = await html2canvas(target, {
      foreignObjectRendering: true,
      backgroundColor: "#f8fafc",
      onclone: (clonedDoc: Document) => {
        clonedDoc.documentElement.style.backgroundColor = "#f8fafc";
        if (clonedDoc.body) clonedDoc.body.style.backgroundColor = "#f8fafc";
      },
    });

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
