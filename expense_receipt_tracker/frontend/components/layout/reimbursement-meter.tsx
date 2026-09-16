"use client"

import * as React from "react"

import { useFormatters } from "@/lib/format"
import { useT } from "@/lib/i18n"
import type { ExpenseSummary } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * How much of what you spent has come back, as a bar plus its two figures.
 *
 * Lifted out of the old full-width balance panel when the dashboard moved to a
 * 2×2 card grid; the panel's accessible contract is kept verbatim, because the
 * bar is the one thing here that a sighted reader gets for free and a screen
 * reader does not: `role="progressbar"` with an `aria-valuetext` that spells
 * out "X of Y reimbursed" rather than reading a bare percentage.
 *
 * The split is exact, not an approximation: the backend defines
 * `pending_amount` as pending + submitted and `reimbursed_amount` as the rest,
 * and those three statuses are exhaustive, so the two segments always sum to
 * `total_amount` (see backend/api/routes/expenses.py::expenses_summary).
 */
export function ReimbursementMeter({
  summary,
  /** True when the meter sits on the accent-filled featured card. --muted is
   *  within 0.007 lightness of --accent, so the default track would simply
   *  disappear there. */
  onAccent = false,
}: {
  summary: ExpenseSummary
  onAccent?: boolean
}) {
  const t = useT()
  const { money } = useFormatters()

  const { base_currency: currency, total_amount, pending_amount, reimbursed_amount } = summary
  // Guard the divide: a fresh install has no expenses at all.
  const reimbursedShare = total_amount > 0 ? (reimbursed_amount / total_amount) * 100 : 0

  const meterLabel = t("dashboard.meterLabel", {
    reimbursed: money(reimbursed_amount, currency),
    total: money(total_amount, currency),
  })

  return (
    <div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(reimbursedShare)}
        aria-valuetext={meterLabel}
        aria-label={t("dashboard.meterAria")}
        className={cn(
          "h-2.5 w-full overflow-hidden rounded-full",
          onAccent ? "bg-foreground/10" : "bg-muted",
        )}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${reimbursedShare}%`, backgroundImage: "var(--erx-brand-gradient)" }}
        />
      </div>

      {/* One line, two segments. The settled COUNT lives on the Reimbursed card
          beside this one; repeating it here only cost the lead card a second
          line of height, which is what made it tower over its neighbours in
          the 2x2. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundImage: "var(--erx-brand-gradient)" }}
          />
          <span className="opacity-70">{t("dashboard.statReimbursed")}</span>
          <span className="font-medium numeral">{money(reimbursed_amount, currency)}</span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-current opacity-30" />
          <span className="opacity-70">{t("dashboard.outstanding")}</span>
          <span className="font-medium numeral">{money(pending_amount, currency)}</span>
        </span>
      </div>
    </div>
  )
}
