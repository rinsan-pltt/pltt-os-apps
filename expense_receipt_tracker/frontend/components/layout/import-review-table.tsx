"use client"

import { AlertTriangle } from "lucide-react"

import { useCategories, useCategoryLabel } from "@/components/categories-provider"
import { CurrencySelect } from "@/components/ui/currency-select"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import type { ImportRow } from "@/lib/api"
import { cn } from "@/lib/utils"

export interface EditableImportRow extends ImportRow {
  selected: boolean
}

/** Why a parsed row can't be imported yet. Mirrors the null conditions in
 *  `toCommitRow` exactly — the amber highlight used to be the only signal,
 *  which is colour-only meaning (WCAG 1.4.1) and told the user nothing about
 *  what to fix. */
function missingFields(row: ImportRow): ("vendor" | "amount" | "date")[] {
  const missing: ("vendor" | "amount" | "date")[] = []
  if (!row.vendor.trim()) missing.push("vendor")
  if (row.amount == null) missing.push("amount")
  if (!row.expense_date) missing.push("date")
  return missing
}

export function ImportReviewTable({
  rows,
  onChange,
}: {
  rows: EditableImportRow[]
  onChange: (rows: EditableImportRow[]) => void
}) {
  const t = useT()
  const { categories } = useCategories()
  const categoryLabel = useCategoryLabel()
  const update = (index: number, patch: Partial<EditableImportRow>) => {
    const next = rows.slice()
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  const allSelected = rows.length > 0 && rows.every((r) => r.selected)
  const someSelected = rows.some((r) => r.selected)

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[880px] text-sm">
        <caption className="sr-only">{t("review.caption")}</caption>
        <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="w-10 p-2.5">
              <input
                type="checkbox"
                className="ck"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && someSelected
                }}
                onChange={(e) => onChange(rows.map((r) => ({ ...r, selected: e.target.checked })))}
                aria-label={t("review.selectAll")}
              />
            </th>
            <th scope="col" className="p-2.5 font-medium">
              {t("form.vendor")}
            </th>
            <th scope="col" className="p-2.5 font-medium">
              {t("form.date")}
            </th>
            <th scope="col" className="p-2.5 font-medium">
              {t("form.amount")}
            </th>
            <th scope="col" className="p-2.5 font-medium">
              {t("form.currency")}
            </th>
            <th scope="col" className="p-2.5 font-medium">
              {t("form.category")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => {
            const missing = missingFields(row)
            return (
              <tr
                key={row.row}
                className={cn(
                  "transition-colors",
                  missing.length > 0 ? "bg-warning-subtle" : "odd:bg-surface-sunken/30",
                )}
              >
                <td className="p-2.5 align-top">
                  <input
                    type="checkbox"
                    className="ck"
                    checked={row.selected}
                    onChange={(e) => update(index, { selected: e.target.checked })}
                    aria-label={t("review.includeRow", { row: row.row })}
                  />
                </td>
                <td className="p-2.5 align-top">
                  <Input
                    value={row.vendor}
                    onChange={(e) => update(index, { vendor: e.target.value })}
                    className="h-9"
                    aria-label={t("review.vendorForRow", { row: row.row })}
                    aria-invalid={missing.includes("vendor") || undefined}
                  />
                  {missing.length > 0 && (
                    <p className="mt-1.5 flex items-start gap-1 text-xs font-medium text-warning">
                      <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                      {t("review.needs", {
                        fields: missing
                          .map((field) =>
                            field === "vendor"
                              ? t("form.vendor")
                              : field === "amount"
                                ? t("form.amount")
                                : t("form.date"),
                          )
                          .join(", "),
                      })}
                    </p>
                  )}
                </td>
                <td className="p-2.5 align-top">
                  <Input
                    type="date"
                    value={row.expense_date ?? ""}
                    onChange={(e) => update(index, { expense_date: e.target.value || null })}
                    className="h-9"
                    aria-label={t("review.dateForRow", { row: row.row })}
                    aria-invalid={missing.includes("date") || undefined}
                  />
                </td>
                <td className="p-2.5 align-top">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount ?? ""}
                    onChange={(e) =>
                      update(index, { amount: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="h-9 w-28"
                    aria-label={t("review.amountForRow", { row: row.row })}
                    aria-invalid={missing.includes("amount") || undefined}
                  />
                </td>
                <td className="p-2.5 align-top">
                  <CurrencySelect
                    value={row.currency || "USD"}
                    onChange={(code) => update(index, { currency: code })}
                    className="h-9 w-32"
                  />
                </td>
                <td className="p-2.5 align-top">
                  <Select
                    value={row.category}
                    onChange={(e) => update(index, { category: e.target.value })}
                    className="h-9"
                    aria-label={t("review.categoryForRow", { row: row.row })}
                  >
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {categoryLabel(c.slug)}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
