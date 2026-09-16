"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Transient confirmation for actions whose result would otherwise be invisible.
 *
 * Saving, deleting, importing and bulk status changes all used to complete in
 * silence — the dialog closed, or a number changed somewhere off-screen, and a
 * screen-reader user got nothing at all.
 *
 * Two details that are easy to get wrong and are deliberate here:
 *
 * 1. The live region is the *persistent container*, not the item. A region that
 *    enters the DOM already containing its text is not reliably announced; text
 *    inserted into a region that was already there is.
 * 2. The dismiss timer pauses on hover and on focus-within. Once a toast holds a
 *    control (Undo), a timer the user cannot stop fails WCAG 2.2.1 — and an
 *    Undo button that flees before you reach it is a taunt.
 */

type Tone = "success" | "error"

export interface ToastAction {
  label: string
  onAction: () => void
}

interface ToastItem {
  id: number
  message: string
  tone: Tone
  action?: ToastAction
  duration: number
  leaving?: boolean
}

const EXIT_MS = 180

const ToastCtx = React.createContext<{
  toast: (
    message: string,
    options?: { tone?: Tone; action?: ToastAction; duration?: number },
  ) => void
} | null>(null)

/** Falls back to a no-op rather than throwing when no provider is mounted.
 *  Toasts are supplementary — every message they carry is also rendered
 *  inline — so a missing provider must never take a page down. The 404 route
 *  is exactly this case: the Palette router renders it outside the root
 *  layout, so it has no providers at all. */
const NO_TOAST = { toast: () => {} }

export function useToast() {
  return React.useContext(ToastCtx) ?? NO_TOAST
}

const DEFAULT_DURATION = 5000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const [items, setItems] = React.useState<ToastItem[]>([])
  const nextId = React.useRef(0)
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const remaining = React.useRef(new Map<number, { endsAt: number; left: number }>())

  const clearTimer = (id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }

  const dismiss = React.useCallback((id: number) => {
    clearTimer(id)
    remaining.current.delete(id)
    // Mark leaving first so the exit transition can run, then unmount.
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)))
    setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), EXIT_MS)
  }, [])

  const arm = React.useCallback(
    (id: number, ms: number) => {
      clearTimer(id)
      remaining.current.set(id, { endsAt: Date.now() + ms, left: ms })
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      )
    },
    [dismiss],
  )

  const pause = React.useCallback((id: number) => {
    const entry = remaining.current.get(id)
    if (!entry) return
    clearTimer(id)
    entry.left = Math.max(0, entry.endsAt - Date.now())
  }, [])

  const resume = React.useCallback(
    (id: number) => {
      const entry = remaining.current.get(id)
      if (!entry || timers.current.has(id)) return
      arm(id, entry.left)
    },
    [arm],
  )

  const toast = React.useCallback(
    (
      message: string,
      options?: { tone?: Tone; action?: ToastAction; duration?: number },
    ) => {
      const id = nextId.current++
      const duration = options?.duration ?? DEFAULT_DURATION
      setItems((prev) => [
        ...prev,
        { id, message, tone: options?.tone ?? "success", action: options?.action, duration },
      ])
      arm(id, duration)
    },
    [arm],
  )

  React.useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const value = React.useMemo(() => ({ toast }), [toast])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* The live region is this container, which is always mounted. */}
      <div
        role="status"
        aria-live="polite"
        aria-relevant="additions text"
        // Bottom-right, where a transient confirmation is conventionally
        // looked for and where it sits clear of the content. Centred below sm:
        // a toast is `w-full max-w-md`, so on a phone it spans the width anyway
        // and anchoring it to one edge only shifts its padding.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {items.map((item) => (
          <div
            key={item.id}
            onMouseEnter={() => pause(item.id)}
            onMouseLeave={() => resume(item.id)}
            onFocusCapture={() => pause(item.id)}
            onBlurCapture={() => resume(item.id)}
            className={cn(
              "flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-ui shadow-[var(--erx-shadow-lg)]",
              // Toasts land bottom-right, which is also where a page's sticky
              // primary action sits — the Categories "Apply changes" bar most
              // of all, and that is precisely the button a user reaches for
              // again after a toast tells them the save was refused. A toast
              // that swallows those clicks is worse than no toast.
              //
              // So the body lets clicks through and only the controls take
              // them. The exception is a toast carrying an action (Undo): its
              // timer must be pausable on hover to satisfy WCAG 2.2.1, which
              // needs pointer events on the body, and that kind is never
              // stacked over a sticky bar.
              item.action ? "pointer-events-auto" : "pointer-events-none",
              "transition-[opacity,transform] duration-[var(--erx-dur-fast)] ease-[var(--erx-ease-out)]",
              item.leaving ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100",
              item.tone === "error"
                ? "border-destructive/40 bg-destructive-subtle text-foreground"
                : "border-border bg-card text-foreground",
            )}
          >
            {item.tone === "error" ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            )}
            <span className="min-w-0 flex-1">{item.message}</span>
            {item.action && (
              <Button
                variant="ghost"
                size="sm"
                className="-my-1 shrink-0 font-semibold text-primary hover:text-primary"
                onClick={() => {
                  item.action?.onAction()
                  dismiss(item.id)
                }}
              >
                {item.action.label}
              </Button>
            )}
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t("common.dismiss")}
              className="pointer-events-auto -m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
