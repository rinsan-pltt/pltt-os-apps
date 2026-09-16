/**
 * Month-over-month deltas for the dashboard's stat chips. Pure — no React.
 *
 * Input is `summary.by_month`: already converted to the base currency, always
 * the last 13 calendar months oldest-first, with zero-activity months included.
 *
 * The rule this file exists to enforce: never show a percentage the data cannot
 * support. A percentage needs a non-zero baseline, and a month with no spend
 * has none — both "+∞%" and "+100%" would be inventions. The absolute change is
 * still true in that case, so it comes back with `ratio: null` and the caller
 * renders money only.
 */

import type { ExpenseMonth } from "@/lib/api"

export type TrendMetric = "amount" | "reimbursed_amount"

export interface MonthOverMonth {
  /** "YYYY-MM" of the month being reported on. */
  month: string
  /** "YYYY-MM" of the baseline — always the immediately preceding calendar
   *  month. The backend emits idle months as zeros precisely so this can never
   *  silently slide to two months ago while still saying "last month". */
  previousMonth: string
  current: number
  previous: number
  /** current - previous, signed, in the base currency. */
  change: number
  /** change / previous, or null when `previous` is 0 — undefined, not
   *  infinite. Callers MUST render money-only when this is null. */
  ratio: number | null
  /** Sign of `change`, with an explicit exact-zero case. Carries no value
   *  judgement: "up" is bad for spend and good for reimbursements, so the tone
   *  is the caller's decision, not this function's. */
  direction: "up" | "down" | "flat"
  /** Either month held an amount that had no exchange rate, so the comparison
   *  mixes currencies. Caveat it, or don't show it. */
  approximate: boolean
}

/**
 * Compare the last two entries of `byMonth`.
 *
 * Returns null when there is nothing honest to say: fewer than two months (a
 * brand-new install, or a payload from a backend without `by_month`), or both
 * months zero — "no change from nothing to nothing" is noise, not information.
 *
 * Note the caller's choice of window. The dashboard passes
 * `completedMonths(...)` rather than the raw array, because on the 2nd of the
 * month "this month vs last month" compares two days against thirty-one and
 * reads as a collapse that never happened.
 */
export function monthOverMonth(
  byMonth: ExpenseMonth[] | undefined,
  metric: TrendMetric = "amount",
): MonthOverMonth | null {
  if (!byMonth || byMonth.length < 2) return null

  const current = byMonth[byMonth.length - 1]
  const previous = byMonth[byMonth.length - 2]
  const a = current[metric]
  const b = previous[metric]

  if (a === 0 && b === 0) return null

  const change = a - b
  return {
    month: current.month,
    previousMonth: previous.month,
    current: a,
    previous: b,
    change,
    // `> 0`, not `!== 0`: amounts are non-negative by construction (the API
    // rejects a negative amount), and a negative baseline would flip the sign
    // of the percentage without flipping `direction`.
    ratio: b > 0 ? change / b : null,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
    approximate: current.approximate || previous.approximate,
  }
}

/**
 * Drop the month in progress.
 *
 * The current month is partial for all but one day of it, so comparing it with
 * a whole month is not a like-for-like rate — early in the month every figure
 * looks like a crash. Month-granularity data cannot fix that, so the chip
 * compares the two most recently *completed* months instead and names them.
 */
export function completedMonths(byMonth: ExpenseMonth[] | undefined): ExpenseMonth[] | undefined {
  if (!byMonth || byMonth.length === 0) return byMonth
  return byMonth.slice(0, -1)
}
