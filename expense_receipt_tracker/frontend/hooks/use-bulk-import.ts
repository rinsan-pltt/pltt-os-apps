"use client"

import * as React from "react"

import {
  commitImport,
  previewImport,
  type ExpenseStatus,
  type ImportCommitRow,
  type ImportRow,
} from "@/lib/api"

export type BulkImportStatus = "idle" | "reading" | "ready" | "importing" | "done" | "error"

export function useBulkImport() {
  const [status, setStatus] = React.useState<BulkImportStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<ImportRow[]>([])
  const [importedCount, setImportedCount] = React.useState(0)

  const read = React.useCallback(async (file: File) => {
    setStatus("reading")
    setError(null)
    setRows([])
    try {
      const preview = await previewImport(file)
      setRows(preview.rows)
      setStatus("ready")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.")
      setStatus("error")
    }
  }, [])

  const commit = React.useCallback(async (finalRows: ImportCommitRow[]) => {
    setStatus("importing")
    setError(null)
    try {
      const result = await commitImport(finalRows)
      setImportedCount(result.created)
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import those expenses.")
      setStatus("error")
    }
  }, [])

  const reset = React.useCallback(() => {
    setStatus("idle")
    setError(null)
    setRows([])
    setImportedCount(0)
  }, [])

  return { status, error, rows, importedCount, read, commit, reset }
}

/** Convert a draft row (from preview) plus a batch-wide status into the
 *  shape `POST /imports/commit` expects. */
export function toCommitRow(row: ImportRow, status: ExpenseStatus): ImportCommitRow | null {
  if (!row.vendor.trim() || row.amount == null || !row.expense_date) return null
  return {
    vendor: row.vendor.trim(),
    amount: row.amount,
    currency: row.currency?.trim() || "USD",
    category: row.category,
    expense_date: row.expense_date,
    status,
    notes: row.notes ?? undefined,
  }
}
