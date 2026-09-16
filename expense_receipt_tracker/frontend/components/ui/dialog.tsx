"use client"

/** Plain-React modal — no portal/popper dependency, matching select.tsx's
 *  approach in this project. Controlled via `open`/`onOpenChange`.
 *
 *  A bottom sheet below `sm`, a centred dialog above it. Both animate in and
 *  out; the exit is driven by `animationend` so it stays correct under
 *  reduced motion (where the duration collapses to ~0 but the event still
 *  fires) rather than by a timeout that would have to match the CSS. */

import * as React from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const SIZE_CLASS = { sm: "sm:max-w-sm", lg: "sm:max-w-lg", xl: "sm:max-w-3xl" } as const

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

/** `offsetParent !== null` is always false for a position:fixed element, so the
 *  old check silently excluded any fixed control inside a dialog from the trap. */
function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility()
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0
}

type Phase = "closed" | "open" | "closing"

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  wide = false,
  size,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rendered as the dialog heading and wired up as its accessible name.
   *  Pass this rather than an inline <h2>, or the dialog is unnamed to AT. */
  title?: React.ReactNode
  children: React.ReactNode
  /** Widen the panel for content-heavy dialogs (e.g. the expense form). */
  wide?: boolean
  /** Explicit panel width; overrides `wide` when set. `xl` fits wide content
   *  like the bulk-import review table. */
  size?: keyof typeof SIZE_CLASS
}) {
  const t = useT()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  // Where focus came from, so it can be handed back on close. Without this,
  // closing a dialog drops the user at the top of the document.
  const restoreTo = React.useRef<HTMLElement | null>(null)
  // Guards against a drag that starts inside the panel and ends on the
  // backdrop being treated as a click-outside (which used to discard a form).
  const backdropDown = React.useRef(false)

  const [phase, setPhase] = React.useState<Phase>(open ? "open" : "closed")

  React.useEffect(() => {
    if (open) setPhase("open")
    else setPhase((prev) => (prev === "closed" ? "closed" : "closing"))
  }, [open])

  // Safety net only — the real mechanism is animationend. This covers the case
  // where the panel never animates at all (e.g. a host stylesheet hides it).
  React.useEffect(() => {
    if (phase !== "closing") return
    const id = setTimeout(() => setPhase("closed"), 500)
    return () => clearTimeout(id)
  }, [phase])

  // Gated on `phase`, not `open`. The phase machine mounts the panel one render
  // after `open` flips, so keying this on `open` ran it while panelRef was
  // still null — focus never entered the dialog and Tab walked straight out.
  React.useEffect(() => {
    if (phase !== "open") return
    restoreTo.current = document.activeElement as HTMLElement | null

    // Move focus into the dialog: the first VISIBLE control, else the panel.
    // Not simply the first match — the sheet's close button is `sm:hidden`, so
    // on desktop it is display:none, and focusing it silently does nothing,
    // leaving focus outside the dialog entirely.
    const panel = panelRef.current
    const first = Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).find(isVisible)
    ;(first ?? panel)?.focus()

    // Stop the page behind the modal from scrolling. The plugin root is the
    // real scroll container (app/layout.tsx sets overflow-auto on it), so
    // locking only <body> would leave a bottom sheet sliding over a page that
    // still scrolls underneath.
    const root = document.querySelector<HTMLElement>("[data-expense-receipt-tracker-root]")
    const previousBody = document.body.style.overflow
    const previousRoot = root?.style.overflow
    document.body.style.overflow = "hidden"
    if (root) root.style.overflow = "hidden"

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onOpenChange(false)
        return
      }
      if (e.key !== "Tab") return

      // Focus trap: cycle within the panel instead of escaping to the host page.
      const nodes = Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => isVisible(el) || el === document.activeElement,
      )
      if (nodes.length === 0) {
        e.preventDefault()
        panel?.focus()
        return
      }
      const firstNode = nodes[0]
      const lastNode = nodes[nodes.length - 1]
      const active = document.activeElement

      if (e.shiftKey && (active === firstNode || active === panel)) {
        e.preventDefault()
        lastNode.focus()
      } else if (!e.shiftKey && active === lastNode) {
        e.preventDefault()
        firstNode.focus()
      }
    }

    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      document.body.style.overflow = previousBody
      if (root) root.style.overflow = previousRoot ?? ""
      restoreTo.current?.focus?.()
    }
  }, [phase, onOpenChange])

  if (phase === "closed") return null

  return (
    <div
      data-phase={phase}
      className={cn(
        "dialog-backdrop fixed inset-0 z-50 flex items-end justify-center overscroll-contain",
        "bg-black/55 backdrop-blur-[3px] sm:items-center sm:p-4",
      )}
      onMouseDown={(e) => {
        backdropDown.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropDown.current) onOpenChange(false)
        backdropDown.current = false
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        data-phase={phase}
        // The corpse must not be clickable or tabbable while it fades out.
        inert={phase === "closing" ? true : undefined}
        onAnimationEnd={(e) => {
          if (e.target === panelRef.current && phase === "closing") setPhase("closed")
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "dialog-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-card",
          "rounded-t-2xl border border-b-0 border-border-strong shadow-[var(--erx-shadow-lg)]",
          // No fixed ceiling: a 44rem cap meant a tall form scrolled inside the
          // dialog even on a 1080px screen with room to spare. It now grows to
          // the space actually available, and only scrolls when the viewport
          // genuinely can't fit the form.
          "focus:outline-none sm:max-h-[94dvh] sm:rounded-2xl sm:border-b",
          size ? SIZE_CLASS[size] : wide ? "sm:max-w-lg" : "sm:max-w-sm",
        )}
      >
        {/* Grab affordance — a sheet that can be dismissed needs to look like one. */}
        <div
          aria-hidden
          className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border sm:hidden"
        />

        {title && (
          <div className="flex shrink-0 items-start gap-inline px-surface pb-block pt-3 sm:pt-surface">
            <h2 id={titleId} className="min-w-0 flex-1 text-heading">
              {title}
            </h2>
            {/* Only on the sheet: tapping outside is not a discoverable exit
                when the surface covers most of the screen. */}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.close")}
              onClick={() => onOpenChange(false)}
              className="-mr-2 -mt-1 shrink-0 sm:hidden"
            >
              <X className="size-5" />
            </Button>
          </div>
        )}

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-surface",
            "pb-[max(var(--erx-pad-surface),env(safe-area-inset-bottom))]",
            !title && "pt-surface",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
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
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <p className="text-pretty text-body text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          {confirmLabel ?? t("common.delete")}
        </Button>
      </div>
    </Dialog>
  )
}
