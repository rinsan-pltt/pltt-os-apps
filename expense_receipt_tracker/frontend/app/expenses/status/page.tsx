"use client"

import * as React from "react"
import { Loader2, Search, SearchX } from "lucide-react"

import { useCategories, useCategoryLabel } from "@/components/categories-provider"
import { AppShell } from "@/components/layout/app-shell"
import { Alert } from "@/components/ui/alert"
import { useToast } from "@/components/ui/toast"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/layout/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { bulkUpdateStatus, listExpenses, type Expense, type ExpenseStatus } from "@/lib/api"
import { STATUSES } from "@/lib/categories"
import { useFormatters } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useT, useRegistryText } from "@/lib/i18n"

export default function BulkStatusPage() {
  const t = useT()
  const { toast } = useToast()
  const reg = useRegistryText()
  const { money, date } = useFormatters()
  const { categories } = useCategories()
  const categoryLabel = useCategoryLabel()

  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [categoryFilter, setCategoryFilter] = React.useState("all")
  const [expenses, setExpenses] = React.useState<Expense[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [targetStatus, setTargetStatus] = React.useState<ExpenseStatus>("submitted")
  const [applying, setApplying] = React.useState(false)

  // One request when typing settles, not one per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listExpenses({
        q: debouncedQuery || undefined,
        status: statusFilter,
        category: categoryFilter,
      })
      setExpenses(rows)
      // Drop selections that are no longer in view.
      setSelected((prev) => new Set(rows.filter((e) => prev.has(e.id)).map((e) => e.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bulkStatus.couldNotLoad"))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, statusFilter, categoryFilter])

  React.useEffect(() => {
    load()
  }, [load])

  const allSelected = expenses.length > 0 && expenses.every((e) => selected.has(e.id))
  const someSelected = selected.size > 0
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(expenses.map((e) => e.id)))
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const apply = async () => {
    if (selected.size === 0) return
    setApplying(true)
    setError(null)
    try {
      const res = await bulkUpdateStatus(Array.from(selected), targetStatus)
      setSelected(new Set())
      toast(t("bulkStatus.applied", { count: res.updated }))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bulkStatus.couldNotApply"))
    } finally {
      setApplying(false)
    }
  }

  return (
    <AppShell>
      <div className="w-full min-w-72 space-y-section px-gutter py-page-y">
        <PageHeader title={t("bulkStatus.title")} description={t("bulkStatus.subtitle")} />

        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <Field label={t("bulkStatus.search")}>
              {(p) => (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    {...p}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("dashboard.searchPlaceholder")}
                    className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground transition-[border-color,box-shadow] duration-[120ms] ease-out placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  />
                </div>
              )}
            </Field>
            <Field label={t("form.status")}>
              {(p) => (
                <Select {...p} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">{t("reports.allStatuses")}</option>
                  {STATUSES.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {reg.status(s.slug)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("form.category")}>
              {(p) => (
                <Select
                  {...p}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">{t("reports.allCategories")}</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {categoryLabel(c.slug)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </CardContent>
        </Card>

        {error && <Alert>{error}</Alert>}


        {loading ? (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title={t("bulkStatus.noneMatch")}
            description={t("bulkStatus.noneMatchHint")}
          />
        ) : (
          <div className="relative rounded-xl border border-border bg-card shadow-[var(--erx-shadow-sm)]">
            {/* Clipping lives here, on the table alone — not on the card. The
                card must stay unclipped for the sticky footer below to work
                (`overflow: hidden` on an ancestor silently disables
                `position: sticky`), but without clipping somewhere the table's
                square header corners poke out through the card's rounded ones. */}
            <div className={cn("overflow-hidden rounded-t-xl", selected.size > 0 && "pb-2")}>
              <table className="w-full text-sm">
                <caption className="sr-only">{t("bulkStatus.tableCaption")}</caption>
                <thead className="sticky top-0 z-10 bg-surface-sunken text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="w-12 px-4 py-2.5">
                      <input
                        type="checkbox"
                        className="ck"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allSelected && someSelected
                        }}
                        onChange={toggleAll}
                        aria-label={t("bulkStatus.selectAll")}
                        disabled={expenses.length === 0}
                      />
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-left font-medium">
                      {t("form.vendor")}
                    </th>
                    <th scope="col" className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">
                      {t("form.status")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      {t("form.amount")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {expenses.map((e) => {
                    const checked = selected.has(e.id)
                    return (
                      <tr
                        key={e.id}
                        className={checked ? "bg-accent/40" : "transition-colors hover:bg-accent/25"}
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            className="ck"
                            checked={checked}
                            onChange={() => toggleOne(e.id)}
                            aria-label={t("bulkStatus.selectRow", { vendor: e.vendor })}
                          />
                        </td>
                        <th scope="row" className="max-w-0 px-2 py-2.5 text-left font-normal">
                          <span className="block truncate font-medium">{e.vendor}</span>
                          <span className="block text-xs text-muted-foreground">
                            {date(e.expense_date)}
                          </span>
                        </th>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          <StatusBadge slug={e.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">
                          {money(e.amount, e.currency)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Only once there is a selection: an always-on bar sat over two
                rows offering "Update 0 selected". Flush with the card and
                opaque, so it reads as the card's own footer rather than a
                second box floating over the list. */}
            {selected.size > 0 && (
            <div className="sticky bottom-0 z-20 flex flex-col gap-4 rounded-b-xl border-t border-border bg-card px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
              <Field label={t("bulkStatus.newStatus")}>
                {(p) => (
                  <Select
                    {...p}
                    value={targetStatus}
                    onChange={(e) => setTargetStatus(e.target.value as ExpenseStatus)}
                    className="w-48"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {reg.status(s.slug)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground" aria-live="polite">
                  {t("bulkStatus.selectedOf", {
                    selected: selected.size,
                    total: expenses.length,
                  })}
                </span>
                <Button
                  size="lg"
                  onClick={apply}
                  disabled={selected.size === 0 || applying}
                  title={selected.size === 0 ? t("bulkStatus.selectSomething") : undefined}
                >
                  {applying ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />{" "}
                      {t("bulkStatus.applying")}
                    </>
                  ) : (
                    t("bulkStatus.apply", { count: selected.size })
                  )}
                </Button>
              </div>
            </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
