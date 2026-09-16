"use client"

/** Plain-React modal — no portal/popper dependency, matching select.tsx's
 *  approach in this project.
 *
 *  Rewritten because the previous version had no focus management at all:
 *  Escape closed it, but Tab walked straight out into the page behind, nothing
 *  was focused on open, and focus was not restored on close. It also declared
 *  `aria-modal="true"` with no accessible name, and hardcoded
 *  `role="alertdialog"` even for non-alert content. */

import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  onOpenChange,
  children,
  /** `alertdialog` only when the dialog interrupts to confirm or warn.
   *  `dialog` is correct for everything else. */
  role = "dialog",
  labelledBy,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  role?: "dialog" | "alertdialog"
  /** Id of the element naming this dialog. `aria-modal` without a name leaves
   *  a screen-reader user in an unlabelled trap. */
  labelledBy?: string
  className?: string
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const restoreTo = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null
    // Focus the first control, or the panel itself if it holds none, so the
    // user starts inside the dialog rather than behind it.
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panelRef.current)?.focus()

    // Page scroll is locked while modal: scrolling the content behind a modal
    // is disorienting and, on iOS, strands the panel off-screen.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onOpenChange(false)
        return
      }
      if (e.key !== "Tab") return
      const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!items || items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      document.body.style.overflow = previousOverflow
      restoreTo.current?.focus?.()
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={() => onOpenChange(false)}
      role="presentation"
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-sm rounded-xl border border-border-strong bg-card p-surface shadow-[var(--dt-shadow-lg)]",
          "focus:outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
}) {
  const titleId = React.useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange} role="alertdialog" labelledBy={titleId}>
      <h2 id={titleId} className="text-heading">
        {title}
      </h2>
      <p className="mt-2 text-body text-muted-foreground">{description}</p>
      {/* Cancel first in the DOM so it is the first thing Tab and a screen
          reader reach — the safe option should not require passing over the
          destructive one. `flex-col-reverse` puts it visually last. */}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
