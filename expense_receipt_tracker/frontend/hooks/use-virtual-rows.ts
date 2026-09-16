"use client"

import * as React from "react"

/**
 * Windowed rendering for a long list.
 *
 * Hand-rolled rather than pulled from a library, because this needs to keep a
 * real `<table>` (see expense-table.tsx: the window is bracketed by two spacer
 * `<tr>`s, so table semantics and the scrollbar length both stay honest).
 *
 * It deliberately does NOT create its own scroll container. The list used to
 * sit in a `max-h-[70vh] overflow-y-auto` box, which meant a second scrollbar
 * inside the page's own — you scrolled the page, hit the bottom, and still had
 * rows left to scroll inside the table. Instead it finds the nearest scrolling
 * ancestor (the shell's working area) and measures against that, so the whole
 * page scrolls once.
 *
 * Two further properties:
 *
 * - **`pinnedIndex` is always inside the window.** Without it, a keyboard-focused
 *   row scrolls out, unmounts, and focus falls to `<body>` — the classic
 *   virtualisation accessibility bug.
 * - **Below `threshold` rows it does nothing at all** — no listeners, no
 *   windowing, the exact code path the app ran before. Small ledgers are the
 *   overwhelmingly common case and shouldn't pay for machinery they don't need.
 */

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return node
    node = node.parentElement
  }
  return null
}

export function useVirtualRows({
  count,
  rowHeight,
  anchorRef,
  overscan = 8,
  pinnedIndex,
  threshold = 60,
}: {
  count: number
  rowHeight: number
  /** An element at the top of the list. Its offset inside the scrolling
   *  ancestor is what the window is measured from. */
  anchorRef: React.RefObject<HTMLElement | null>
  overscan?: number
  pinnedIndex?: number | null
  threshold?: number
}) {
  const [metrics, setMetrics] = React.useState({ offset: 0, height: 0 })
  const scrollerRef = React.useRef<HTMLElement | null>(null)
  const active = count > threshold && rowHeight > 0

  React.useEffect(() => {
    if (!active) return
    const anchor = anchorRef.current
    if (!anchor) return
    const scroller = findScrollParent(anchor)
    scrollerRef.current = scroller
    const target: HTMLElement | Window = scroller ?? window

    let frame = 0
    const read = () => {
      frame = 0
      const box = scroller ?? document.documentElement
      // How far the list's top has travelled above the top of the visible area.
      // Derived from live geometry, so it needs no bookkeeping when rows or
      // spacers change height.
      const anchorTop = anchor.getBoundingClientRect().top
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0
      const passed = viewTop - anchorTop
      const height = scroller ? box.clientHeight : window.innerHeight
      setMetrics((prev) =>
        prev.offset === passed && prev.height === height ? prev : { offset: passed, height },
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }

    read()
    target.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    if (scroller) observer.observe(scroller)
    observer.observe(anchor)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      target.removeEventListener("scroll", schedule)
      observer.disconnect()
    }
  }, [active, anchorRef])

  const scrollToIndex = React.useCallback(
    (index: number) => {
      const anchor = anchorRef.current
      const scroller = scrollerRef.current
      if (!anchor || rowHeight <= 0) return
      const rowTopInPage = anchor.getBoundingClientRect().top + index * rowHeight
      if (scroller) {
        const delta = rowTopInPage - scroller.getBoundingClientRect().top
        if (delta < 0) scroller.scrollTop += delta
        else if (delta + rowHeight > scroller.clientHeight)
          scroller.scrollTop += delta + rowHeight - scroller.clientHeight
      } else {
        window.scrollBy(0, rowTopInPage - window.innerHeight / 2)
      }
    },
    [anchorRef, rowHeight],
  )

  if (!active) {
    return { start: 0, end: count, padTop: 0, padBottom: 0, scrollToIndex, active: false }
  }

  const visible = Math.ceil((metrics.height || rowHeight * 12) / rowHeight)
  let start = Math.max(0, Math.floor(Math.max(0, metrics.offset) / rowHeight) - overscan)
  let end = Math.min(count, start + visible + overscan * 2)

  if (pinnedIndex != null && pinnedIndex >= 0 && pinnedIndex < count) {
    start = Math.min(start, pinnedIndex)
    end = Math.max(end, pinnedIndex + 1)
  }

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
    scrollToIndex,
    active: true,
  }
}
