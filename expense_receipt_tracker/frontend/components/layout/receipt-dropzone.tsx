"use client"

import * as React from "react"
import { FileUp, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn, formatBytes } from "@/lib/utils"

const ACCEPT = ".jpg,.jpeg,.png,.webp,.bmp,.tiff,.gif,.pdf"

/** Generic drag/drop-or-browse file picker, shaped like the thing it accepts.
 *  Defaults are tuned for the single-receipt scan flow; pass
 *  `accept`/`title`/`hint` to reuse it for the bulk spreadsheet/statement
 *  import flow instead. */
export function ReceiptDropzone({
  file,
  onFileChange,
  disabled,
  accept = ACCEPT,
  title,
  hint,
  compact = false,
}: {
  file: File | null
  onFileChange: (file: File | null) => void
  disabled?: boolean
  accept?: string
  title?: string
  hint?: string
  /** Short horizontal layout for dialogs, where the tall centred version costs
   *  ~130px of height and pushes the form's buttons out of view. */
  compact?: boolean
}) {
  const t = useT()
  const resolvedTitle = title ?? t("dropzone.title")
  const resolvedHint = hint ?? t("dropzone.hint")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (incoming: FileList | null) => {
    const picked = incoming?.[0]
    if (picked) onFileChange(picked)
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL, not a static asset
          <img
            src={previewUrl}
            alt={t("dropzone.receiptPreview")}
            className="size-16 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileUp className="size-6" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("dropzone.removeReceipt")}
          disabled={disabled}
          onClick={() => onFileChange(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={t("dropzone.selectReceipt")}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          // Without preventDefault, Space scrolls the page as well as opening
          // the picker — the classic div-as-button bug.
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
      className={cn(
        // No receipt-edge here: the scalloped mask needs a solid fill to read,
        // and on a dashed, near-transparent outline it just looked like a
        // clipped border. The motif stays in the one place it works — the
        // balance panel.
        "cursor-pointer rounded-xl border-2 border-dashed",
        compact
          ? "flex items-center gap-3 p-3 text-left"
          : "flex flex-col items-center justify-center gap-3 p-8 text-center sm:p-10",
        "transition-colors duration-[120ms] ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        dragging
          ? "border-primary bg-primary/5"
          : "border-input bg-surface-sunken/40 hover:border-primary hover:bg-accent/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary",
          compact ? "size-9" : "size-12",
        )}
      >
        <FileUp className={compact ? "size-4" : "size-6"} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="font-medium">{resolvedTitle}</div>
        <div className="mt-0.5 text-caption text-muted-foreground">{resolvedHint}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ""
        }}
      />
    </div>
  )
}
