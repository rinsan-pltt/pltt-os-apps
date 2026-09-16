"use client"

import * as React from "react"
import { Search, X } from "lucide-react"

import { useCategories, useCategoryLabel } from "@/components/categories-provider"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { STATUSES } from "@/lib/categories"
import { useExpenseCount, useT, useRegistryText } from "@/lib/i18n"

/**
 * Search + status + category, in that order of importance.
 *
 * The old hero rendered every category as a pill, so a dozen chips wrapped
 * across three lines and drowned the four status filters that people actually
 * switch between. Status keeps its (now keyboard-navigable) switcher; category
 * moves to a select, which is what a 12-option single choice wants to be.
 */
export function ExpenseFilters({
  query,
  onQueryChange,
  status,
  onStatusChange,
  category,
  onCategoryChange,
  resultCount,
}: {
  query: string
  onQueryChange: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  category: string
  onCategoryChange: (value: string) => void
  resultCount?: number
}) {
  const t = useT()
  const reg = useRegistryText()
  const expenseCount = useExpenseCount()
  const { categories } = useCategories()
  const categoryLabel = useCategoryLabel()
  const searchId = React.useId()
  const categoryId = React.useId()

  const statusOptions = [
    { value: "all", label: t("common.all") },
    ...STATUSES.map((s) => ({ value: s.slug as string, label: reg.status(s.slug) })),
  ]

  const filtered = query !== "" || status !== "all" || category !== "all"

  const clearAll = () => {
    onQueryChange("")
    onStatusChange("all")
    onCategoryChange("all")
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <label htmlFor={searchId} className="sr-only">
            {t("dashboard.searchAria")}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("dashboard.searchPlaceholder")}
            className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-sm text-foreground transition-[border-color,box-shadow] duration-[120ms] ease-out placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label={t("dashboard.clearSearch")}
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <SegmentedControl
          value={status}
          onChange={onStatusChange}
          options={statusOptions}
          label={t("dashboard.statusFilterAria")}
          size="sm"
        />

        <div className="sm:ml-auto">
          <label htmlFor={categoryId} className="sr-only">
            {t("form.category")}
          </label>
          <Select
            id={categoryId}
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="h-9 w-full text-sm sm:w-52"
          >
            <option value="all">{t("reports.allCategories")}</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {categoryLabel(c.slug)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filtered && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {resultCount !== undefined && (
            <span aria-live="polite">{expenseCount(resultCount)}</span>
          )}
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 px-2">
            {t("dashboard.clearFilters")}
          </Button>
        </div>
      )}
    </div>
  )
}
