"use client"

import * as React from "react"
import Link from "next/link"
import { usePlatform } from "@palettelab/sdk"
import { BarChart3, CalendarRange, Coins, ListFilter, Plus, Receipt, ScanLine, Wallet, X } from "lucide-react"

import { AddExpenseDialog } from "@/components/layout/add-expense-dialog"
import { AppShell } from "@/components/layout/app-shell"
import { type CommandAction } from "@/components/layout/command-palette"
import { DeltaChip } from "@/components/layout/delta-chip"
import { EmptyState } from "@/components/layout/empty-state"
import { ExpenseCalendar, type DayRange } from "@/components/layout/expense-calendar"
import { PageHeader } from "@/components/layout/page-header"
import { ReimbursementMeter } from "@/components/layout/reimbursement-meter"
import { RangeChart } from "@/components/layout/range-chart"
import { SpendChart } from "@/components/layout/spend-chart"
import { StatCard } from "@/components/layout/stat-card"
import { StatisticActivity } from "@/components/layout/statistic-activity"
import { useRegisterCommands } from "@/components/command-provider"
import { useSettings } from "@/components/settings-provider"
import { Alert } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { SectionCard } from "@/components/ui/section-card"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/toast"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { useExpenses } from "@/hooks/use-expenses"
import { getExpenseSummary, type ExpenseSummary } from "@/lib/api"
import { completedMonths, monthOverMonth } from "@/lib/expense-trend"
import { useFormatters } from "@/lib/format"
import { useExpenseCount, useT } from "@/lib/i18n"

/**
 * The overview.
 *
 * The ledger itself lives on its own route (`/expenses/history`), so this page
 * answers "how am I doing" rather than "show me every row": what is
 * outstanding, where the money went, which days it went out on, and the trend.
 *
 * Four figures in a 2×2 grid, the lead one filled and carrying the
 * reimbursement meter, with the chart beneath and the calendar and category
 * donut alongside.
 */
