"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { IconChip } from "@/components/ui/icon-chip"
import { cn } from "@/lib/utils"

/**
 * One figure, its label, and what changed.
 *
 * Replaces the old StatTile and the full-width balance panel it used to sit
 * under. `featured` is the grid's lead card: accent-filled, a rank of type
 * larger, and wearing the app's torn-receipt edge — the one signature device in
 * the product, kept to a single confident instance. It also takes `children`,
 * which is how the reimbursement meter stays inside the figure it describes
 * instead of becoming a panel of its own.
 *
 * `delta` is a slot rather than a number so this component never has to know
 * which direction is good news; see DeltaChip.
 */
export function StatCard({
  icon,
  label,
  value,
  sublabel,
  delta,
  tone = "default",
  featured = false,
  children,
  className,
}: {
  icon: LucideIcon
  label: string
  value: string
  sublabel?: string
  delta?: React.ReactNode
  tone?: "default" | "positive" | "warning"
  featured?: boolean
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col shadow-[var(--erx-shadow-sm)]",
        featured
          ? // The scallop is masked out of the bottom edge, so the extra bottom
            // padding is what keeps the teeth clear of the content above them.
            "receipt-edge rounded-2xl bg-accent p-surface pb-8 text-accent-foreground"
          : "rounded-xl border border-border-strong bg-card p-surface",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <IconChip
          icon={icon}
          size="sm"
          tone={tone === "default" ? (featured ? "neutral" : "default") : tone}
          // On the accent ground the chip's own tint is invisible; borrow the
          // card's ink at low opacity instead of inventing a colour.
          className={featured ? "bg-foreground/10 text-accent-foreground" : undefined}
        />
        {/* Wraps rather than truncates: "AVERAGE EXPE…" tells the reader
            less than two short lines do, and the grid equalises row heights
            anyway so a second line costs nothing. */}
        <span
          className={cn(
            "min-w-0 text-overline uppercase leading-tight",
            featured ? "opacity-70" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </div>

      {/* The lead card gets one step up, not the old panel's fluid `.figure`
          clamp: that scaled on 8.5vw, and in a half-width grid cell a long
          figure (₩487,278,866) would need ~310px at its 48px ceiling and clip.
          Two fixed steps give the same hierarchy and always fit. */}
      <p className={cn("mt-3 truncate numeral", featured ? "text-title" : "text-figure-sm")}>
        {value}
      </p>

      {sublabel && (
        <p
          className={cn(
            "mt-1 truncate text-caption",
            featured ? "opacity-70" : "text-muted-foreground",
          )}
        >
          {sublabel}
        </p>
      )}

      {delta && <div className="mt-2.5">{delta}</div>}

      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}
