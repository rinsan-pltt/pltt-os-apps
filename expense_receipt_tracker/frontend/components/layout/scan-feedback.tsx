"use client"

import { AlertCircle, CheckCircle2, Loader2, ScanLine } from "lucide-react"

import { useT } from "@/lib/i18n"
import type { ReceiptDraft } from "@/lib/api"
import type { ScanStatus } from "@/hooks/use-receipt-scan"
import { cn } from "@/lib/utils"

/**
 * What the scanner made of the document.
 *
 * This exact four-branch ladder was duplicated verbatim in the scan page and
 * the expense form; the two copies had already drifted apart in markup. The
 * branches themselves are unchanged — same conditions, same strings — but the
 * result is now announced, because "we couldn't read the total" is precisely
 * the kind of thing a screen-reader user needs to know before saving.
 */
export function ScanFeedback({
  status,
  error,
  draft,
  className,
}: {
  status: ScanStatus
  error: string | null
  draft: ReceiptDraft | null
  className?: string
}) {
  const t = useT()

  const base = cn("flex items-center gap-2 text-body", className)

  if (status === "scanning") {
    return (
      <p role="status" aria-live="polite" className={cn(base, "text-muted-foreground")}>
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> {t("scan.reading")}
      </p>
    )
  }

  if (status === "error" && error) {
    return (
      <p role="alert" className={cn(base, "text-destructive-text")}>
        <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
      </p>
    )
  }

  if (status !== "done" || !draft) return null

  if (!draft.ocr_available) {
    return (
      <p role="status" aria-live="polite" className={cn(base, "text-muted-foreground")}>
        <AlertCircle className="size-4 shrink-0" aria-hidden /> {t("scan.ocrUnavailable")}
      </p>
    )
  }

  if (!draft.vendor || draft.amount == null) {
    return (
      <p role="status" aria-live="polite" className={cn(base, "text-muted-foreground")}>
        <ScanLine className="size-4 shrink-0" aria-hidden /> {t("scan.someUnread")}
      </p>
    )
  }

  return (
    <p role="status" aria-live="polite" className={cn(base, "text-success")}>
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />{" "}
      {t("scan.extracted", { ai: draft.llm_assisted ? t("scan.aiAssist") : "" })}
    </p>
  )
}

/** Marks a field the scanner filled in, so the user knows what to double-check
 *  rather than trusting every prefilled box equally. */
export function AutofilledHint({ children }: { children?: React.ReactNode }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-1 text-micro text-primary">
      <ScanLine className="size-3" aria-hidden />
      {children ?? t("scan.autofilled")}
    </span>
  )
}
