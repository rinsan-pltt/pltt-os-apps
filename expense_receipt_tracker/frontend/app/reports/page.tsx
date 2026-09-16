"use client"

import * as React from "react"
import { AlertCircle, Download, FileSpreadsheet, FileText, Loader2, SearchX } from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { Menu } from "@/components/ui/menu"
import { SpendChart } from "@/components/layout/spend-chart"
import { useCategories, useCategoryLabel } from "@/components/categories-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/toast"
import {
  downloadBlob,
  exportReport,
  listExpenses,
  type Expense,
  type ExportFormat,
} from "@/lib/api"
import { STATUSES } from "@/lib/categories"
import { useFormatters } from "@/lib/format"
import { useExpenseCount, useT, useRegistryText } from "@/lib/i18n"
import { cn, sumByCurrency } from "@/lib/utils"

/** Quick ranges. These only set the existing dateFrom/dateTo state — same two
 *  query params, no new API surface. */
type PresetId = "thisMonth" | "lastMonth" | "quarter" | "ytd"

function presetRange(id: PresetId): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  /**
   * No preset ever ends in the future.
   *
   * "This month" and "This quarter" ran to the last day of the period, so on
   * the 8th the To field read the 30th — a date the report cannot possibly
   * cover, and one that makes a period still in progress look complete.
   * Applied to every preset rather than just those two, so the rule holds for
   * any range added later; on the ones that already end in the past it is a
   * no-op.
   */
  const untilToday = (d: Date) => (d > now ? now : d)

  switch (id) {
    case "thisMonth":
      return { from: iso(new Date(y, m, 1)), to: iso(untilToday(new Date(y, m + 1, 0))) }
    case "lastMonth":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(untilToday(new Date(y, m, 0))) }
    case "quarter": {
      const qStart = Math.floor(m / 3) * 3
      return {
        from: iso(new Date(y, qStart, 1)),
        to: iso(untilToday(new Date(y, qStart + 3, 0))),
      }
    }
    case "ytd":
      return { from: iso(new Date(y, 0, 1)), to: iso(untilToday(now)) }
  }
}

