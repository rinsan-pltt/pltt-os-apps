"use client"

import { Loader2 } from "lucide-react"

import { ProgressBar } from "@/components/ui/progress-bar"
import { cn } from "@/lib/utils"

/**
 * "Still working" — the spinner, the plain-language line and the indeterminate
 * bar, together.
 *
 * The same three elements were assembled by hand in eight workspaces, and two
 * more (`organize` and `edit`) rendered spinner text with *no* bar at all — on
 * the two longest-running operations in the app, which is exactly where the
 * user most needs to see that something is happening.
 *
 * `aria-live="polite"` plus `aria-busy` are the point: a screen-reader user
 * previously got silence for the entire duration of a conversion.
 */
export function BusyPanel({
  label,
  detail,
  className,
}: {
  /** What is happening, in the user's language — "Converting…", not "Working". */
  label: string
  /** Optional second line: which step, which page, how many files. */
  detail?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("grid gap-2 rounded-lg border border-border bg-muted/40 p-3", className)}
    >
      <p className="flex items-center gap-2 text-ui text-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
        <span className="min-w-0">{label}</span>
      </p>
      {detail && <p className="pl-6 text-caption text-muted-foreground">{detail}</p>}
      {/* The bar already carries the label above, so don't announce it twice. */}
      <ProgressBar label={label} />
    </div>
  )
}
