"use client"

import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Indeterminate progress bar — a clear, always-moving "still working" signal
 *  for long-running conversions/generations, independent of any spinner icon.
 *  Styling/animation lives in globals.css (`.fc-progress-track`), which also
 *  makes it a static filled bar under `prefers-reduced-motion`.
 *
 *  The label used to be a hardcoded English `aria-label="Working"` — in an app
 *  that ships Korean. It now comes from the translation table, and a caller
 *  that knows what is happening ("Converting…") should say so. */
export function ProgressBar({ label, className }: { label?: string; className?: string }) {
  const t = useT()
  return (
    <div
      className={cn("fc-progress-track", className)}
      role="progressbar"
      aria-label={label ?? t("common.working")}
      aria-busy="true"
    />
  )
}
