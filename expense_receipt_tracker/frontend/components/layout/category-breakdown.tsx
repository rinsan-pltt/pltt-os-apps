"use client"

import * as React from "react"

import { useCategoryLabel } from "@/components/categories-provider"
import { CategoryDot } from "@/components/layout/category-badge"
import { useFormatters } from "@/lib/format"
import { useT } from "@/lib/i18n"
import type { ExpenseSummary } from "@/lib/api"
import { cn } from "@/lib/utils"

const VISIBLE = 6

/**
 * Where the money actually goes.
 *
 * `summary.by_category` was already being fetched on every dashboard load and
 * thrown away except for its single top row, which the old design spent a
 * whole stat tile on. Same request, far more answer — and the backend already
 * returns it sorted by amount descending.
 */
export function CategoryBreakdown({
  summary,
  onSelect,
}: {
  summary: ExpenseSummary
  /** Clicking a row filters the ledger to that category. */
  onSelect?: (slug: string) => void
}) {
  const t = useT()
  const { money, number } = useFormatters()
  const categoryLabel = useCategoryLabel()
  const [expanded, setExpanded] = React.useState(false)

  const rows = summary.by_category
  if (rows.length === 0) return null

  const shown = expanded ? rows : rows.slice(0, VISIBLE)
  const max = rows[0]?.amount ?? 0

  return (
    <section
      aria-labelledby="breakdown-heading"
      className="rounded-xl border border-border bg-card p-5 shadow-[var(--erx-shadow-sm)] sm:p-6"
    >
      <h2
        id="breakdown-heading"
        className="text-overline uppercase text-muted-foreground"
      >
        {t("dashboard.breakdownTitle")}
      </h2>

      <ul className="mt-4 space-y-2.5">
        {shown.map((row) => {
          const share = max > 0 ? (row.amount / max) * 100 : 0
          const label = categoryLabel(row.category)
          const content = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <CategoryDot slug={row.category} />
                <span className="truncate text-body">{label}</span>
                <span className="shrink-0 text-micro text-muted-foreground">
                  {number(row.count)}
                </span>
              </span>
              <span className="shrink-0 text-body font-medium numeral">
                {money(row.amount, summary.base_currency)}
              </span>
            </>
          )

          return (
            <li key={row.category}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(row.category)}
                  className={cn(
                    "flex w-full items-baseline justify-between gap-4 rounded-md px-1 py-0.5 text-left",
                    "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  aria-label={t("dashboard.filterByCategory", { category: label })}
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-baseline justify-between gap-4 px-1">{content}</div>
              )}
              <div
                aria-hidden
                className="mx-1 mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary/35 transition-[width] duration-500 ease-out"
                  style={{ width: `${share}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>

      {rows.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 rounded-md text-caption font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded
            ? t("dashboard.showFewer")
            : t("dashboard.showAllCategories", { count: rows.length - VISIBLE })}
        </button>
      )}
    </section>
  )
}