export default function ReportsPage() {
  const t = useT()
  const reg = useRegistryText()
  const { toast } = useToast()
  const { money, date } = useFormatters()
  const expenseCount = useExpenseCount()
  const { categories } = useCategories()
  const categoryLabel = useCategoryLabel()
  const [category, setCategory] = React.useState("all")
  const [status, setStatus] = React.useState("all")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [preview, setPreview] = React.useState<Expense[]>([])
  const [loading, setLoading] = React.useState(true)
  const [exporting, setExporting] = React.useState<ExportFormat | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    listExpenses({ category, status, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined })
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("reports.couldNotLoad"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, status, dateFrom, dateTo])

  // Was: preview.reduce((s, e) => s + e.amount, 0) rendered as USD. That adds
  // a ₹785 receipt to a $12.40 one and labels the result in dollars — a number
  // that is simply false. Only the summary endpoint has exchange rates, and it
  // doesn't take these filters, so the honest answer is one line per currency.
  const totals = sumByCurrency(preview)

  const applyPreset = (id: PresetId) => {
    const range = presetRange(id)
    setDateFrom(range.from)
    setDateTo(range.to)
  }

  const activePreset = (id: PresetId) => {
    const range = presetRange(id)
    return dateFrom === range.from && dateTo === range.to
  }

  const handleExport = async (format: ExportFormat) => {
    setExporting(format)
    setError(null)
    try {
      const { blob, filename } = await exportReport({
        category,
        status,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        format,
      })
      downloadBlob(blob, filename)
      toast(t("reports.exported", { filename }))
    } catch (e) {
      const message = e instanceof Error ? e.message : t("reports.couldNotExport")
      setError(message)
      toast(message, { tone: "error" })
    } finally {
      setExporting(null)
    }
  }

  const nothingToExport = preview.length === 0
  const exportBlockedReason = nothingToExport ? t("reports.nothingToExport") : undefined

  const presets: { id: PresetId; label: string }[] = [
    { id: "thisMonth", label: t("reports.presetThisMonth") },
    { id: "lastMonth", label: t("reports.presetLastMonth") },
    { id: "quarter", label: t("reports.presetQuarter") },
    { id: "ytd", label: t("reports.presetYtd") },
  ]

  return (
    <AppShell>
      <div className="w-full min-w-72 space-y-section px-gutter py-page-y">
        <PageHeader
          title={t("reports.title")}
          description={t("reports.subtitle")}
          actions={
            <Menu
              icon={exporting ? Loader2 : Download}
              label={exporting ? t("reports.exporting") : t("reports.export")}
              disabled={nothingToExport || exporting !== null}
              title={exportBlockedReason}
              items={[
                {
                  id: "csv",
                  label: t("reports.asCsv"),
                  hint: t("reports.asCsvHint"),
                  icon: FileSpreadsheet,
                  run: () => handleExport("csv"),
                },
                {
                  id: "xlsx",
                  label: t("reports.asExcel"),
                  hint: t("reports.asExcelHint"),
                  icon: FileSpreadsheet,
                  run: () => handleExport("xlsx"),
                },
                {
                  id: "pdf",
                  label: t("reports.asPdf"),
                  hint: t("reports.asPdfHint"),
                  icon: FileText,
                  run: () => handleExport("pdf"),
                },
              ]}
            />
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>{t("reports.filters")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("form.category")}>
                {(p) => (
                  <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="all">{t("reports.allCategories")}</option>
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {categoryLabel(c.slug)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("form.status")}>
                {(p) => (
                  <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="all">{t("reports.allStatuses")}</option>
                    {STATUSES.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {reg.status(s.slug)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("reports.from")}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t("reports.to")}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("reports.quickRanges")}</span>
              {presets.map((preset) => {
                const active = activePreset(preset.id)
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyPreset(preset.id)}
                    className={cn(
                      // A pill, matching the button language everywhere else.
                      "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground",
                    )}
                  >
                    {preset.label}
                  </button>
                )
              })}
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => {
                    setDateFrom("")
                    setDateTo("")
                  }}
                >
                  {t("reports.clearDates")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {!loading && preview.length > 0 && (
          <Card>
            <CardContent className="p-surface">
              <SpendChart expenses={preview} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <CardTitle>
              {loading ? t("reports.loading") : expenseCount(preview.length)}
            </CardTitle>
            {!loading && totals.length > 0 && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("reports.totalLabel")}
                </div>
                {/* One currency gets the headline treatment; several are listed
                    compactly so the total never outweighs the card's title. */}
                {totals.length === 1 ? (
                  <div className="text-lg font-semibold tabular-nums">
                    {money(totals[0].amount, totals[0].currency)}
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-end gap-x-2 gap-y-0.5 text-sm font-semibold tabular-nums">
                    {totals.map((total, i) => (
                      <span key={total.currency}>
                        {money(total.amount, total.currency)}
                        {i < totals.length - 1 && (
                          <span aria-hidden className="ml-2 text-muted-foreground">
                            ·
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {totals.length > 1 && (
                  <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {t("reports.mixedCurrencies")}
                  </p>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p role="alert" className="flex items-center gap-2 text-sm font-medium text-destructive-text">
                <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
              </p>
            )}

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : preview.length === 0 ? (
              <EmptyState
                variant="no-results"
                icon={SearchX}
                title={t("reports.noMatch")}
                description={t("reports.noMatchHint")}
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("reports.tableCaption")}</caption>
                  <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        {t("form.vendor")}
                      </th>
                      <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">
                        {t("form.date")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t("form.amount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.slice(0, 50).map((e) => (
                      <tr key={e.id}>
                        <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
                          <span className="block truncate">{e.vendor}</span>
                        </th>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground sm:table-cell">
                          {date(e.expense_date)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {money(e.amount, e.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 50 && (
                  <p className="border-t border-border bg-surface-sunken px-3 py-2 text-center text-xs text-muted-foreground">
                    {t("reports.andMore", { count: preview.length - 50 })}
                  </p>
                )}
              </div>
            )}

            {nothingToExport && !loading && (
              <p className="text-center text-xs text-muted-foreground">{exportBlockedReason}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
