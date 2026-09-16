"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Receipt, ScanLine, SearchX } from "lucide-react"

import { AddExpenseDialog } from "@/components/layout/add-expense-dialog"
import { useSettings } from "@/components/settings-provider"
import { AppShell } from "@/components/layout/app-shell"
import { Alert } from "@/components/ui/alert"
import { EmptyState } from "@/components/layout/empty-state"
import { ExpenseFilters } from "@/components/layout/expense-filters"
import { ExpenseFormDialog } from "@/components/layout/expense-form-dialog"
import { BulkActionBar } from "@/components/layout/bulk-action-bar"
import { ExpenseTable, ExpenseTableSkeleton } from "@/components/layout/expense-table"
import { useCategoryLabel } from "@/components/categories-provider"
import { useLocale } from "@/lib/format"
import { compareExpenses } from "@/lib/expense-ledger"
import { CommandPalette, type CommandAction } from "@/components/layout/command-palette"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { PageHeader } from "@/components/layout/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { UNDO_WINDOW_MS, useExpenses } from "@/hooks/use-expenses"
import type { Expense, ExpenseInput, ExpenseStatus } from "@/lib/api"
import { useRegistryText, useT } from "@/lib/i18n"
import { STATUSES } from "@/lib/categories"
import { urlParse, useUrlState } from "@/hooks/use-url-state"
import type { SortDir, SortKey } from "@/lib/expense-ledger"

const SORT_KEYS = ["date", "vendor", "category", "status", "amount"] as const

/** Anything a hand-typed URL could contain is validated here, so this page can
 *  never be pushed into a state the backend rejects (a malformed date is a
 *  422). An invalid value silently falls back to the default. */
const LEDGER_URL_SPEC = {
  q: { default: "", parse: urlParse.text(200) },
  status: { default: "all", parse: urlParse.oneOf(["all", ...STATUSES.map((s) => s.slug)]) },
  category: { default: "all" },
  sort: { default: "date", parse: urlParse.oneOf(SORT_KEYS) },
  dir: { default: "desc", parse: urlParse.oneOf(["asc", "desc"]) },
} as const

