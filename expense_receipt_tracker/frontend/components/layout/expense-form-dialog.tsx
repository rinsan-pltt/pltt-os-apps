"use client"

import { ExpenseForm } from "@/components/layout/expense-form"
import { Dialog } from "@/components/ui/dialog"
import type { ExpenseInput } from "@/lib/api"

export function ExpenseFormDialog({
  open,
  onOpenChange,
  title,
  initial,
  initialReceipt = null,
  allowReceipt = true,
  autoScan = false,
  expenseId,
  hasStoredReceipt,
  storedReceiptName,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  initial?: Partial<ExpenseInput>
  initialReceipt?: File | null
  allowReceipt?: boolean
  autoScan?: boolean
  expenseId?: string
  hasStoredReceipt?: boolean
  storedReceiptName?: string | null
  submitLabel?: string
  onSubmit: (fields: ExpenseInput, receipt: File | null) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} wide>
      <ExpenseForm
        initial={initial}
        initialReceipt={initialReceipt}
        allowReceipt={allowReceipt}
        autoScan={autoScan}
        expenseId={expenseId}
        hasStoredReceipt={hasStoredReceipt}
        storedReceiptName={storedReceiptName}
        submitLabel={submitLabel}
        onSubmit={onSubmit}
        onSuccess={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
      />
    </Dialog>
  )
}
