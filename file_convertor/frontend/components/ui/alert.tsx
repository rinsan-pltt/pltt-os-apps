"use client"

import * as React from "react"
import { CheckCircle2, Info, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * An inline status banner.
 *
 * This exists because the same markup was pasted into the workspaces 22 times:
 * the error variant 16 times (byte-identical, in 11 files) and the success
 * variant 6 times — the latter with hardcoded `emerald-*` classes, because the
 * old token set defined `--destructive` and nothing else.
 *
 * Every one of those copies was also silent to assistive technology. There was
 * not a single `role="alert"`, `role="status"` or `aria-live` anywhere in the
 * component tree, so a conversion failing, a document finishing, or "8 fixes
 * applied" produced no announcement at all. The live region is built in here
 * rather than left to each caller, which is what makes it actually happen.
 *
 * `role` follows the tone: an error is assertive because the user's action
 * failed and they need to know now; a success is polite so it does not
 * interrupt whatever they are typing next.
 */
const TONES = {
  error: {
    role: "alert" as const,
    live: "assertive" as const,
    icon: TriangleAlert,
    surface: "border-destructive/40 bg-destructive-subtle",
    iconColor: "text-destructive",
    textColor: "text-destructive-text",
  },
  success: {
    role: "status" as const,
    live: "polite" as const,
    icon: CheckCircle2,
    surface: "border-success/40 bg-success-subtle",
    iconColor: "text-success",
    textColor: "text-success-text",
  },
  info: {
    role: "status" as const,
    live: "polite" as const,
    icon: Info,
    surface: "border-border bg-info-subtle",
    iconColor: "text-info",
    textColor: "text-foreground",
  },
} as const

export function Alert({
  tone = "error",
  children,
  action,
  className,
}: {
  tone?: keyof typeof TONES
  children: React.ReactNode
  /** A recovery affordance — "Try again", "Download again". Sits at the end of
   *  the row, and wraps onto its own line rather than crushing the message. */
  action?: React.ReactNode
  className?: string
}) {
  const { role, live, icon: Icon, surface, iconColor, textColor } = TONES[tone]
  return (
    <div
      role={role}
      aria-live={live}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-ui",
        surface,
        className,
      )}
    >
      <Icon className={cn("size-4 shrink-0", iconColor)} aria-hidden />
      <span className={cn("min-w-0 flex-1 text-pretty", textColor)}>{children}</span>
      {action}
    </div>
  )
}
