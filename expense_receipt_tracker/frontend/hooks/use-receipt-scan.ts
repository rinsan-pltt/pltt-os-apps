"use client"

import * as React from "react"

import { scanReceipt, type ReceiptDraft } from "@/lib/api"

export type ScanStatus = "idle" | "scanning" | "done" | "error"

export function useReceiptScan() {
  const [status, setStatus] = React.useState<ScanStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<ReceiptDraft | null>(null)

  const scan = React.useCallback(async (file: File) => {
    setStatus("scanning")
    setError(null)
    setDraft(null)
    try {
      const result = await scanReceipt(file)
      setDraft(result)
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not scan that receipt.")
      setStatus("error")
    }
  }, [])

  const reset = React.useCallback(() => {
    setStatus("idle")
    setError(null)
    setDraft(null)
  }, [])

  return { status, error, draft, scan, reset }
}
