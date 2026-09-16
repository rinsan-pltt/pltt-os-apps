"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2 } from "lucide-react"

import { ImportReviewTable, type EditableImportRow } from "@/components/layout/import-review-table"
import { ReceiptDropzone } from "@/components/layout/receipt-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Select } from "@/components/ui/select"
import { toCommitRow, useBulkImport } from "@/hooks/use-bulk-import"
import { useFormatters } from "@/lib/format"
import { useT, useRegistryText } from "@/lib/i18n"
import type { ExpenseStatus, ImportCommitRow } from "@/lib/api"
import { STATUSES } from "@/lib/categories"
import { sumByCurrency } from "@/lib/utils"

const IMPORT_ACCEPT = ".xlsx,.xls,.csv,.pdf"

/** Bulk-import counterpart to the single-receipt scan flow: one Excel/CSV
 *  spreadsheet or PDF statement can contain many transaction rows, each of
 *  which becomes its own expense after the user reviews/edits it below.
 *
 *  On the standalone scan page it navigates to the dashboard when done. When
 *  `onDone` is provided (e.g. embedded in the dashboard's Add dialog) it calls
 *  that instead, so the parent can refresh its list and close the dialog. */
export function BulkImportPanel({ onDone }: { onDone?: () => void } = {}) {
  const router = useRouter()
  const embedded = onDone !== undefined
  const t = useT()
  const reg = useRegistryText()
  const { money } = useFormatters()
  const { status, error, rows, importedCount, read, commit, reset } = useBulkImport()
  const [file, setFile] = React.useState<File | null>(null)
  const [editableRows, setEditableRows] = React.useState<EditableImportRow[]>([])
  const [batchStatus, setBatchStatus] = React.useState<ExpenseStatus>("pending")

  const handleFile = async (picked: File | null) => {
    setFile(picked)
    if (!picked) {
      reset()
      setEditableRows([])
      return
    }
    await read(picked)
  }

  React.useEffect(() => {
    setEditableRows(rows.map((row) => ({ ...row, selected: row.valid })))
  }, [rows])

  const selectedRows = editableRows.filter((r) => r.selected)
  const selectedTotals = sumByCurrency(
    selectedRows.map((r) => ({ amount: r.amount ?? 0, currency: r.currency || "USD" })),
  )
  const selectedTotalLabel = selectedTotals.map((s) => money(s.amount, s.currency)).join(" + ")

  const handleImport = async () => {
    const toImport = selectedRows
      .map((r) => toCommitRow(r, batchStatus))
      .filter((r): r is ImportCommitRow => r !== null)
    if (toImport.length === 0) return
    await commit(toImport)
  }

  if (status === "done") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-subtle text-success">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <p role="status" className="font-medium">
            {t("bulk.imported", { count: importedCount })}
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                reset()
                setFile(null)
                setEditableRows([])
              }}
            >
              {t("bulk.importAnother")}
            </Button>
            <Button onClick={() => (embedded ? onDone?.() : router.push("/"))}>
              {embedded ? t("bulk.done") : t("bulk.goToDashboard")}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className="mb-6">
        <CardContent className="space-y-3 p-5">
          <ReceiptDropzone
            file={file}
            onFileChange={handleFile}
            disabled={status === "reading" || status === "importing"}
            accept={IMPORT_ACCEPT}
            title={t("bulk.importTitle")}
            hint={t("bulk.importHint")}
          />
          {status === "reading" && (
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t("bulk.reading")}
            </p>
          )}
          {status === "error" && error && (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive-text">
              <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
            </p>
          )}
          {status === "ready" && (
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSpreadsheet className="size-4 shrink-0" aria-hidden />{" "}
              {t("bulk.foundRows", { count: rows.length })}
            </p>
          )}
        </CardContent>
      </Card>

      {editableRows.length > 0 && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <ImportReviewTable rows={editableRows} onChange={setEditableRows} />

            {/* Sticky so the count, total and action stay reachable while
                scrolling a long statement. */}
            <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-col gap-4 border-t border-border bg-card/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-end sm:justify-between">
              <Field label={t("bulk.statusForImported")}>
                {(p) => (
                  <Select
                    {...p}
                    value={batchStatus}
                    onChange={(e) => setBatchStatus(e.target.value as ExpenseStatus)}
                    className="w-48"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {reg.status(s.slug)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button
                size="lg"
                disabled={selectedRows.length === 0 || status === "importing"}
                onClick={handleImport}
                title={selectedRows.length === 0 ? t("bulk.selectSomething") : undefined}
              >
                {status === "importing" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> {t("bulk.importing")}
                  </>
                ) : (
                  t("bulk.importN", {
                    count: selectedRows.length,
                    total: selectedTotalLabel || money(0),
                  })
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
