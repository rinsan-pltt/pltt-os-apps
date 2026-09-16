import * as React from "react"
import { AlertCircle, CheckCircle2, Info } from "lucide-react"

import { cn } from "@/lib/utils"

const TONES = {
  error: {
    role: "alert" as const,
    icon: AlertCircle,
    surface: "border-destructive/40 bg-destructive-subtle",
    icon_color: "text-destructive",
  },
  success: {
    role: "status" as const,
    icon: CheckCircle2,
    surface: "border-border bg-success-subtle",
    icon_color: "text-success",
  },
  info: {
    role: "status" as const,
    icon: Info,
    surface: "border-border bg-info-subtle",
    icon_color: "text-info",
  },
}

/**
 * An inline banner. Three routes had copy-pasted the error variant — each with
 * its own hardcoded radius, so they drifted off the surface scale.
 *
 * `role` follows the tone rather than being a caller's choice: an error is
 * assertive because the user's action failed and they need to know now, while a
 * success is polite so it doesn't interrupt whatever they typed next.
 */
export function Alert({
  tone = "error",
  children,
  action,
  className,
}: {
  tone?: keyof typeof TONES
  children: React.ReactNode
  /** A recovery affordance — "Try again". Sits at the far end of the row. */
  action?: React.ReactNode
  className?: string
}) {
  const { role, icon: Icon, surface, icon_color } = TONES[tone]
  return (
    <div
      role={role}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-body",
        surface,
        className,
      )}
    >
      <Icon className={cn("size-4 shrink-0", icon_color)} aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}
