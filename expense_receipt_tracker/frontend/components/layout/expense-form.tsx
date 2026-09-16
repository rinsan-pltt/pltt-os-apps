"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { ReceiptDropzone } from "@/components/layout/receipt-dropzone"
import { AutofilledHint, ScanFeedback } from "@/components/layout/scan-feedback"
import { StoredReceipt } from "@/components/layout/stored-receipt"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCategories, useCategoryLabel } from "@/components/categories-provider"
import { CurrencySelect } from "@/components/ui/currency-select"
import { useReceiptScan } from "@/hooks/use-receipt-scan"
import type { ExpenseInput, ExpenseStatus } from "@/lib/api"
import { STATUSES } from "@/lib/categories"
import { useT, useRegistryText } from "@/lib/i18n"
import { cn, todayIso } from "@/lib/utils"

/** The expense field editor, without a dialog shell — shared by the edit
 *  dialog and the add dialog's manual/scan tab. When `autoScan` is set,
 *  attaching a receipt runs the same OCR/LLM scan as the dedicated scan page
 *  and pre-fills the fields for the user to review. */
export function ExpenseForm({
  initial,
  initialReceipt = null,
  allowReceipt = true,
  autoScan = false,
  expenseId,
  hasStoredReceipt = false,
  storedReceiptName,
  submitLabel,
  compact = false,
  onSubmit,
  onSuccess,
  onCancel,
}: {
  initial?: Partial<ExpenseInput>
  initialReceipt?: File | null
  allowReceipt?: boolean
  autoScan?: boolean
  /** When editing a saved expense that has a receipt on file, these surface a
   *  preview/download of it. */
  expenseId?: string
  hasStoredReceipt?: boolean
  storedReceiptName?: string | null
  submitLabel?: string
  /** Denser layout for dialogs: a three-column grid and a short dropzone, so
   *  the whole form is visible without scrolling inside the panel. */
  compact?: boolean
  onSubmit: (fields: ExpenseInput, receipt: File | null) => Promise<void>
  onSuccess?: () => void
  onCancel: () => void
}) {
  const t = useT()
  const reg = useRegistryText()
  const { categories } = useCategories()
  const categoryLabel = useCategoryLabel()
  const [vendor, setVendor] = React.useState(initial?.vendor ?? "")
  const [amount, setAmount] = React.useState(initial?.amount != null ? String(initial.amount) : "")
  const [currency, setCurrency] = React.useState(initial?.currency ?? "USD")
  const [category, setCategory] = React.useState(initial?.category ?? "other")
  const [expenseDate, setExpenseDate] = React.useState(initial?.expense_date ?? todayIso())
  const [status, setStatus] = React.useState<ExpenseStatus>(initial?.status ?? "pending")
  const [notes, setNotes] = React.useState(initial?.notes ?? "")
  const [receipt, setReceipt] = React.useState<File | null>(initialReceipt)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { status: scanStatus, error: scanError, draft, scan, reset: resetScan } = useReceiptScan()
  // While a receipt is being read/extracted, block saving so the user can't
  // submit before the scanned fields have populated.
  const scanning = scanStatus === "scanning"
  // Which fields the scan filled in, so the user knows what to double-check.
  const [autofilled, setAutofilled] = React.useState<Set<string>>(new Set())

  const handleReceiptChange = (picked: File | null) => {
    setReceipt(picked)
    if (!autoScan) return
    if (picked) {
      scan(picked)
    } else {
      resetScan()
      setAutofilled(new Set())
    }
  }

  // Pre-fill from a scan draft. Only fields the scan actually read are applied,
  // so a partial read never wipes out something the user already typed.
  React.useEffect(() => {
    if (!draft) return
    const filled = new Set<string>()
    if (draft.vendor) {
      setVendor(draft.vendor)
      filled.add("vendor")
    }
    if (draft.amount != null) {
      setAmount(String(draft.amount))
      filled.add("amount")
    }
    if (draft.currency) {
      setCurrency(draft.currency)
      filled.add("currency")
    }
    if (draft.expense_date) {
      setExpenseDate(draft.expense_date)
      filled.add("expense_date")
    }
    setCategory(draft.category)
    filled.add("category")
    setAutofilled(filled)
  }, [draft])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (scanning) return // still reading the receipt — wait for extraction
    const parsedAmount = Number.parseFloat(amount)
    if (!vendor.trim()) {
      setError(t("form.enterVendor"))
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError(t("form.enterAmount"))
      return
    }
    if (!expenseDate) {
      setError(t("form.pickDate"))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(
        {
          vendor: vendor.trim(),
          amount: parsedAmount,
          currency: currency.trim() || "USD",
          category,
          expense_date: expenseDate,
          status,
          notes: notes.trim() || undefined,
        },
        allowReceipt ? receipt : null,
      )
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("form.couldNotSave"))
    } finally {
      setSubmitting(false)
    }
  }

  const mark = (field: string) => (autofilled.has(field) ? <AutofilledHint /> : undefined)

  return (
    <form onSubmit={handleSubmit} className="space-y-block">
      {expenseId && hasStoredReceipt && (
        <StoredReceipt expenseId={expenseId} originalName={storedReceiptName} />
      )}

      {allowReceipt && (
        <div className="space-y-2">
          <Label>{t("form.receipt")}</Label>
          <ReceiptDropzone
            file={receipt}
            onFileChange={handleReceiptChange}
            disabled={submitting || scanning}
            compact={compact}
          />
          {autoScan && (
            <ScanFeedback status={scanStatus} error={scanError} draft={draft} />
          )}
        </div>
      )}

      <div className={cn("grid grid-cols-1 gap-field", compact ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <Field label={t("form.vendor")} hint={mark("vendor")} className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder={t("form.vendorPlaceholder")}
              disabled={submitting}
            />
          )}
        </Field>
        <Field label={t("form.amount")} hint={mark("amount")}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
            />
          )}
        </Field>
        <Field label={t("form.currency")} hint={mark("currency")}>
          {(p) => (
            <CurrencySelect
              id={p.id}
              value={currency}
              onChange={setCurrency}
              disabled={submitting}
            />
          )}
        </Field>
        <Field label={t("form.category")} hint={mark("category")}>
          {(p) => (
            <Select
              {...p}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
            >
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {categoryLabel(c.slug)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("form.date")} hint={mark("expense_date")}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              disabled={submitting}
            />
          )}
        </Field>
        <Field label={t("form.status")} className={compact ? undefined : "sm:col-span-2"}>
          {(p) => (
            <Select
              {...p}
              value={status}
              onChange={(e) => setStatus(e.target.value as ExpenseStatus)}
              disabled={submitting}
            >
              {STATUSES.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {reg.status(s.slug)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("form.notesOptional")} className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("form.notesPlaceholder")}
              disabled={submitting}
              // In the dialog this shares a row with Status, so it matches a
              // control's height exactly rather than standing 40px taller and
              // breaking the grid's rhythm. Giving it its own full-width row
              // would be tidier still, but costs ~89px and the panel only has
              // 38px to spare on a short window — this keeps the whole form
              // visible, which matters more. It still grows by drag, and the
              // max-height stops that drag pushing content out of the panel.
              rows={compact ? 1 : undefined}
              className={compact ? "min-h-10 max-h-40" : undefined}
            />
          )}
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive-text">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting || scanning}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {t("common.saving")}
            </>
          ) : scanning ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {t("scan.reading")}
            </>
          ) : (
            (submitLabel ?? t("form.saveExpense"))
          )}
        </Button>
      </div>
    </form>
  )
}
