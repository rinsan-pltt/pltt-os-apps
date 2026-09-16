"use client"

import * as React from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/ui/section-card"
import { useFormatters } from "@/lib/format"
import { useExpenseCount, useT } from "@/lib/i18n"
import type { Expense } from "@/lib/api"
import { cn, sumByCurrency } from "@/lib/utils"

/**
 * Which days money went out on.
 *
 * A real `<table>` with weekday column headers rather than a grid of divs, so
 * the date structure survives for assistive tech. Days carrying expenses are
 * filled, with the weight following how many — never a currency total, because
 * the list holds mixed currencies and only the summary endpoint has exchange
 * rates. The exact per-currency amount is in each day's accessible label.
 */

/** Weeks rendered per month, always. A month occupies four, five or six
 *  depending on which weekday it opens on: February 2026 needs four, most need
 *  five, August 2026 needs six. Padding to the maximum keeps the grid — and so
 *  the card, and so the dashboard column beside it — the same height whichever
 *  month is on show. Sizing to the month made stepping through the calendar
 *  resize the box by up to 92px per click. Six is the true maximum: the worst
 *  case is a 31-day month opening on Saturday, six leading blanks plus 31 days
 *  = 37 cells. */
const WEEK_ROWS = 6

/** Weekday columns. Named so the padding arithmetic below reads as calendar
 *  geometry rather than a bare 7 and 42. */
const WEEK_LENGTH = 7

/** The cell box, shared by real days and the blanks that pad the grid.
 *
 *  Padding to six rows is not enough on its own: a `<td/>` holding nothing has
 *  no height, so a month whose sixth row was entirely blank still rendered
 *  40px shorter than one that used it. Giving the blanks the same box — sized
 *  from the same token, not a duplicated pixel value — is what actually makes
 *  every month the same height. */
