"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Optional trailing count, e.g. the number of expenses in that status. */
  count?: number
}

/**
 * One accessible switcher replacing the three hand-rolled chip-tab rows this
 * app had (dashboard status filter, scan page tabs, add-expense dialog tabs).
 *
 * Implemented as a radiogroup with roving tabindex: Tab enters the group once,
 * then Arrow keys move between options — the behaviour a screen-reader or
 * keyboard user expects, and what the old plain <button> rows did not provide.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "default",
}: {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  /** Accessible name for the whole group. */
  label: string
  className?: string
  size?: "default" | "sm"
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault()
        move(index, 1)
        break
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault()
        move(index, -1)
        break
      case "Home":
        e.preventDefault()
        onChange(options[0].value)
        refs.current[0]?.focus()
        break
      case "End":
        e.preventDefault()
        onChange(options[options.length - 1].value)
        refs.current[options.length - 1]?.focus()
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-surface-sunken p-1",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg font-medium transition-colors duration-[120ms] ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              size === "sm" ? "h-8 px-3 text-caption" : "h-9 px-3.5 text-body",
              selected
                ? "bg-card text-foreground shadow-[var(--erx-shadow-sm)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-micro numeral",
                  selected ? "bg-muted text-muted-foreground" : "text-muted-foreground",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
