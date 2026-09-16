"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A hover/focus label for a control that shows only an icon.
 *
 * The native `title` attribute technically does this, but it cannot be styled,
 * never appears for keyboard users, and is not announced reliably — so an
 * icon-only button ends up with no discoverable name at all.
 *
 * WCAG 1.4.13 (content on hover or focus) asks for three things, all here:
 *   * dismissible — Escape closes it without moving focus;
 *   * hoverable — it carries no controls and no pointer events, so the pointer
 *     passes straight through it and it cannot be dismissed by being hovered;
 *   * persistent — it stays until the pointer or focus leaves, or Escape.
 *
 * The label is ALSO the trigger's accessible name: the child keeps its own
 * `aria-label`, and the bubble is `aria-hidden`, so assistive tech hears the
 * name once rather than twice. That is why `label` is a plain string.
 */

/** How long the pointer must rest before the label appears.
 *
 *  A tooltip that fires the instant the pointer crosses a button flashes at
 *  everyone merely passing over it. Platform tooltips wait: Windows and
 *  Material both sit around half a second. Keyboard focus gets no delay —
 *  focus is deliberate, and a delay there just makes the label feel broken. */
const HOVER_DELAY_MS = 600

/** Keep the bubble this far inside the viewport edges. */
const EDGE_MARGIN = 8

export function Tooltip({
  label,
  children,
  side = "bottom",
  className,
}: {
  /** The text to show. Pass the same string as the trigger's aria-label. */
  label: string
  /** A single focusable element — the icon control this labels. */
  children: React.ReactNode
  side?: "bottom" | "top"
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  // Horizontal correction, in px, applied on top of the centring transform.
  const [shift, setShift] = React.useState(0)
  const bubbleRef = React.useRef<HTMLSpanElement>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const close = React.useCallback(() => {
    cancel()
    setOpen(false)
  }, [cancel])

  React.useEffect(() => cancel, [cancel])

  // These triggers sit at the top-RIGHT of every page header, so a bubble
  // centred under one runs off the edge of the window — and, because the
  // working area is a scroll container, off the edge of that too, which would
  // give the page a horizontal scrollbar. Measure once the bubble is laid out
  // (unshifted, because `shift` is reset on close) and nudge it back inside.
  React.useLayoutEffect(() => {
    if (!open) {
      setShift(0)
      return
    }
    const el = bubbleRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      // Undo any correction already applied, so this stays a single pass and
      // cannot oscillate between two positions.
      const left = rect.left - shift
      const right = rect.right - shift
      const limit = document.documentElement.clientWidth - EDGE_MARGIN
      if (right > limit) setShift(limit - right)
      else if (left < EDGE_MARGIN) setShift(EDGE_MARGIN - left)
      else setShift(0)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shift` is read
    // to undo itself; depending on it would re-run this on its own output.
  }, [open, label])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Not stopPropagation: Escape may also need to close whatever is behind
      // this, and a tooltip is not a modal layer.
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(e) => {
        // Touch fires pointerenter on tap, which would leave a bubble stuck
        // over the thing the user just pressed. Hover is a mouse idiom.
        if (e.pointerType === "touch") return
        cancel()
        timer.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS)
      }}
      onPointerLeave={close}
      onFocusCapture={() => {
        cancel()
        setOpen(true)
      }}
      onBlurCapture={close}
      // A click has done whatever it does; the label has served its purpose
      // and would otherwise hang over the result.
      onClick={close}
    >
      {children}
      <span
        ref={bubbleRef}
        // aria-hidden because the trigger already carries this text as its
        // accessible name. A tooltip role here would make it announce twice.
        aria-hidden
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
        className={cn(
          // `whitespace-nowrap` is load-bearing, not styling. An absolutely
          // positioned box shrinks to fit its CONTAINING BLOCK, which here is
          // the 40px icon button — so without it the label wraps to one word
          // per line and the bubble comes out three lines tall. The max-width
          // is only a backstop for a pathologically long translation.
          "pointer-events-none absolute left-1/2 z-50 whitespace-nowrap rounded-md px-2 py-1",
          "max-w-[min(16rem,calc(100vw-1rem))] overflow-hidden text-ellipsis",
          // The same raised surface the dropdown menu uses, so it follows the
          // theme instead of inverting it: a light chip on the light palette
          // and a dark one on the dark palette. The earlier version painted
          // `--foreground`, which made it *white* in dark mode.
          "border border-border-strong bg-card font-medium text-foreground shadow-[var(--erx-shadow-lg)]",
          // AFTER the colour on purpose. `cn` runs tailwind-merge, which does
          // not know `caption` is a font size in this config and buckets
          // `text-caption` with the colours — so `text-foreground` coming
          // later silently dropped it and the label rendered at 15px.
          "text-caption",
          "transition-opacity duration-[var(--erx-dur-instant)] ease-out",
          // No gap between trigger and bubble: nothing to fall through, and
          // nothing for the pointer to cross (WCAG 1.4.13, "hoverable").
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          open ? "opacity-100" : "opacity-0",
          className,
        )}
      >
        {label}
      </span>
    </span>
  )
}
