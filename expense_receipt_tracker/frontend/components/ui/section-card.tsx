import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { IconChip } from "@/components/ui/icon-chip"
import { cn } from "@/lib/utils"

/**
 * A titled surface: icon chip and heading on the left, one control on the right.
 *
 * Four places built this by hand from the same
 * `rounded-xl border border-border-strong bg-card p-surface shadow-…` string
 * (the calendar, the category donut, the dashboard chart and the stat tiles),
 * which is how their headers drifted apart. This is that shape, once.
 *
 * `level` exists because cards are sections under the page's <h1>, and a card
 * nested inside another card is a rank lower — colour and size alone don't tell
 * a screen reader anything about depth.
 */
export function SectionCard({
  icon,
  title,
  level = 2,
  headingId,
  action,
  children,
  className,
  bodyClassName,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  level?: 2 | 3 | 4
  headingId?: string
  /** A single control — a select, a pair of arrows — aligned to the far right. */
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  const Heading = `h${level}` as "h2" | "h3" | "h4"
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "rounded-xl border border-border-strong bg-card p-surface shadow-[var(--erx-shadow-sm)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-inline">
        <Heading id={headingId} className="flex min-w-0 items-center gap-2.5 text-heading">
          {icon && <IconChip icon={icon} size="sm" />}
          <span className="min-w-0 truncate">{title}</span>
        </Heading>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      <div className={cn("mt-4", bodyClassName)}>{children}</div>
    </section>
  )
}