export default function DashboardPage() {
  const t = useT()
  const { toast } = useToast()
  const { money, number, date } = useFormatters()
  const expenseCount = useExpenseCount()
  const { revision: settingsRevision } = useSettings()
  const [formOpen, setFormOpen] = React.useState(false)
  const [chartMonths, setChartMonths] = React.useState(12)

  // The calendar doubles as the dashboard's filter. null = show everything,
  // which is the default and what "Show all" returns to.
  //
  // Click cycle: first click starts a range (and filters to that single day
  // straight away, so one click is useful on its own), second click closes it,
  // a third starts over. Clicking the open start again collapses it back to
  // that one day rather than doing nothing.
  const [range, setRange] = React.useState<DayRange | null>(null)

  const pickDay = React.useCallback((iso: string) => {
    setRange((prev) => {
      if (!prev) return { from: iso, to: iso }
      // A closed range: start a fresh one.
      if (prev.to !== null && prev.to !== prev.from) return { from: iso, to: iso }
      if (iso === prev.from) return { from: iso, to: iso }
      // Extend, ordering the ends so clicking backwards still works.
      return iso < prev.from ? { from: iso, to: prev.from } : { from: prev.from, to: iso }
    })
  }, [])

  // The signed-in user, straight off the Palette OS context — the same object
  // the host authenticates, so under the OS this is the real account name.
  //
  // Two things this deliberately does NOT do. It doesn't take the first word:
  // that turned the dev fixture "Palette Developer" into a greeting for
  // "Palette", and a name is not reliably "given name first" across locales, so
  // slicing one is a guess the host has already answered. And it doesn't cast
  // the context — `usePlatform()` is typed, so a rename in the SDK should break
  // the build here rather than silently resolve to undefined.
  //
  // `user` is typed non-null but is not guaranteed at runtime (the host is still
  // resolving the session, or a standalone dev boot supplies none), so a blank
  // name falls back to naming the page instead of greeting nobody.
  const { user } = usePlatform()
  const userName = user?.name?.trim()

  // One unfiltered load. The calendar needs EVERY expense to know which days
  // are selectable — feed it the filtered list and picking a day erases every
  // other day's mark, leaving nothing to click.
  const { expenses: allExpenses, summary: allSummary, loading, error, refresh, save } = useExpenses(
    {},
    settingsRevision,
  )

  const filtered = range !== null
  // One day selected puts CATEGORIES on the chart's x-axis; a span puts DATES
  // there. See RangeChart.
  const singleDay = filtered && (range!.to === null || range!.to === range!.from)
  const dateLabel = (iso: string) => date(iso)
  const from = range?.from ?? ""
  const to = range?.to ?? range?.from ?? ""

  // Narrowing the LIST needs no request: expense_date is a plain YYYY-MM-DD
  // string, so it compares lexicographically and no conversion is involved.
  const expenses = React.useMemo(
    () =>
      filtered
        ? allExpenses.filter((e) => e.expense_date >= from && e.expense_date <= to)
        : allExpenses,
    [allExpenses, filtered, from, to],
  )

  // The TOTALS do need the server: the figures are converted into the base
  // currency at each expense's own date, and only the backend has the rates.
  const [rangeSummary, setRangeSummary] = React.useState<ExpenseSummary | null>(null)
  React.useEffect(() => {
    if (!filtered) {
      setRangeSummary(null)
      return
    }
    let live = true
    setRangeSummary(null)
    getExpenseSummary({ dateFrom: from, dateTo: to })
      .then((s) => live && setRangeSummary(s))
      .catch(() => {
        // The unfiltered figures stay on screen; the range list below is still
        // correct, so this degrades rather than breaks.
      })
    return () => {
      live = false
    }
  }, [filtered, from, to, settingsRevision])

  const summary = filtered ? rangeSummary : allSummary

  const averageExpense =
    summary && summary.total_count > 0 ? summary.total_amount / summary.total_count : 0

  // Deltas compare the two most recently COMPLETED months. On the 2nd of the
  // month, "this month vs last month" is two days against thirty-one and reads
  // as a collapse that never happened.
  const closed = React.useMemo(() => completedMonths(summary?.by_month), [summary])
  const spendTrend = React.useMemo(() => monthOverMonth(closed, "amount"), [closed])
  const reimbursedTrend = React.useMemo(
    () => monthOverMonth(closed, "reimbursed_amount"),
    [closed],
  )

  // 12 bars by default; the 13th month the API returns exists only as the
  // delta's baseline, so it is never plotted.
  const series = React.useMemo(
    () =>
      summary?.by_month
        .slice(-Math.min(chartMonths, 12))
        .map((m) => ({ key: m.month, total: m.amount })),
    [summary, chartMonths],
  )

  // Nothing tracked yet: an overview of zeros, a blank calendar and no chart
  // tells a new user nothing and offers no way in. Show the way in instead.
  // "Nothing tracked yet" is a statement about the whole ledger, so it reads
  // the UNFILTERED figures. While a range is active an empty result means
  // "nothing in this range", which the range card says for itself.
  const isFirstRun =
    !filtered && !loading && allExpenses.length === 0 && (allSummary?.total_count ?? 0) === 0

  // The palette and its navigation entries live in CommandsProvider, so ⌘K
  // works on every route. "Add expense" opens a dialog only this page holds,
  // so the dashboard contributes that one while it is mounted.
  useRegisterCommands(
    "dashboard",
    React.useMemo<CommandAction[]>(
      () => [
        {
          id: "add",
          group: t("command.groupActions"),
          label: t("dashboard.addExpense"),
          run: () => setFormOpen(true),
        },
      ],
      [t],
    ),
  )

  useHotkeys([{ combo: "n", run: () => setFormOpen(true) }])

  return (
    <AppShell>
      {/* min-h-full + a flex-1 body: the dashboard fills the working area's
          height instead of stopping wherever its content happens to end. */}
      <div className="flex min-h-full w-full min-w-72 flex-col gap-section px-gutter py-page-y">
        <PageHeader
          title={userName ? t("dashboard.greeting", { name: userName }) : t("dashboard.title")}
          description={t("dashboard.subtitle")}
          actions={
            <>
              <Link href="/receipts/scan" className={buttonVariants({ variant: "outline" })}>
                <ScanLine className="size-4" aria-hidden /> {t("dashboard.scanReceipt")}
              </Link>
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="size-4" aria-hidden /> {t("dashboard.addExpense")}
              </Button>
            </>
          }
        />

        {error && (
          <Alert
            action={
              <Button variant="outline" size="sm" onClick={() => refresh()}>
                {t("common.retry")}
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {/* The escape hatch. A filter you cannot see is a filter you cannot
            undo, so while a range is active it is stated in words with a
            permanent way back to everything — the calendar's own toggle is not
            enough, because by then the picked day may be in a month the user
            has scrolled away from. */}
        {filtered && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border-strong bg-card px-4 py-3"
          >
            <CalendarRange className="size-4 shrink-0 text-primary" aria-hidden />
            <p className="min-w-0 flex-1 text-body">
              {range!.to && range!.to !== range!.from
                ? t("dashboard.showingRange", {
                    from: dateLabel(range!.from),
                    to: dateLabel(range!.to),
                  })
                : t("dashboard.showingDay", { date: dateLabel(range!.from) })}
              {expenses.length > 0 && (
                <span className="text-muted-foreground">
                  {" · "}
                  {expenseCount(expenses.length)}
                </span>
              )}
            </p>
            <Button variant="outline" size="sm" onClick={() => setRange(null)}>
              <X className="size-4" aria-hidden /> {t("dashboard.showAll")}
            </Button>
          </div>
        )}

        {isFirstRun ? (
          <EmptyState
            icon={Receipt}
            title={t("expenseList.emptyTitle")}
            description={t("expenseList.emptyHint")}
            action={
              <>
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="size-4" aria-hidden /> {t("dashboard.addExpense")}
                </Button>
                <Link href="/receipts/scan" className={buttonVariants({ variant: "outline" })}>
                  <ScanLine className="size-4" aria-hidden /> {t("dashboard.scanReceipt")}
                </Link>
              </>
            }
          />
        ) : (
          // No items-start: the two columns stretch to a shared height, and the
          // card marked flex-1 inside each absorbs the difference — otherwise
          // whichever column is shorter left a ragged gap under it.
          <div className="grid flex-1 gap-block xl:grid-cols-3">
            {/* ----------------------------------------------- primary column */}
            <div className="flex min-w-0 flex-col gap-block xl:col-span-2">
              {loading && !summary ? (
                <div className="grid gap-block lg:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton
                      key={i}
                      className={i === 0 ? "h-52 w-full rounded-2xl" : "h-40 w-full rounded-xl"}
                      style={{ ["--skeleton-i" as string]: i }}
                    />
                  ))}
                </div>
              ) : (
                summary && (
                  <div className="grid gap-block lg:grid-cols-2">
                    <StatCard
                      featured
                      icon={Wallet}
                      label={t("dashboard.owedToYou")}
                      value={money(summary.pending_amount, summary.base_currency)}
                      sublabel={t("dashboard.awaitingCount", {
                        count: number(summary.pending_count),
                      })}
                    >
                      <ReimbursementMeter summary={summary} onAccent />
                    </StatCard>

                    <StatCard
                      icon={Receipt}
                      label={t("dashboard.statTotal")}
                      value={money(summary.total_amount, summary.base_currency)}
                      sublabel={expenseCount(summary.total_count)}
                      delta={
                        <DeltaChip
                          trend={filtered ? null : spendTrend}
                          goodDirection="down"
                          currency={summary.base_currency}
                        />
                      }
                    />

                    <StatCard
                      icon={Coins}
                      label={t("dashboard.statReimbursed")}
                      value={money(summary.reimbursed_amount, summary.base_currency)}
                      sublabel={t("dashboard.settled", {
                        count: number(summary.reimbursed_count),
                      })}
                      tone="positive"
                      delta={
                        <DeltaChip
                          trend={filtered ? null : reimbursedTrend}
                          goodDirection="up"
                          currency={summary.base_currency}
                        />
                      }
                    />

                    <StatCard
                      icon={BarChart3}
                      label={t("dashboard.statAverage")}
                      value={money(averageExpense, summary.base_currency)}
                      sublabel={t("dashboard.perExpense")}
                    />
                  </div>
                )
              )}

              {summary?.converted && (
                <p className="text-caption text-muted-foreground">
                  {t("dashboard.convertedNote", {
                    base: summary.base_currency,
                    currencies: summary.converted_from.join(", "),
                  })}
                  {summary.approximate ? ` ${t("dashboard.approximateNote")}` : ""}
                </p>
              )}

              {loading && expenses.length === 0 ? (
                <Skeleton className="h-72 w-full rounded-xl" />
              ) : (
                summary &&
                expenses.length > 0 && (
                  <SectionCard
                    icon={filtered ? ListFilter : BarChart3}
                    title={
                      filtered
                        ? singleDay
                          ? t("dashboard.rangeByCategory")
                          : t("dashboard.rangeByDay")
                        : t("reports.chartOverTime")
                    }
                    headingId="spend-heading"
                    className="flex min-h-0 flex-1 flex-col"
                    bodyClassName="mt-4 flex min-h-0 flex-1 flex-col"
                    action={
                      // The month range only means anything for the trend.
                      filtered ? undefined : (
                        <Select
                          aria-label={t("dashboard.rangeLabel")}
                          value={String(chartMonths)}
                          onChange={(e) => setChartMonths(Number(e.target.value))}
                          className="h-9 w-auto rounded-full pl-3 text-caption font-medium"
                        >
                          <option value="6">{t("dashboard.range6")}</option>
                          <option value="12">{t("dashboard.range12")}</option>
                        </Select>
                      )
                    }
                  >
                    {filtered ? (
                      <RangeChart summary={summary} singleDay={singleDay} from={from} to={to} />
                    ) : (
                      <SpendChart
                        expenses={expenses}
                        months={series}
                        currency={summary.base_currency}
                        showTimeHeading={false}
                        fill
                        showCategories={false}
                      />
                    )}
                  </SectionCard>
                )
              )}
            </div>

            {/* --------------------------------------------- secondary column */}
            <div className="flex min-w-0 flex-col gap-block">
              {loading && expenses.length === 0 ? (
                <Skeleton className="h-96 w-full rounded-xl" />
              ) : (
                <ExpenseCalendar
                  expenses={allExpenses}
                  range={range}
                  onPickDay={pickDay}
                />
              )}
              {summary && (
                <StatisticActivity summary={summary} className="flex min-h-0 flex-1 flex-col" />
              )}
            </div>
          </div>
        )}
      </div>

      <AddExpenseDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaveSingle={async (fields, receipt) => {
          await save(fields, receipt)
          toast(t("dashboard.saved", { vendor: fields.vendor }))
        }}
        onImported={refresh}
      />

    </AppShell>
  )
}
