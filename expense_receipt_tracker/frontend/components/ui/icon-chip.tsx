import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The small tinted icon badge that opens every card header and stat card.
 *
 * Purely decorative — it repeats the meaning of the heading beside it, so it is
 * always `aria-hidden` and never the only thing carrying a distinction. Tones
 * map onto existing semantic tokens; there is no chip-specific palette.
 */
export function IconChip({
  icon: Icon,
  tone = "default",
  size = "md",
  className,
}: {
  icon: LucideIcon
  tone?: "default" | "positive" | "warning" | "neutral"
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "sm" ? "size-7" : "size-9",
        tone === "default" && "bg-primary/10 text-primary",
        tone === "positive" && "bg-success-subtle text-success",
        tone === "warning" && "bg-warning-subtle text-warning",
        tone === "neutral" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  )
}