const CELL_BOX =
  "mx-auto flex aspect-square w-full max-w-[var(--erx-cal-cell)] items-center justify-center rounded-full text-caption numeral"

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function isoOf(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

export interface DayRange {
  /** Inclusive ISO date the range starts on. */
  from: string
  /** Inclusive ISO date it ends on. Equal to `from` for a single day, and null
   *  while the user has clicked a start but not yet an end. */
  to: string | null
}

export function ExpenseCalendar({
  expenses,
  range = null,
  onPickDay,
}: {
  expenses: Expense[]
  /** The active filter, so the grid can show what is selected. */
  range?: DayRange | null
  /** Called with a day that HAS expenses. Omit to render a read-only calendar
   *  (which is what it was before this became a filter). */
  onPickDay?: (iso: string) => void
}) {
  const t = useT()
  const { locale, money } = useFormatters()
  const expenseCount = useExpenseCount()
  const [cursor, setCursor] = React.useState(() => startOfMonth(new Date()))
  // Once the user picks a month, that choice is theirs to keep.
  const steered = React.useRef(false)

  const byDay = React.useMemo(() => {
    const map = new Map<string, Expense[]>()
    for (const e of expenses) {
      const list = map.get(e.expense_date) ?? []
      list.push(e)
      map.set(e.expense_date, list)
    }
    return map
  }, [expenses])

  const busiest = React.useMemo(
    () => Math.max(1, ...Array.from(byDay.values(), (v) => v.length)),
    [byDay],
  )

  // A ledger is often sparse, and this month is frequently empty — opening on a
  // blank grid makes the panel look broken rather than informative. So on the
  // first load, if the current month holds nothing, fall back to the month of
  // the newest expense. The heading always names the month on show, and the
  // arrows still walk anywhere, so nothing is hidden by this.
  // Follow the selection: filtering to a day in another month and leaving the
  // grid behind would hide the very thing the user just picked.
  React.useEffect(() => {
    if (!range?.from) return
    steered.current = true
    const [y, m] = range.from.split("-").map(Number)
    setCursor((c) => (c.getFullYear() === y && c.getMonth() === m - 1 ? c : new Date(y, m - 1, 1)))
  }, [range?.from])

  React.useEffect(() => {
    if (steered.current || expenses.length === 0) return
    steered.current = true
    const prefix = isoOf(startOfMonth(new Date())).slice(0, 7)
    if (expenses.some((e) => e.expense_date.startsWith(prefix))) return
    const latest = expenses.reduce((a, b) => (a.expense_date >= b.expense_date ? a : b))
    const [year, month] = latest.expense_date.split("-").map(Number)
    setCursor(new Date(year, month - 1, 1))
  }, [expenses])

  // Short form: "September 2026" forced a 136px label which, with the two
  // arrows, could not fit the dashboard's narrow column.
  const monthLabel = cursor.toLocaleDateString(locale, { month: "short", year: "numeric" })
  const monthLabelLong = cursor.toLocaleDateString(locale, { month: "long", year: "numeric" })
  const todayIso = isoOf(new Date())

  // Weekday initials in the active locale, starting on Sunday.
  const weekdays = React.useMemo(() => {
    const base = new Date(2024, 8, 1) // a Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      return {
        short: d.toLocaleDateString(locale, { weekday: "narrow" }),
        long: d.toLocaleDateString(locale, { weekday: "long" }),
      }
    })
  }, [locale])

  // Pad to whole weeks so every row has seven cells.
  const weeks = React.useMemo(() => {
    const first = startOfMonth(cursor)
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null)
    for (let day = 1; day <= daysInMonth; day++)
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day))
    while (cells.length < WEEK_ROWS * WEEK_LENGTH) cells.push(null)
    const rows: (Date | null)[][] = []
    for (let i = 0; i < cells.length; i += WEEK_LENGTH)
      rows.push(cells.slice(i, i + WEEK_LENGTH))
    return rows
  }, [cursor])

  const monthPrefix = isoOf(startOfMonth(cursor)).slice(0, 7)
  const monthCount = expenses.reduce(
    (n, e) => (e.expense_date.startsWith(monthPrefix) ? n + 1 : n),
    0,
  )

  const shift = (months: number) => {
    steered.current = true
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + months, 1))
  }

  return (
    <SectionCard
      icon={CalendarDays}
      title={t("dashboard.calendar")}
      headingId="calendar-heading"
      action={
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={t("dashboard.prevMonth")}
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-0 px-0.5 text-center text-caption font-medium">{monthLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={t("dashboard.nextMonth")}
            onClick={() => shift(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </>
      }
      bodyClassName="mt-3"
    >
      <table className="w-full table-fixed border-separate border-spacing-x-1 border-spacing-y-1.5">
        <caption className="sr-only">{t("dashboard.calendarCaption", { month: monthLabelLong })}</caption>
        <thead>
          <tr>
            {weekdays.map((d, i) => (
              <th
                key={i}
                scope="col"
                className="pb-1 text-center text-micro font-medium text-muted-foreground"
              >
                <span aria-hidden>{d.short}</span>
                <span className="sr-only">{d.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => {
                if (!day)
                  return (
                    <td key={di} className="p-0 text-center">
                      {/* Holds the row open. aria-hidden and no real text, so
                          it adds nothing for a screen reader. */}
                      <span aria-hidden className={cn(CELL_BOX, "invisible")}>
                        0
                      </span>
                    </td>
                  )
                const iso = isoOf(day)
                const rows = byDay.get(iso)
                const count = rows?.length ?? 0
                const isToday = iso === todayIso
                // Three weights rather than a continuous ramp: with few
                // expenses a gradient is indistinguishable.
                const weight = count === 0 ? 0 : count >= busiest ? 3 : count > 1 ? 2 : 1
                const totals = rows ? sumByCurrency(rows) : []
                const label = count
                  ? t("dashboard.dayWithExpenses", {
                      date: day.toLocaleDateString(locale, { day: "numeric", month: "long" }),
                      count: expenseCount(count),
                      total: totals.map((x) => money(x.amount, x.currency)).join(", "),
                    })
                  : day.toLocaleDateString(locale, { day: "numeric", month: "long" })
                // Only days that carry expenses can be picked — selecting an
                // empty day would filter the dashboard to nothing.
                const selectable = count > 0 && !!onPickDay
                const inRange =
                  !!range &&
                  iso >= range.from &&
                  iso <= (range.to ?? range.from)
                const isEdge = !!range && (iso === range.from || iso === range.to)

                const cell = (
                  <>
                    {day.getDate()}
                    {selectable && <span className="sr-only">{t("dashboard.filterToDay")}</span>}
                  </>
                )
                const cellClass = cn(
                  CELL_BOX,
                  "transition-colors duration-[var(--erx-dur-instant)]",
                  weight === 0 && "text-muted-foreground",
                  weight === 1 && "bg-primary/15 font-medium text-foreground",
                  weight === 2 && "bg-primary/35 font-medium text-foreground",
                  weight === 3 && "bg-primary font-semibold text-primary-foreground",
                  // Selection has to beat the density fill, so it comes last.
                  // The ring reads on every weight, where another fill would
                  // be invisible against weight 3.
                  inRange && "ring-2 ring-primary ring-offset-1",
                  isEdge && "bg-primary font-semibold text-primary-foreground",
                  isToday && !inRange && "ring-2 ring-foreground ring-offset-1",
                  selectable &&
                    "cursor-pointer hover:ring-2 hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                )

                return (
                  <td key={di} className="p-0 text-center">
                    {selectable ? (
                      <button
                        type="button"
                        onClick={() => onPickDay(iso)}
                        title={label}
                        aria-label={label}
                        aria-pressed={inRange}
                        className={cellClass}
                      >
                        {cell}
                      </button>
                    ) : (
                      <span title={count ? label : undefined} aria-label={label} className={cellClass}>
                        {cell}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* A key for colours that aren't on screen is just noise, so an empty
          month says so plainly instead. */}
      {monthCount === 0 ? (
        <p className="mt-4 text-micro text-muted-foreground">
          {t("dashboard.calendarEmpty", { month: monthLabelLong })}
        </p>
      ) : (
        <p className="mt-4 flex items-center gap-3 text-micro text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-primary/15" />
            {t("dashboard.legendSome")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-primary" />
            {t("dashboard.legendBusiest")}
          </span>
        </p>
      )}
    </SectionCard>
  )
}
