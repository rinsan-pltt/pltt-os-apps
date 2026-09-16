"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The corner grip that resizes a placed object (a signature, a watermark, an
 * image in the editor).
 *
 * Five of these existed as bare `<div role="slider" tabIndex={0}>` with pointer
 * handlers and **no `onKeyDown`** — focusable, announced as a slider, and
 * completely inoperable from the keyboard. Two of them also lacked
 * `aria-valuenow`/`min`/`max`, which makes the slider role invalid outright.
 *
 * Arrow keys step, Shift+Arrow steps coarsely, Home/End jump to the bounds —
 * the standard slider keyboard contract, so the role is now honest.
 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  step = 8,
  coarseStep = 40,
  onChange,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  className,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  coarseStep?: number
  onChange: (next: number) => void
  onPointerDown?: React.PointerEventHandler
  onPointerMove?: React.PointerEventHandler
  onPointerUp?: React.PointerEventHandler
  className?: string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.shiftKey ? coarseStep : step
    let next: number | null = null
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = value + delta
        break
      case "ArrowLeft":
      case "ArrowDown":
        next = value - delta
        break
      case "Home":
        next = min
        break
      case "End":
        next = max
        break
      default:
        return
    }
    // Only now, once a key we handle has matched — otherwise Tab and the
    // browser's own shortcuts get swallowed.
    e.preventDefault()
    onChange(clamp(next))
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        "absolute size-3.5 touch-none rounded-full border-2 bg-primary shadow",
        // A contrast ring against whatever is behind it. This was `border-white`
        // in five places, which vanished on a white page in light mode.
        "border-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className,
      )}
      style={{ cursor: "nwse-resize" }}
    />
  )
}
