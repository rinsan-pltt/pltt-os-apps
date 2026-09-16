"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown, Paperclip, Trash2 } from "lucide-react"

import { CategoryBadge } from "@/components/layout/category-badge"
import { StatusBadge } from "@/components/layout/status-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useVirtualRows } from "@/hooks/use-virtual-rows"
import { useFormatters } from "@/lib/format"
import { useExpenseCount, useT } from "@/lib/i18n"
import type { Expense } from "@/lib/api"
import type { SortDir, SortKey } from "@/lib/expense-ledger"
import { cn, sumByCurrency } from "@/lib/utils"

/**
 * The ledger.
 *
 * One `<table>` at every width. It previously rendered a desktop table *and* a
 * mobile card list, both always in the DOM — 2N row subtrees, and every new
 * feature (sorting, selection, row actions) had to be written twice in two
 * structurally unrelated markups. Below `sm` the same table stacks its content
 * inside the vendor cell and hides the columns that don't fit, which is the
 * idiom the bulk-status page already uses.
 *
 * Long lists are windowed (see useVirtualRows). The window is bracketed by two
 * spacer `<tr>`s rather than transform-positioned rows, so this stays a real
 * table with real `<th scope>` — and `aria-rowcount`/`aria-rowindex` keep the
 * announced position honest even though most rows aren't in the DOM.
 */

const COLUMN_COUNT = 7

/** Kept in sync with `--row-h` in globals.css. Rows are a fixed height so the
 *  window maths is exact rather than drifting on rows that have notes. */
const ROW_H = { base: 84, sm: 53 }

type SortableColumn = Extract<SortKey, "vendor" | "date" | "category" | "status" | "amount">

