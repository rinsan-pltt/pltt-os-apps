import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Empty states come in two flavours and the app used to show the same one for
 * both: "you have nothing yet" (needs an invitation to start) and "your filters
 * matched nothing" (needs a way back out). Passing the right `variant` is the
 * difference between helpful and confusing.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "first-run",
  className,
}: {
  icon: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  variant?: "first-run" | "no-results"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl px-6 py-14 text-center",
        variant === "first-run"
          ? "border-2 border-dashed border-border bg-surface-sunken/50"
          : "border border-border bg-card",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full",
          variant === "first-run" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-heading text-foreground">{title}</p>
      {description && (
        <p className="max-w-[52ch] text-pretty text-body text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}
