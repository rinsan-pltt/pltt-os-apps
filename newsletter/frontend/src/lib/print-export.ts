"use client";

/**
 * Print-to-PDF for newsletter export.
 *
 * This clones the preview's OWN page nodes rather than rendering the server's
 * export HTML, because the two paginate differently by construction:
 *
 *   - preview.tsx measures every block in a hidden measurer and packs them into
 *     fixed pixel-height page boxes (`pageCap`, `firstPageReserved`).
 *   - export.py emits one continuous document and leaves page breaks to CSS
 *     `@page` flow.
 *
 * So a 2-page preview can export as 3 pages no matter which engine renders the
 * server HTML — WeasyPrint and PyMuPDF alike. Printing the very DOM the user is
 * looking at makes page count, page breaks and alignment match by construction,
 * and keeps text as selectable vector output.
 *
 * The clone goes into an isolated iframe with the app's stylesheets copied in,
 * so no ancestor's `overflow`, `zoom` or layout can interfere, and the app's own
 * UI never has to be hidden behind print media queries.
 */

/**
 * The print frame is created once and reused, and is NEVER torn down as part of
 * a print run.
 *
 * Chrome fires `afterprint` as soon as the dialog closes, but with the
 * "Save as PDF" destination the file is still being written at that moment —
 * detaching the frame there (or on a timer, if the user lingers over the folder
 * picker) aborts the save silently. The dialog appears, the user clicks Save,
 * and nothing reaches the disk. Keeping one inert 1px frame attached costs
 * nothing and removes the race entirely; the next print replaces it.
 */
let printFrame: HTMLIFrameElement | null = null;

function acquirePrintFrame(): HTMLIFrameElement {
  printFrame?.remove();
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;";
  document.body.appendChild(frame);
  printFrame = frame;
  return frame;
}

/** Copy the app's stylesheets in, and resolve once any <link> ones have loaded.
 *
 * Inline <style> applies synchronously, but a cloned <link> fetches again in the
 * new document. Printing before it lands produces a completely unstyled sheet,
 * so wait for them. */
async function copyStylesInto(doc: Document): Promise<void> {
  const pending: Promise<void>[] = [];
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const clone = doc.head.appendChild(node.cloneNode(true)) as HTMLElement;
    if (clone.tagName === "LINK") {
      pending.push(
        new Promise<void>((resolve) => {
          clone.addEventListener("load", () => resolve(), { once: true });
          clone.addEventListener("error", () => resolve(), { once: true });
        }),
      );
    }
  });
  await Promise.all(pending);
}

/** The page boxes carry pixel dimensions, so the @page box is set in the SAME
 * pixel units. Converting to mm would round (A4 is 793.7px, rendered at 794px)
 * and that fraction of a millimetre of overflow is enough to emit a blank sheet
 * after every page. */
function pageRules(widthPx: number, heightPx: number): string {
  return `
@page { size: ${widthPx}px ${heightPx}px; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
/* Browsers drop background colours when printing unless told otherwise —
   without this the whole theme palette prints white. */
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
/* The scoped-CSS holder also inherits the plugin's rewritten html/body rules,
   so flatten its own box or their padding/background would offset the pages. */
[data-nl-print-holder] {
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
}
[data-nl-page] {
  position: relative !important;
  width: ${widthPx}px !important;
  height: ${heightPx}px !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  outline: none !important;
  overflow: hidden;
  /* The footer is absolutely positioned at the bottom of its page box. If the
     box is allowed to fragment, the browser splits it across two sheets and the
     footer is cut in half or stranded on the next sheet — which is exactly the
     "broken footer" symptom. Keeping each page box atomic prevents it. */
  break-inside: avoid;
  page-break-inside: avoid;
  break-after: page;
  page-break-after: always;
}
[data-nl-page]:last-child { break-after: auto; page-break-after: auto; }
/* Editor-only affordances must never reach the paper. */
[data-nl-noprint] { display: none !important; }
`;
}

/**
 * Wrap the cloned pages in a replica of the plugin's root element.
 *
 * The Palette CLI rewrites every selector in the plugin's stylesheet to sit
 * under `[data-palette-plugin-root="<id>"]`, and rewrites `:root` / `html` /
 * `body` rules to that same selector (see lib/css-scope.js). Copying the
 * stylesheet into the print document therefore achieves nothing on its own —
 * without that attribute on an ancestor, not one rule matches. The pages then
 * render with no Tailwind at all: `absolute` stops applying so the footer flows
 * inline mid-page instead of pinning to the bottom, flex columns collapse to
 * full width, and the theme custom properties (which live on the rewritten
 * `:root` rule) never resolve.
 */
function buildPrintRoot(doc: Document, pages: NodeListOf<Element>): HTMLElement {
  const liveRoot = document.querySelector("[data-palette-plugin-root]");
  const root = doc.createElement("div");
  root.setAttribute("data-nl-print-holder", "");
  if (liveRoot) {
    const id = liveRoot.getAttribute("data-palette-plugin-root");
    if (id !== null) root.setAttribute("data-palette-plugin-root", id);
    // Theme/mode classes can live here rather than on <html>.
    root.className = liveRoot.className;
  }
  pages.forEach((page) => root.appendChild(page.cloneNode(true)));
  return root;
}

async function waitForAssets(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc) return;
  try {
    await doc.fonts?.ready;
  } catch {
    // Font Loading API unavailable — text still renders
  }
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  await Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

/**
 * Print the rendered preview pages.
 *
 * Throws when the preview isn't mounted or the host sandbox blocks programmatic
 * printing (a sandboxed frame without `allow-modals` makes `print()` throw or
 * no-op) — callers should fall back to the server-rendered PDF.
 */
export async function printPreviewPdf(opts: {
  widthPx: number;
  heightPx: number;
  title?: string;
}): Promise<void> {
  const pages = document.querySelectorAll("[data-nl-print-root] [data-nl-page]");
  if (pages.length === 0) {
    throw new Error("The preview isn't ready yet — open the newsletter and try again.");
  }

  const frame = acquirePrintFrame();

  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("The browser blocked printing from this page.");

    doc.open();
    doc.write("<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>");
    doc.close();

    // Carry over the theme: Tailwind tokens live on :root in the app's
    // stylesheets, and the light/dark class sits on <html>.
    doc.documentElement.className = document.documentElement.className;
    await copyStylesInto(doc);

    // The print dialog's default filename comes from the document title.
    doc.title = opts.title?.trim() || "newsletter";

    const rules = doc.createElement("style");
    rules.textContent = pageRules(opts.widthPx, opts.heightPx);
    doc.head.appendChild(rules);

    doc.body.appendChild(buildPrintRoot(doc, pages));

    await waitForAssets(frame);

    const win = frame.contentWindow;
    if (!win || typeof win.print !== "function") {
      throw new Error("The browser blocked printing from this page.");
    }

    win.focus();
    win.print();
    // Deliberately no teardown here — see acquirePrintFrame.
  } catch (err) {
    printFrame?.remove();
    printFrame = null;
    throw err;
  }
}