function SortHeader({
  column,
  label,
  sort,
  dir,
  onSortChange,
  className,
}: {
  column: SortableColumn
  label: string
  sort: SortKey
  dir: SortDir
  onSortChange: (key: SortableColumn) => void
  className?: string
}) {
  const t = useT()
  const activeSort = sort === column
  return (
    <th
      scope="col"
      // aria-sort belongs on the header cell, and exactly one cell may be
      // anything other than "none".
      aria-sort={activeSort ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-0 font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSortChange(column)}
        className={cn(
          "flex w-full items-center gap-1 py-2.5 text-overline uppercase transition-colors",
          "duration-[var(--erx-dur-instant)] ease-out hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className?.includes("text-right") && "justify-end",
          activeSort ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{label}</span>
        {activeSort ? (
          dir === "asc" ? (
            <ChevronUp className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-40" aria-hidden />
        )}
        <span className="sr-only">{t("ledger.sortBy", { column: label })}</span>
      </button>
    </th>
  )
}

const LedgerRow = React.memo(function LedgerRow({
  expense,
  rowIndex,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  expense: Expense
  rowIndex: number
  selected: boolean
  onToggle: (id: string) => void
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
}) {
  const t = useT()
  const { money, date } = useFormatters()
  const editLabel = t("expenseRow.editAria", { vendor: expense.vendor })

  return (
    <tr
      aria-rowindex={rowIndex}
      aria-selected={selected || undefined}
      className={cn(
        "transition-colors duration-[var(--erx-dur-instant)]",
        selected ? "bg-accent/50" : "hover:bg-accent/30",
      )}
    >
      <td className="px-4 align-middle">
        <input
          type="checkbox"
          className="ck"
          checked={selected}
          onChange={() => onToggle(expense.id)}
          aria-label={t("ledger.selectRow", { vendor: expense.vendor })}
        />
      </td>

      <th scope="row" className="max-w-0 px-2 text-left align-middle font-normal">
        <button
          type="button"
          onClick={() => onEdit(expense)}
          aria-label={editLabel}
          className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{expense.vendor}</span>
            {expense.has_receipt && (
              <Paperclip
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t("expenseRow.hasReceipt")}
              />
            )}
          </span>
          {/* Below md the date lives here; below sm the badges do too. Nothing
              is dropped at any width, it just moves into the row header. */}
          <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
            <span className="md:hidden">{date(expense.expense_date)}</span>
            {expense.notes && (
              <>
                {<span aria-hidden className="md:hidden">·</span>}
                <span className="truncate">{expense.notes}</span>
              </>
            )}
          </span>
          <span className="mt-1 flex items-center gap-1.5 sm:hidden">
            <CategoryBadge slug={expense.category} className="max-w-[8rem]" />
            <StatusBadge slug={expense.status} />
          </span>
        </button>
      </th>

      <td className="hidden whitespace-nowrap px-3 align-middle text-muted-foreground md:table-cell">
        {date(expense.expense_date)}
      </td>
      <td className="hidden px-3 align-middle sm:table-cell">
        <CategoryBadge slug={expense.category} className="max-w-[8rem] md:max-w-none" />
      </td>
      <td className="hidden px-3 align-middle sm:table-cell">
        <StatusBadge slug={expense.status} />
      </td>
      <td className="whitespace-nowrap px-3 text-right align-middle font-semibold numeral">
        {money(expense.amount, expense.currency)}
      </td>
      <td className="px-2 text-right align-middle">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("expenseRow.deleteAria", { vendor: expense.vendor })}
          onClick={() => onDelete(expense)}
          className="hover:text-destructive-text"
        >
          <Trash2 className="size-4" />
        </Button>
      </td>
    </tr>
  )
})

export function ExpenseTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-strong bg-card shadow-[var(--erx-shadow-sm)]">
      <div className="hidden border-b border-border bg-surface-sunken px-4 py-2.5 sm:block">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3.5"
            style={{ ["--skeleton-i" as string]: i }}
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
            <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExpenseTable({
  expenses,
  onEdit,
  onDelete,
  refreshing = false,
  sort,
  dir,
  onSortChange,
  selected,
  onToggleRow,
  onToggleAll,
  attachedFooter = false,
}: {
  expenses: Expense[]
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
  /** A background refetch is in flight. The rows stay put and dim slightly —
   *  they used to be replaced wholesale by skeletons on every interaction. */
  refreshing?: boolean
  sort: SortKey
  dir: SortDir
  onSortChange: (key: SortableColumn) => void
  selected: Set<string>
  onToggleRow: (id: string) => void
  onToggleAll: () => void
  /** A bulk-action footer is rendered directly beneath, so square off this
   *  card's bottom rather than showing two rounded edges and a doubled rule. */
  attachedFooter?: boolean
}) {
  const t = useT()
  const { money } = useFormatters()
  const expenseCount = useExpenseCount()
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = React.useState(ROW_H.sm)

  // Measured rather than assumed, so it tracks the breakpoint and the user's
  // text zoom for free.
  React.useEffect(() => {
    const update = () =>
      setRowHeight(window.matchMedia("(min-width: 640px)").matches ? ROW_H.sm : ROW_H.base)
    update()
    const mq = window.matchMedia("(min-width: 640px)")
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  const { start, end, padTop, padBottom } = useVirtualRows({
    count: expenses.length,
    rowHeight,
    anchorRef,
  })

  const totals = React.useMemo(() => sumByCurrency(expenses), [expenses])
  const allSelected = expenses.length > 0 && expenses.every((e) => selected.has(e.id))
  const someSelected = selected.size > 0

  const columnLabel: Record<SortableColumn, string> = {
    vendor: t("form.vendor"),
    date: t("form.date"),
    category: t("form.category"),
    status: t("form.status"),
    amount: t("form.amount"),
  }

  return (
    <div
      aria-busy={refreshing || undefined}
      className={cn(
        "overflow-hidden rounded-xl border border-border-strong bg-card shadow-[var(--erx-shadow-sm)]",
        "transition-opacity duration-[var(--erx-dur-fast)]",
        attachedFooter && "rounded-b-none border-b-0",
        refreshing && "opacity-60",
      )}
    >
      {/* aria-sort alone is not announced when it changes, so say it. */}
      <p aria-live="polite" className="sr-only">
        {t("ledger.sortAnnouncement", {
          column: columnLabel[sort as SortableColumn] ?? sort,
          direction: dir === "asc" ? t("ledger.sortedAscending") : t("ledger.sortedDescending"),
        })}
      </p>

      <div ref={anchorRef}>
        <table className="w-full text-body" aria-rowcount={expenses.length + 1}>
          <caption className="sr-only">{t("expenseList.tableCaption")}</caption>
          <thead className="sticky top-0 z-10 bg-surface-sunken shadow-[0_1px_0_var(--erx-border)]">
            <tr aria-rowindex={1} className="border-b border-border">
              <th scope="col" className="w-12 px-4 py-2.5">
                <input
                  type="checkbox"
                  className="ck"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected
                  }}
                  onChange={onToggleAll}
                  aria-label={t("ledger.selectAll")}
                  disabled={expenses.length === 0}
                />
              </th>
              <SortHeader
                column="vendor"
                label={columnLabel.vendor}
                sort={sort}
                dir={dir}
                onSortChange={onSortChange}
                className="w-2/5 text-left"
              />
              <SortHeader
                column="date"
                label={columnLabel.date}
                sort={sort}
                dir={dir}
                onSortChange={onSortChange}
                className="hidden w-px whitespace-nowrap text-left md:table-cell"
              />
              <SortHeader
                column="category"
                label={columnLabel.category}
                sort={sort}
                dir={dir}
                onSortChange={onSortChange}
                className="hidden w-px whitespace-nowrap text-left sm:table-cell"
              />
              <SortHeader
                column="status"
                label={columnLabel.status}
                sort={sort}
                dir={dir}
                onSortChange={onSortChange}
                className="hidden w-px whitespace-nowrap text-left sm:table-cell"
              />
              <SortHeader
                column="amount"
                label={columnLabel.amount}
                sort={sort}
                dir={dir}
                onSortChange={onSortChange}
                className="w-px whitespace-nowrap text-right"
              />
              <th scope="col" className="w-px px-2 py-2.5">
                <span className="sr-only">{t("common.actions")}</span>
              </th>
            </tr>
          </thead>

          <tbody className="ledger-body divide-y divide-border">
            {/* Spacers stand in for the rows outside the window: the scrollbar
                stays the right length and the table keeps valid structure.
                Heights are inline styles — a template-literal Tailwind class
                like h-[${n}px] compiles to nothing. */}
            {padTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={COLUMN_COUNT} style={{ height: padTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {expenses.slice(start, end).map((expense, i) => (
              <LedgerRow
                key={expense.id}
                expense={expense}
                rowIndex={start + i + 2}
                selected={selected.has(expense.id)}
                onToggle={onToggleRow}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={COLUMN_COUNT} style={{ height: padBottom, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>

          <tfoot>
            {/* colSpan counts *model* columns; a display:none cell is removed
                from the model, so this still sits left at every width. */}
            <tr className="border-t border-border bg-surface-sunken text-caption">
              <td colSpan={COLUMN_COUNT - 2} className="px-4 py-2.5 text-muted-foreground">
                {expenseCount(expenses.length)}
              </td>
              <td colSpan={2} className="px-3 py-2.5 text-right">
                {/* One line per currency: summing a ₹ receipt into a $ total
                    would print a number that is simply wrong. */}
                <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5">
                  {totals.map((total) => (
                    <span key={total.currency} className="font-semibold numeral">
                      {money(total.amount, total.currency)}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
