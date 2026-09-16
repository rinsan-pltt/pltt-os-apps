"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * A dropdown of actions.
 *
 * Built rather than reached for because this is the app's first one: `Select` is
 * a native <select> for choosing a VALUE, and a list of things to *do* is a
 * different control with different semantics (`role="menu"`, activation on
 * Enter/Space, no committed value).
 *
 * Behaviour taken from the existing dialog and command palette so it feels the
 * same: Escape closes, a click outside closes, focus moves into the menu on
 * open and returns to the trigger on close, and Up/Down/Home/End move between
 * items. `aria-haspopup="menu"` plus `aria-expanded` tell assistive tech what
 * the trigger does before it is pressed.
 */

export interface MenuItem {
  id: string
  label: string
  icon?: LucideIcon
  /** Shown under the label — what the reader needs to choose between formats. */
  hint?: string
  disabled?: boolean
  run: () => void
}

export function Menu({
  label,
  items,
  icon: TriggerIcon,
  variant = "default",
  size,
  disabled,
  title,
  align = "end",
  className,
}: {
  label: string
  items: MenuItem[]
  icon?: LucideIcon
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  disabled?: boolean
  /** Native tooltip, used to explain a disabled trigger. */
  title?: string
  /** Which edge the panel lines up with. */
  align?: "start" | "end"
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  const close = React.useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // Escape anywhere, and any click that lands outside the trigger + panel.
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        close()
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("pointerdown", onPointer, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("pointerdown", onPointer, true)
    }
  }, [open, close])

  // Focus the first enabled item, so the menu is usable without a mouse the
  // moment it opens.
  React.useEffect(() => {
    if (!open) return
    const first = itemRefs.current.find((el) => el && !el.disabled)
    first?.focus()
  }, [open])

  const move = (from: number, delta: number) => {
    const enabled = itemRefs.current
      .map((el, i) => ({ el, i }))
      .filter(({ el }) => el && !el.disabled)
    if (enabled.length === 0) return
    const at = enabled.findIndex(({ i }) => i === from)
    const next = enabled[(at + delta + enabled.length) % enabled.length]
    next.el?.focus()
  }

  const onItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        move(index, 1)
        break
      case "ArrowUp":
        e.preventDefault()
        move(index, -1)
        break
      case "Home":
        e.preventDefault()
        itemRefs.current.find((el) => el && !el.disabled)?.focus()
        break
      case "End": {
        e.preventDefault()
        const reversed = [...itemRefs.current].reverse()
        reversed.find((el) => el && !el.disabled)?.focus()
        break
      }
      case "Tab":
        // A menu is a single stop; tabbing out dismisses it.
        close(false)
        break
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {TriggerIcon && <TriggerIcon className="size-4" aria-hidden />}
        {label}
        <ChevronDown
          className={cn("size-4 transition-transform duration-[var(--erx-dur-fast)]", open && "rotate-180")}
          aria-hidden
        />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            // Absolute, not fixed: under Palette OS the plugin sits in a host
            // container, and a viewport-positioned panel can escape its bounds.
            "absolute z-50 mt-2 min-w-56 overflow-hidden rounded-xl border border-border-strong bg-card p-1 shadow-[var(--erx-shadow-lg)]",
            "dialog-panel",
            align === "end" ? "left-0 sm:left-auto sm:right-0" : "left-0",
            // Never wider than the working area, whatever the trigger's
            // position: a 14rem minimum on a 320px screen still has to fit.
            "max-w-[calc(100vw-2rem)]",
          )}
          data-phase="open"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onKeyDown={(e) => onItemKeyDown(e, index)}
              onClick={() => {
                close(false)
                item.run()
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-body",
                "transition-colors duration-[var(--erx-dur-instant)]",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {item.icon && <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.label}</span>
                {item.hint && (
                  <span className="block truncate text-caption text-muted-foreground">{item.hint}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
