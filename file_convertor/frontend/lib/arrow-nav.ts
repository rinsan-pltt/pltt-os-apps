/**
 * Arrow-key movement between a set of focusable items.
 *
 * `listArrowNav` is for a single column (the section rail): Up/Down step to the
 * previous/next item, Home/End jump to the ends. `gridArrowNav` is for a
 * wrapping grid (the dashboard's tool cards, several grids under category
 * headings): Left/Right follow reading order, Up/Down go to the card visually
 * above/below — the nearest one in the next row, measured on screen, so it
 * keeps working across section breaks and whatever column count the width
 * produces. Both return the item they moved to (or null), and only act when
 * focus is already on one of the items, so typing elsewhere is never hijacked.
 */

import type * as React from "react"

function items(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null, // visible only
  )
}

function focusItem(el: HTMLElement | undefined, event: KeyboardEvent | React.KeyboardEvent): HTMLElement | null {
  if (!el) return null
  event.preventDefault()
  el.focus()
  el.scrollIntoView({ block: "nearest", inline: "nearest" })
  return el
}

export function listArrowNav(
  event: React.KeyboardEvent,
  container: HTMLElement | null,
  selector: string,
): HTMLElement | null {
  if (!container) return null
  const all = items(container, selector)
  const index = all.indexOf(document.activeElement as HTMLElement)
  if (index < 0) return null
  switch (event.key) {
    case "ArrowDown":
      return focusItem(all[Math.min(all.length - 1, index + 1)], event)
    case "ArrowUp":
      return focusItem(all[Math.max(0, index - 1)], event)
    case "Home":
      return focusItem(all[0], event)
    case "End":
      return focusItem(all[all.length - 1], event)
    default:
      return null
  }
}

export function gridArrowNav(
  event: React.KeyboardEvent,
  container: HTMLElement | null,
  selector: string,
): HTMLElement | null {
  if (!container) return null
  const all = items(container, selector)
  const current = document.activeElement as HTMLElement
  const index = all.indexOf(current)
  if (index < 0) return null

  if (event.key === "ArrowRight") return focusItem(all[index + 1], event)
  if (event.key === "ArrowLeft") return focusItem(all[index - 1], event)
  if (event.key === "Home") return focusItem(all[0], event)
  if (event.key === "End") return focusItem(all[all.length - 1], event)
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return null

  const down = event.key === "ArrowDown"
  const from = current.getBoundingClientRect()
  const centerX = from.left + from.width / 2
  // The nearest row in that direction, then the card in it closest to our
  // column.
  const candidates = all
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => (down ? r.top >= from.bottom - 1 : r.bottom <= from.top + 1))
  if (candidates.length === 0) return null
  const rowTop = down
    ? Math.min(...candidates.map(({ r }) => r.top))
    : Math.max(...candidates.map(({ r }) => r.top))
  const row = candidates.filter(({ r }) => Math.abs(r.top - rowTop) < 4)
  row.sort(
    (a, b) =>
      Math.abs(a.r.left + a.r.width / 2 - centerX) - Math.abs(b.r.left + b.r.width / 2 - centerX),
  )
  return focusItem(row[0]?.el, event)
}
