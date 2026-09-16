"use client"

import * as React from "react"
import { Download, Eye, Loader2, Paperclip } from "lucide-react"

import { Button } from "@/components/ui/button"
import { downloadBlob, getExpenseReceipt } from "@/lib/api"
import { useT } from "@/lib/i18n"

/**
 * The stored receipt, finally visible.
 *
 * `getExpenseReceipt()` has been exported from lib/api.ts all along with no
 * caller: you could attach a receipt and then never look at it again, in an app
 * called Receipt Tracker. `has_receipt` only ever drove a paperclip icon.
 *
 * Fetched on demand rather than on mount — most edits don't need the image, and
 * the file can be several megabytes.
 */
export function StoredReceipt({
  expenseId,
  originalName,
}: {
  expenseId: string
  originalName?: string | null
}) {
  const t = useT()
  const [state, setState] = React.useState<"idle" | "loading" | "shown" | "error">("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [file, setFile] = React.useState<{ url: string; blob: Blob; filename: string } | null>(null)

  // Revoke the object URL when this unmounts or the file is replaced.
  React.useEffect(() => {
    return () => {
      if (file) URL.revokeObjectURL(file.url)
    }
  }, [file])

  const load = async (thenDownload = false) => {
    setState("loading")
    setError(null)
    try {
      const result = await getExpenseReceipt(expenseId)
      setFile({
        url: URL.createObjectURL(result.blob),
        blob: result.blob,
        filename: result.filename,
      })
      setState("shown")
      if (thenDownload) downloadBlob(result.blob, result.filename)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("receipt.couldNotLoad"))
      setState("error")
    }
  }

  // Guess from the stored name before fetching, so the button offers the
  // action that will actually work. The plugin renders in a sandboxed frame
  // (palette-plugin.json: frontend.sandbox = true), where an inline <object>
  // PDF is typically blocked — offering "View" for a PDF is a dead end that
  // leaves an empty box. Images preview fine from a blob URL.
  const looksLikePdf = /\.pdf$/i.test(originalName ?? "")

  return (
    <div className="rounded-xl border border-border bg-surface-sunken/50 p-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Paperclip className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {originalName || file?.filename || t("receipt.attached")}
          </p>
          <p className="text-xs text-muted-foreground">{t("receipt.storedHint")}</p>
        </div>
        {state === "shown" && file ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadBlob(file.blob, file.filename)}
          >
            <Download className="size-4" /> {t("receipt.download")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => load(looksLikePdf)}
            disabled={state === "loading"}
          >
            {state === "loading" ? (
              <>
                <Loader2 className="size-4 animate-spin" /> {t("receipt.loading")}
              </>
            ) : looksLikePdf ? (
              <>
                <Download className="size-4" /> {t("receipt.download")}
              </>
            ) : (
              <>
                <Eye className="size-4" /> {t("receipt.view")}
              </>
            )}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive-text">
          {error}
        </p>
      )}

      {state === "shown" && file && !looksLikePdf && (
        <div className="receipt-preview mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, not a static asset */}
          <img
            src={file.url}
            alt={t("receipt.previewAria")}
            className="max-h-72 w-full rounded-lg border border-border object-contain"
          />
        </div>
      )}
    </div>
  )
}
