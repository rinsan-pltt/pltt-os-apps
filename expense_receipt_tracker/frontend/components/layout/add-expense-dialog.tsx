"use client"

import * as React from "react"

import { BulkImportPanel } from "@/components/layout/bulk-import-panel"
import { ExpenseForm } from "@/components/layout/expense-form"
import { Dialog } from "@/components/ui/dialog"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { useT } from "@/lib/i18n"
import type { ExpenseInput } from "@/lib/api"

type AddTab = "single" | "bulk"

/** The dashboard "Add expense" entry point. Mirrors the dedicated scan page:
 *  a "Scan a receipt" tab (single expense with auto-scan + manual review) and
 *  an "Import spreadsheet or statement" tab for CSV/Excel/PDF bulk imports. */
export function AddExpenseDialog({
  open,
  onOpenChange,
  onSaveSingle,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaveSingle: (fields: ExpenseInput, receipt: File | null) => Promise<void>
  onImported: () => void
}) {
  const t = useT()
  const [tab, setTab] = React.useState<AddTab>("single")

  // Always reopen on the single-expense tab.
  React.useEffect(() => {
    if (open) setTab("single")
  }, [open])

  const tabs = [
    { value: "single" as const, label: t("scan.tabSingle") },
    { value: "bulk" as const, label: t("scan.tabBulk") },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("dashboard.addExpenseTitle")} size="xl">
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={tabs}
        label={t("scan.tabsAria")}
        className="mb-5"
      />

      {tab === "single" ? (
        <ExpenseForm
          allowReceipt
          autoScan
          compact
          submitLabel={t("form.saveExpense")}
          onSubmit={onSaveSingle}
          onSuccess={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      ) : (
        <BulkImportPanel
          onDone={() => {
            onImported()
            onOpenChange(false)
          }}
        />
      )}
    </Dialog>
  )
}
