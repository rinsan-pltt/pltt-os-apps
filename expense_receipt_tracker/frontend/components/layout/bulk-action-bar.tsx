"use client"

import * as React from "react"
import { Loader2, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { STATUSES } from "@/lib/categories"
import { useT, useRegistryText } from "@/lib/i18n"
import type { ExpenseStatus } from "@/lib/api"

/**
 * Acting on a selection without leaving the ledger.
 *
 * Changing five expenses to "submitted" used to mean leaving the dashboard for
 * /expenses/status and re-applying the same filters by hand. That page still
 * exists and is untouched — this just removes the detour for the common case.
 */
export function BulkActionBar({
  count,
  onApplyStatus,
  onDelete,
  onClear,
}: {
  count: number
  onApplyStatus: (status: ExpenseStatus) => Promise<void> | void
  onDelete: () => void
  onClear: () => void
}) {
  const t = useT()
  const reg = useRegistryText()
  const [status, setStatus] = React.useState<ExpenseStatus>("submitted")
  const [applying, setApplying] = React.useState(false)
  const selectId = React.useId()

  return (
    <div
      role="region"
      aria-label={t("ledger.selectedCount", { count })}
      // Pinned to the bottom of the view rather than welded to the table's
      // bottom edge, which on a long ledger is thousands of pixels away —
      // unreachable exactly when you have a selection. Full width and opaque so
      // it reads as the ledger's own footer, not a box floating over the rows.
      className="sticky bottom-0 z-20 -mt-px flex flex-wrap items-center gap-inline rounded-b-xl border border-border-strong bg-card px-4 py-3 shadow-[var(--erx-shadow)]"
    >
      <span aria-live="polite" className="text-body font-medium">
        {t("ledger.selectedCount", { count })}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-inline">
        <label htmlFor={selectId} className="sr-only">
          {t("ledger.bulkStatus")}
        </label>
        <Select
          id={selectId}
          value={status}
          onChange={(e) => setStatus(e.target.value as ExpenseStatus)}
          className="h-9 w-40"
          disabled={applying}
        >
          {STATUSES.map((s) => (
            <option key={s.slug} value={s.slug}>
              {reg.status(s.slug)}
            </option>
          ))}
        </Select>

        <Button
          size="sm"
          disabled={applying}
          onClick={async () => {
            setApplying(true)
            try {
              await onApplyStatus(status)
            } finally {
              setApplying(false)
            }
          }}
        >
          {applying ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t("ledger.bulkApply")}
            </>
          ) : (
            t("ledger.bulkApply")
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive-text">
          <Trash2 className="size-4" aria-hidden /> {t("ledger.bulkDelete")}
        </Button>

        <Button variant="ghost" size="icon" aria-label={t("ledger.clearSelection")} onClick={onClear}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
