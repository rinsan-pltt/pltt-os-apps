/** Selection-safe DOM reordering for the document editor. */

/** True when the user currently has text selected (not just a caret). */
export function hasTextSelection(): boolean {
  const selection = typeof window !== "undefined" ? window.getSelection() : null
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed
}

/**
 * Move `els` to the end of their parent — last in DOM order is painted on
 * top, both on screen and in the exported PDF, which draws elements in
 * document order.
 *
 * Re-inserting a node RESETS every live range inside it: the DOM spec's
 * removing steps collapse the selection out of the removed subtree, and
 * `appendChild` is a remove followed by an insert even when the node is
 * already last. In an editor whose pages are one absolutely-positioned
 * paragraph per line — every PDF, Word document and slide deck opened here —
 * that silently threw away the caret, or a selection the user had just
 * dragged out inside a line.
 *
 * So the boundary points are captured and re-applied around the move. The
 * nodes themselves travel with the element, so the selection comes back
 * exactly as it was.
 */
export function raiseToFront(els: HTMLElement[]): void {
  const ordered = [...els].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )
  if (ordered.length === 0) return
  // Already on top: skip the move rather than churn the DOM (and with it the
  // exported paint order) on every single click.
  if (ordered.length === 1 && ordered[0].parentElement?.lastElementChild === ordered[0]) return

  const selection = typeof window !== "undefined" ? window.getSelection() : null
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const saved = range
    ? {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
      }
    : null

  ordered.forEach((el) => el.parentElement?.appendChild(el))

  if (!selection || !saved) return
  if (!saved.startContainer.isConnected || !saved.endContainer.isConnected) return
  try {
    const restored = document.createRange()
    restored.setStart(saved.startContainer, saved.startOffset)
    restored.setEnd(saved.endContainer, saved.endOffset)
    selection.removeAllRanges()
    selection.addRange(restored)
  } catch {
    // The boundary points no longer address a valid position (the content was
    // edited between capture and restore) — leave the selection as it is.
  }
}

/** The CSS Custom Highlight that keeps a remembered selection visible. */
const KEPT_SELECTION = "fc-kept-selection"

interface HighlightRegistry {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

/**
 * Paint `range` as if it were still selected, or clear the paint with null.
 *
 * Clicking outside the document (the AI assistant's prompt box, say) moves the
 * browser's one selection there and the highlighted text visibly deselects —
 * though the editor still remembers it and acts on it. A CSS Custom Highlight
 * draws the remembered range without touching the DOM, so what the user
 * selected stays on screen. Styled by `::highlight(fc-kept-selection)` in
 * globals.css. Browsers without the API simply show nothing extra.
 */
export function showKeptSelection(range: Range | null): void {
  if (typeof window === "undefined" || typeof CSS === "undefined") return
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights
  const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!registry || !HighlightCtor) return
  if (range && !range.collapsed) registry.set(KEPT_SELECTION, new HighlightCtor(range))
  else registry.delete(KEPT_SELECTION)
}

/** The nearest ancestor of `el` that scrolls vertically (the page canvas). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

/**
 * Run an edit without letting it move the page view.
 *
 * Focusing the editor, restoring a selection, or an `execCommand` can each make
 * the browser scroll the caret into view — and the caret passes through the
 * top of the document on the way (focus lands it at the start before a saved
 * range is put back). Applying a colour halfway down a long document then
 * jumped the view back to page one. The scroll position is captured before and
 * put back after, so the reader stays exactly where they were.
 */
export function preserveScroll<T>(el: HTMLElement | null, run: () => T): T {
  const scroller = scrollParent(el)
  const top = scroller?.scrollTop ?? 0
  const left = scroller?.scrollLeft ?? 0
  try {
    return run()
  } finally {
    if (scroller && (scroller.scrollTop !== top || scroller.scrollLeft !== left)) {
      scroller.scrollTop = top
      scroller.scrollLeft = left
    }
  }
}
