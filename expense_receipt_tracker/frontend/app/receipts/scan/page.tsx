"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { usePlatform } from "@palettelab/sdk"
import { Loader2 } from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { BulkImportPanel } from "@/components/layout/bulk-import-panel"
import { PageHeader } from "@/components/layout/page-header"
import { DocumentPreview } from "@/components/layout/document-preview"
import { ReceiptDropzone } from "@/components/layout/receipt-dropzone"
import { AutofilledHint, ScanFeedback } from "@/components/layout/scan-feedback"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CurrencySelect } from "@/components/ui/currency-select"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { useCategories, useCategoryLabel } from "@/components/categories-provider"
import { useReceiptScan } from "@/hooks/use-receipt-scan"
import { useT, useRegistryText } from "@/lib/i18n"
import { createExpense, type ExpenseStatus } from "@/lib/api"
import { uploadReceiptToStorage } from "@/lib/receipt-storage"
import { STATUSES } from "@/lib/categories"
import { todayIso } from "@/lib/utils"

type TabSlug = "single" | "bulk"

export default function ScanReceiptPage() {
  const [tab, setTab] = React.useState<TabSlug>("single")
  const t = useT()

  const tabs = [
    { value: "single" as const, label: t("scan.tabSingle") },
    { value: "bulk" as const, label: t("scan.tabBulk") },
  ]

  return (
    <AppShell>
      <div className="w-full min-w-72 space-y-section px-gutter py-page-y">
        <PageHeader title={t("scan.title")} description={t("scan.subtitle")} />

        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={tabs}
          label={t("scan.tabsAria")}
        />

        {tab === "single" ? <SingleReceiptScan /> : <BulkImportPanel />}
      </div>
    </AppShell>
  )
}

function ReviewSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={i === 0 ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function SingleReceiptScan() {
  const router = useRouter()
  const platform = usePlatform()
  const t = useT()
  const reg = useRegistryText()
  const { toast } = useToast()
  const { categories } = useCategories()
  const categoryLabel = useCategoryLabel()
  const { status, error, draft, scan, reset } = useReceiptScan()
  const [file, setFile] = React.useState<File | null>(null)

  const [vendor, setVendor] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [currency, setCurrency] = React.useState("USD")
  const [category, setCategory] = React.useState("other")
  const [expenseDate, setExpenseDate] = React.useState(todayIso())
  const [expStatus, setExpStatus] = React.useState<ExpenseStatus>("pending")
  const [notes, setNotes] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [autofilled, setAutofilled] = React.useState<Set<string>>(new Set())

  const handleFile = async (picked: File | null) => {
    setFile(picked)
    setSaveError(null)
    if (!picked) {
      reset()
      setAutofilled(new Set())
      return
    }
    await scan(picked)
  }

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

  const readyToReview = file !== null && (status === "done" || status === "error")

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsedAmount = Number.parseFloat(amount)
    if (!vendor.trim()) {
      setSaveError(t("form.enterVendor"))
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setSaveError(t("form.enterAmount"))
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      // Upload the receipt to durable platform storage first; fall back to the
      // raw-file backend upload when storage isn't available.
      const ref = file ? await uploadReceiptToStorage(platform, file) : null
      await createExpense(
        {
          vendor: vendor.trim(),
          amount: parsedAmount,
          currency: currency.trim() || "USD",
          category,
          expense_date: expenseDate,
          status: expStatus,
          notes: notes.trim() || undefined,
        },
        ref ? null : file,
        ref,
      )
      toast(t("dashboard.saved", { vendor: vendor.trim() }))
      router.push("/")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("form.couldNotSave"))
    } finally {
      setSaving(false)
    }
  }

  const mark = (field: string) => (autofilled.has(field) ? <AutofilledHint /> : undefined)

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-5">
          <ReceiptDropzone file={file} onFileChange={handleFile} disabled={status === "scanning"} />
          <ScanFeedback status={status} error={error} draft={draft} />
        </CardContent>
      </Card>

      {status === "scanning" && <ReviewSkeleton />}

      {readyToReview && (
        <Card>
          <CardHeader>
            <CardTitle>{t("scan.confirmTitle")}</CardTitle>
            <CardDescription>{t("scan.confirmDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-block lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            {file && (
              <aside aria-label={t("scan.reviewAside")} className="lg:sticky lg:top-4 lg:self-start">
                <DocumentPreview file={file} />
              </aside>
            )}
            <form onSubmit={handleSave} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t("form.vendor")} hint={mark("vendor")} className="sm:col-span-2">
                  {(p) => (
                    <Input
                      {...p}
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value)}
                      placeholder={t("form.vendorPlaceholder")}
                      disabled={saving}
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
                      disabled={saving}
                    />
                  )}
                </Field>
                <Field label={t("form.currency")} hint={mark("currency")}>
                  {(p) => (
                    <CurrencySelect
                      id={p.id}
                      value={currency}
                      onChange={setCurrency}
                      disabled={saving}
                    />
                  )}
                </Field>
                <Field label={t("form.category")} hint={mark("category")}>
                  {(p) => (
                    <Select
                      {...p}
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      disabled={saving}
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
                      disabled={saving}
                    />
                  )}
                </Field>
                <Field label={t("form.status")} className="sm:col-span-2">
                  {(p) => (
                    <Select
                      {...p}
                      value={expStatus}
                      onChange={(e) => setExpStatus(e.target.value as ExpenseStatus)}
                      disabled={saving}
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
                      disabled={saving}
                    />
                  )}
                </Field>
              </div>

              {saveError && (
                <p role="alert" className="text-sm font-medium text-destructive-text">
                  {saveError}
                </p>
              )}

              <div className="flex justify-end">
                <Button type="submit" size="lg" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden /> {t("common.saving")}
                    </>
                  ) : (
                    t("form.saveExpense")
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  )
}
