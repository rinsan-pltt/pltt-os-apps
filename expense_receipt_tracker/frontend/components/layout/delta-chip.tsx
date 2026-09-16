"use client"

import * as React from "react"
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"

import { useFormatters } from "@/lib/format"
import { useT } from "@/lib/i18n"
import type { MonthOverMonth } from "@/lib/expense-trend"
import { cn } from "@/lib/utils"

/**
 * "↗ 12.4% vs Aug" — a month-over-month change beside a figure.
 *
 * Three deliberate constraints:
 *
 *  1. The tone never means "good" or "bad" on its own. Direction is carried by
 *     the arrow icon, the sign and the named month; colour only reinforces it.
 *     Which direction is welcome depends on the figure — spending more is not
 *     an achievement, being reimbursed more is — so the caller says so with
 *     `goodDirection` rather than this component guessing.
 *  2. It renders money, not a percentage, when the baseline month was zero. A
 *     percentage against zero is undefined; "+100%" and "+∞%" are both made up.
 *  3. It names the comparison month instead of saying "vs last month", because
 *     the figure beside it is usually a lifetime total — "+12%" next to an
 *     all-time number invites reading it as growth in that total.
 */
export function DeltaChip({
  trend,
  goodDirection = "down",
  currency,
  className,
}: {
  trend: MonthOverMonth | null
  /** Which way is welcome for this figure. Spend: "down". Reimbursed: "up". */
  goodDirection?: "up" | "down"
  currency: string
  className?: string
}) {
  const t = useT()
  const { money, locale } = useFormatters()

  if (!trend) return null

  const { direction, ratio, change, previousMonth, approximate } = trend

  // A month that swallowed an unconvertible amount is comparing across
  // currencies. Say nothing rather than something wrong.
  if (approximate) return null

  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus
  const tone =
    direction === "flat" ? "neutral" : direction === goodDirection ? "positive" : "caution"

  // "2026-08" → "Aug", in the reader's locale.
  const [year, month] = previousMonth.split("-").map(Number)
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString(locale, { month: "short" })

  const magnitude =
    ratio === null
      ? money(Math.abs(change), currency)
      : `${Math.abs(ratio * 100).toFixed(1)}%`

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium numeral",
          tone === "positive" && "bg-success-subtle text-success",
          tone === "caution" && "bg-warning-subtle text-warning",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {direction === "flat" ? "" : direction === "up" ? "+" : "−"}
        {magnitude}
      </span>
      <span className="text-caption text-muted-foreground">
        {t("dashboard.vsMonth", { month: monthLabel })}
      </span>
    </span>
  )
}