export default function ExpenseHistoryPage() {
  const t = useT()
  const reg = useRegistryText()
  const router = useRouter()
  const { toast } = useToast()
  const { revision: settingsRevision } = useSettings()
  // Filters live in the URL so they survive a reload and a trip to another
  // page and back. `queryDraft` holds keystrokes; only the settled value is
  // written, or every character would push a history entry and a refetch.
  const [urlState, setUrlState] = useUrlState(LEDGER_URL_SPEC)
  const { q: query, status, category, sort, dir } = urlState
  const [queryDraft, setQueryDraft] = React.useState(query)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Expense | null>(null)

  // draft -> URL, once typing settles.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (queryDraft !== query) setUrlState({ q: queryDraft })
    }, 250)
    return () => clearTimeout(timer)
  }, [queryDraft, query, setUrlState])

  // URL -> draft, for Back/forward and "Clear filters". The inequality guard
  // above is what stops these two effects from ping-ponging; it looks
  // removable and is not.
  React.useEffect(() => {
    setQueryDraft(query)
  }, [query])

  const {
    expenses: rows,
    summary,
    loading,
    refreshing,
    error,
    refresh,
    save,
    edit,
    remove,
    removeMany,
    setStatusFor,
    undo,
  } = useExpenses(
        { category, status, q: query },
      settingsRevision,
    )

  const initialForEdit: Partial<ExpenseInput> | undefined = editing
    ? {
        vendor: editing.vendor,
        amount: editing.amount,
        currency: editing.currency,
        category: editing.category,
        expense_date: editing.expense_date,
        status: editing.status,
        notes: editing.notes ?? undefined,
      }
    : undefined

  // Sorted on the client: the full filtered set is already in memory, so this
  // is instant with no round trip — and category has to sort by the label the
  // user is actually reading, which is per-organisation and per-language. The
  // server knows neither, so it could only ever sort by slug.
  const locale = useLocale()
  const categoryLabel = useCategoryLabel()
  const expenses = React.useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true })
    return [...rows].sort(
      compareExpenses(sort as SortKey, dir as SortDir, collator, categoryLabel),
    )
  }, [rows, sort, dir, locale, categoryLabel])

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  // Drop selections for rows that are no longer in view.
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(expenses.map((e) => e.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [expenses])

  const toggleRow = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = React.useCallback(() => {
    setSelected((prev) =>
      prev.size === expenses.length ? new Set() : new Set(expenses.map((e) => e.id)),
    )
  }, [expenses])

  const cycleSort = React.useCallback(
    (key: SortKey) => {
      // Same column flips direction; a new column starts descending, which is
      // what people want for dates and money.
      if (key === sort) setUrlState({ dir: dir === "asc" ? "desc" : "asc" })
      else setUrlState({ sort: key, dir: "desc" })
    },
    [sort, dir, setUrlState],
  )

  const selectedRows = React.useMemo(
    () => expenses.filter((e) => selected.has(e.id)),
    [expenses, selected],
  )

  const handleBulkStatus = async (next: ExpenseStatus) => {
    const ids = selectedRows.map((e) => e.id)
    if (ids.length === 0) return
    try {
      const undoStatus = await setStatusFor(ids, next)
      setSelected(new Set())
      toast(t("ledger.bulkUpdated", { count: ids.length }), {
        duration: UNDO_WINDOW_MS,
        action: { label: t("ledger.undo"), onAction: () => void undoStatus() },
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : t("form.couldNotSave"), { tone: "error" })
    }
  }

  const handleBulkDelete = () => {
    if (selectedRows.length === 0) return
    const count = selectedRows.length
    const token = removeMany(selectedRows)
    setSelected(new Set())
    toast(t("ledger.bulkDeleted", { count }), {
      duration: UNDO_WINDOW_MS,
      action: { label: t("ledger.undo"), onAction: () => undo(token) },
    })
  }

  const clearFilters = () => setUrlState({ q: "", status: "all", category: "all" })

  // ------------------------------------------------------- keyboard access
  const [paletteOpen, setPaletteOpen] = React.useState(false)

  const commandActions = React.useMemo<CommandAction[]>(() => {
    const nav = [
      { href: "/receipts/scan", label: t("nav.scanReceipt") },
      { href: "/expenses/status", label: t("nav.updateStatus") },
      { href: "/categories", label: t("nav.categories") },
      { href: "/reports", label: t("nav.reports") },
    ]
    return [
      {
        id: "add",
        group: t("command.groupActions"),
        label: t("dashboard.addExpense"),
        run: () => {
          setEditing(null)
          setFormOpen(true)
        },
      },
      {
        id: "clear",
        group: t("command.groupActions"),
        label: t("dashboard.clearFilters"),
        run: clearFilters,
      },
      ...nav.map((n) => ({
        id: `nav:${n.href}`,
        group: t("command.groupNavigate"),
        label: n.label,
        run: () => router.push(n.href),
      })),
      ...[{ slug: "all", label: t("common.all") }, ...STATUSES.map((st) => ({ slug: st.slug as string, label: reg.status(st.slug) }))].map(
        (st) => ({
          id: `status:${st.slug}`,
          group: t("command.groupFilter"),
          label: st.label,
          run: () => setUrlState({ status: st.slug }),
        }),
      ),
      ...SORT_KEYS.map((key) => ({
        id: `sort:${key}`,
        group: t("command.groupSort"),
        label:
          key === "date"
            ? t("form.date")
            : key === "vendor"
              ? t("form.vendor")
              : key === "category"
                ? t("form.category")
                : key === "status"
                  ? t("form.status")
                  : t("form.amount"),
        run: () => setUrlState({ sort: key, dir: "desc" }),
      })),
    ]
  }, [t, reg, router, setUrlState, clearFilters])

  useHotkeys([
    { combo: "mod+k", run: () => setPaletteOpen((v) => !v), allowInInput: true },
    {
      combo: "/",
      run: () => document.querySelector<HTMLInputElement>('input[type="search"]')?.focus(),
    },
    {
      combo: "n",
      run: () => {
        setEditing(null)
        setFormOpen(true)
      },
    },
  ])

  const filtered = query !== "" || status !== "all" || category !== "all"
  // A brand-new install and a filter that matches nothing are different
  // problems and need different exits.
  const isFirstRun = !filtered && (summary?.total_count ?? 0) === 0


  // No confirm dialog: the row disappears immediately and the DELETE is held
  // for the length of the undo window, so nothing is destroyed until the toast
  // goes away. That is strictly safer than a confirm dialog, which taxes every
  // delete and still offers no recovery once accepted.
  const handleDelete = (expense: Expense) => {
    const token = remove(expense)
    toast(t("dashboard.deleted", { vendor: expense.vendor }), {
      duration: UNDO_WINDOW_MS,
      action: {
        label: t("ledger.undo"),
        onAction: () => {
          if (undo(token)) toast(t("ledger.undone", { vendor: expense.vendor }))
        },
      },
    })
  }

  return (
    <AppShell>
      <div className="w-full min-w-72 space-y-section px-gutter py-page-y">
        <PageHeader
          title={t("history.title")}
          description={t("history.subtitle")}
          actions={
            <>
              <Link href="/receipts/scan" className={buttonVariants({ variant: "outline" })}>
                <ScanLine className="size-4" aria-hidden /> {t("dashboard.scanReceipt")}
              </Link>
              <Button
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="size-4" aria-hidden /> {t("dashboard.addExpense")}
              </Button>
            </>
          }
        />

        {/* min-w-0 on both children: grid items default to min-width:auto, so
            the large balance figure would otherwise set a min-content floor
            wider than a 320px viewport and push the page sideways. */}

        <section aria-labelledby="ledger-heading" className="space-y-4">
          <h2 id="ledger-heading" className="sr-only">
            {t("history.title")}
          </h2>

          <ExpenseFilters
            query={queryDraft}
            onQueryChange={setQueryDraft}
            status={status}
            onStatusChange={(v) => setUrlState({ status: v })}
            category={category}
            onCategoryChange={(v) => setUrlState({ category: v })}
            resultCount={loading ? undefined : expenses.length}
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

          {loading ? (
            <ExpenseTableSkeleton />
          ) : expenses.length === 0 ? (
            isFirstRun ? (
              <EmptyState
                icon={Receipt}
                title={t("expenseList.emptyTitle")}
                description={t("expenseList.emptyHint")}
                action={
                  <>
                    <Button
                      onClick={() => {
                        setEditing(null)
                        setFormOpen(true)
                      }}
                    >
                      <Plus className="size-4" aria-hidden /> {t("dashboard.addExpense")}
                    </Button>
                  </>
                }
              />
            ) : (
              <EmptyState
                variant="no-results"
                icon={SearchX}
                title={t("expenseList.noMatchTitle")}
                description={t("expenseList.noMatchHint")}
                action={
                  <Button variant="outline" onClick={clearFilters}>
                    {t("dashboard.clearFilters")}
                  </Button>
                }
              />
            )
          ) : (
            <div className="relative">
              <ExpenseTable
                refreshing={refreshing}
                expenses={expenses}
                sort={sort as SortKey}
                dir={dir as SortDir}
                onSortChange={cycleSort}
                selected={selected}
                onToggleRow={toggleRow}
                onToggleAll={toggleAll}
                attachedFooter={selected.size > 0}
                onEdit={(e) => {
                  setEditing(e)
                  setFormOpen(true)
                }}
                onDelete={handleDelete}
              />
              {selected.size > 0 && (
                <BulkActionBar
                  count={selected.size}
                  onApplyStatus={handleBulkStatus}
                  onDelete={handleBulkDelete}
                  onClear={() => setSelected(new Set())}
                />
              )}
            </div>
          )}
        </section>
      </div>

      {editing ? (
        <ExpenseFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          title={t("dashboard.editExpense")}
          allowReceipt={false}
          expenseId={editing.id}
          hasStoredReceipt={editing.has_receipt}
          storedReceiptName={editing.receipt_original_name}
          initial={initialForEdit}
          submitLabel={t("dashboard.saveChanges")}
          onSubmit={async (fields) => {
            await edit(editing.id, fields)
            toast(t("dashboard.saved", { vendor: fields.vendor }))
          }}
        />
      ) : (
        <AddExpenseDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaveSingle={async (fields, receipt) => {
            await save(fields, receipt)
            toast(t("dashboard.saved", { vendor: fields.vendor }))
          }}
          onImported={refresh}
        />
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={commandActions} />
    </AppShell>
  )
}
