"use client"

import * as React from "react"

import { BarChart } from "@/components/layout/bar-chart"
import { CategoryDot } from "@/components/layout/category-badge"
import { useCategoryLabel } from "@/components/categories-provider"
import { useFormatters } from "@/lib/format"
import { useExpenseCount, useT } from "@/lib/i18n"
import type { Expense } from "@/lib/api"
import { sumByCurrency } from "@/lib/utils"

/**
 * Spend over time, and where it went.
 *
 * Hand-drawn SVG — no charting dependency for two series.
 *
 * The honest bit: a chart cannot add ₹785 to $12.40 any more than a total can.
 * Only the summary endpoint has exchange rates. So there are two modes:
 *
 *  - Given `months` (the dashboard, from `summary.by_month`), every currency is
 *    already converted to one base and all of it is plotted.
 *  - Without it (/reports, which applies user filters the summary endpoint
 *    cannot take), the chart falls back to bucketing `expenses` itself and can
 *    only plot ONE currency — the largest by total — and says so, rather than
 *    drawing a shape from numbers that were never commensurable.
 *
 * Every value is also available as text for assistive tech.
 */

function monthKey(iso: string) {
  return iso.slice(0, 7)
}

export function SpendChart({
  expenses,
  months: monthsProp,
  currency: currencyProp,
  showTimeHeading = true,
  fill = false,
  showCategories = true,
}: {
  expenses: Expense[]
  /** Pre-converted monthly totals, all in `currency` (i.e. summary.by_month).
   *  When supplied the time series plots these instead of bucketing `expenses`,
   *  so every currency is included rather than only the largest. Still needs
   *  `expenses` for the category list. */
  months?: { key: string; total: number }[]
  /** The currency `months` is denominated in (summary.base_currency). */
  currency?: string
  /** Off when an enclosing card header already names the series, so a screen
   *  reader doesn't hear the same heading twice. */
  showTimeHeading?: boolean
  /** Let the plot take whatever height its container gives it, down to a small
   *  floor. The dashboard needs this in both directions: it grows the chart to
   *  make its two columns end level on a tall window, and shrinks it so the
   *  whole page still fits a short one instead of scrolling. Off by default,
   *  because /reports renders this in ordinary block flow where `flex-1` is
   *  inert and a fixed, comfortable height is the right answer. */
  fill?: boolean
  /** The dashboard pairs this with the category donut, so it turns the
   *  category list off rather than saying the same thing twice. */
  showCategories?: boolean
}) {
  const t = useT()
  const { money, locale } = useFormatters()
  const expenseCount = useExpenseCount()
  const categoryLabel = useCategoryLabel()


  const currencies = React.useMemo(() => sumByCurrency(expenses), [expenses])
  const primary = currencyProp ?? currencies[0]?.currency ?? "USD"

  const inScope = React.useMemo(
    () => expenses.filter((e) => (e.currency || "USD").toUpperCase() === primary),
    [expenses, primary],
  )
  const excluded = expenses.length - inScope.length

  const derivedMonths = React.useMemo(() => {
    const buckets = new Map<string, number>()
    for (const e of inScope) buckets.set(monthKey(e.expense_date), (buckets.get(monthKey(e.expense_date)) ?? 0) + e.amount)
    return Array.from(buckets, ([key, total]) => ({ key, total }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(-12)
  }, [inScope])

  const months = monthsProp ?? derivedMonths

  const byCategory = React.useMemo(() => {
    const buckets = new Map<string, number>()
    for (const e of inScope) buckets.set(e.category, (buckets.get(e.category) ?? 0) + e.amount)
    return Array.from(buckets, ([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [inScope])

  // In summary mode the series is authoritative even when `expenses` is empty
  // for this currency; only bail when there is genuinely nothing to draw.
  if (months.length === 0 && inScope.length === 0) return null
  if (!monthsProp && inScope.length === 0) return null

  const peak = Math.max(...months.map((m) => m.total), 1)
  const catPeak = Math.max(...byCategory.map((c) => c.total), 1)

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: "short" })
  }

  const summary = t("reports.chartSummary", {
    count: months.length,
    currency: primary,
    peak: money(peak, primary),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-section">
      <div className="flex min-h-0 flex-1 flex-col">
        {(showTimeHeading || (excluded > 0 && !monthsProp)) && (
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-inline">
            {showTimeHeading && (
              <h3 className="text-overline uppercase text-muted-foreground">
                {t("reports.chartOverTime")}
              </h3>
            )}
            {/* Nothing is excluded in summary mode — everything was converted
                into one currency before it got here. */}
            {excluded > 0 && !monthsProp && (
              <p className="text-caption text-muted-foreground">
                {t("reports.chartCurrencyNote", {
                  currency: primary,
                  count: expenseCount(excluded),
                })}
              </p>
            )}
          </div>
        )}

        {/* One shared plot. The axis maths, ghost bars, container-query
            label thinning and the screen-reader table all live in BarChart
            now, because the calendar's range view needed the same chart with
            a different x-axis and a second copy would have to be kept in
            step by hand. */}
        <BarChart
          bars={months.map((m) => ({ key: m.key, label: monthLabel(m.key), value: m.total }))}
          currency={primary}
          ariaLabel={summary}
          caption={t("reports.chartOverTime")}
          keyHeader={t("form.date")}
          valueHeader={t("form.amount")}
          fill={fill}
        />
      </div>

      {showCategories && (
      <div>
        <h3 className="text-overline uppercase text-muted-foreground">
          {t("reports.chartByCategory")}
        </h3>
        <ul className="mt-3 space-y-2">
          {byCategory.map((row) => (
            <li key={row.category}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex min-w-0 items-center gap-inline">
                  <CategoryDot slug={row.category} />
                  <span className="truncate text-body">{categoryLabel(row.category)}</span>
                </span>
                <span className="shrink-0 text-body font-medium numeral">
                  {money(row.total, primary)}
                </span>
              </div>
              <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/35"
                  style={{ width: `${(row.total / catPeak) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
      )}
    </div>
  )
}
