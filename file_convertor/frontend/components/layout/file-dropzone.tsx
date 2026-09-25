"use client"

import * as React from "react"
import { FileText, FileUp, Plus, RefreshCw, X } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { useT } from "@/lib/i18n"
import { formatSummary } from "@/lib/tools"
import { cn, formatBytes } from "@/lib/utils"

/** Matches MAX_UPLOAD_BYTES in backend/api/core/files.py. Checked here so a
 *  100MB scan is refused before it is uploaded rather than after. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

interface FileDropzoneProps {
  accept: string
  multiple: boolean
  files: File[]
  onFilesChange: (files: File[]) => void
  disabled?: boolean
  /** Hint mobile browsers to open the camera directly (Scan to PDF). */
  capture?: boolean
  /** Stop accepting files once this many are uploaded (e.g. Compare PDF
   *  needs exactly 2) — the drop area and "Add more" hide once reached. */
  maxFiles?: number
  /** Once a file is loaded, trade the large drop target for a slim row.
   *
   *  The section workspace shows the upload above the tool's own controls, and
   *  a 290px dashed rectangle sitting there permanently made the file the
   *  loudest thing on a screen whose subject is the tool. Empty, it still
   *  opens at full size — there is nothing else to look at yet. Dropping onto
   *  the row keeps working either way. */
  compactWhenFilled?: boolean
}

export function FileDropzone({
  accept,
  multiple,
  files,
  onFilesChange,
  disabled,
  capture,
  maxFiles,
  compactWhenFilled,
}: FileDropzoneProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const atCapacity = maxFiles !== undefined && files.length >= maxFiles
  const collapsed = Boolean(compactWhenFilled) && files.length > 0

  const accepted = React.useMemo(() => {
    const { shown, more } = formatSummary(accept)
    return more > 0 ? `${shown} ${t("dropzone.andMore", { count: more })}` : shown
  }, [accept, t])

  const allowedExts = React.useMemo(
    () => accept.split(",").map((e) => e.trim().toLowerCase()),
    [accept],
  )

  /**
   * Files the user offered that were not taken, and why.
   *
   * This is the whole reason this component changed. Before, a file of the
   * wrong type was dropped on the floor by `if (valid.length === 0) return`,
   * and anything past `maxFiles` was silently cut by `.slice()`. The user
   * dropped three files, saw two, and was told nothing — with no way to tell
   * whether the app had misread them or they had misread the app.
   */
  const [rejected, setRejected] = React.useState<string[]>([])

  const addFiles = React.useCallback(
    (incoming: FileList | File[]) => {
      const offered = Array.from(incoming)
      const reasons: string[] = []

      const typeOk = offered.filter((f) => {
        const ok = allowedExts.some((ext) => f.name.toLowerCase().endsWith(ext))
        if (!ok) reasons.push(t("dropzone.rejectedType", { name: f.name }))
        return ok
      })
      const sizeOk = typeOk.filter((f) => {
        const ok = f.size <= MAX_UPLOAD_BYTES
        if (!ok) {
          reasons.push(
            t("dropzone.rejectedSize", { name: f.name, limit: formatBytes(MAX_UPLOAD_BYTES) }),
          )
        }
        // An empty file reaches the backend as a 422 "Uploaded file is empty";
        // say so here instead.
        return ok
      })
      const nonEmpty = sizeOk.filter((f) => {
        const ok = f.size > 0
        if (!ok) reasons.push(t("dropzone.rejectedEmpty", { name: f.name }))
        return ok
      })

      const merged = multiple ? [...files, ...nonEmpty] : nonEmpty.slice(0, 1)
      const capped = maxFiles !== undefined ? merged.slice(0, maxFiles) : merged
      const dropped = merged.length - capped.length
      if (dropped > 0) reasons.push(t("dropzone.rejectedTooMany", { count: dropped }))

      setRejected(reasons)
      if (capped.length !== files.length || nonEmpty.length > 0) onFilesChange(capped)
    },
    [allowedExts, files, multiple, maxFiles, onFilesChange, t],
  )

  const removeFile = (index: number) => {
    setRejected([])
    onFilesChange(files.filter((_, i) => i !== index))
  }

  const dropLabel = (() => {
    if (files.length === 0) {
      if (capture) return t("dropzone.takePhoto")
      if (maxFiles !== undefined) return t("dropzone.dropNFiles", { count: maxFiles })
      return multiple ? t("dropzone.dropFiles") : t("dropzone.dropFile")
    }
    if (maxFiles !== undefined) {
      return t("dropzone.dropNMore", { count: maxFiles - files.length })
    }
    return multiple ? t("dropzone.dropMore") : t("dropzone.dropReplace")
  })()

  return (
    <div className="space-y-3">
      {/* Kept outside the drop target: collapsed mode does not render that
          element, and the Replace button still has to be able to open it. */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture ? "environment" : undefined}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ""
        }}
      />
      {!atCapacity && !collapsed && (
        <div
          role="button"
          tabIndex={0}
          aria-label={t("dropzone.selectFiles")}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!disabled) addFiles(e.dataTransfer.files)
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center sm:p-8",
            "transition-colors duration-[var(--dt-dur-instant)] ease-out",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-accent/50",
            disabled && "pointer-events-none opacity-60",
          )}
        >
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <FileUp className="size-6" />
          </span>
          <div>
            <div className="text-ui font-medium text-foreground">{dropLabel}</div>
            {/* Format names, not an extension list: "PDF, DOCX" reads;
                ".pdf, .doc, .docx, .odt, .rtf" is noise the user has to parse.
                Capped, too: a section workspace accepts everything its tools
                do between them, and Convert PDF's twenty formats wrapped to
                two full lines of chips that nobody reads. The rest are still
                accepted — the count says so, and the file picker enforces the
                real list. */}
            <div className="mt-1 text-caption text-muted-foreground">
              {t("dropzone.accepted", { exts: accepted })}
            </div>
          </div>
        </div>
      )}

      {rejected.length > 0 && (
        <Alert tone="error">
          <span className="block">
            {rejected.length === 1 ? rejected[0] : t("dropzone.rejectedSome", { count: rejected.length })}
          </span>
          {rejected.length > 1 && (
            <ul className="mt-1 list-inside list-disc text-caption">
              {rejected.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              {/* A sheet, not a card: this row IS the user's document. */}
              <Sheet flush className="flex items-center gap-2 px-3 py-2 text-ui">
                <FileText className="size-4 shrink-0 text-sheet-muted" aria-hidden />
                {/* `dir="ltr"` + `truncate` keeps the extension readable — the
                    end of a filename is the part that matters. */}
                <span className="min-w-0 flex-1 truncate" dir="ltr" title={file.name}>
                  {file.name}
                </span>
                <span className="shrink-0 text-caption text-sheet-muted">
                  {formatBytes(file.size)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-sheet-muted hover:bg-black/5 hover:text-sheet-foreground"
                  aria-label={t("dropzone.removeFile", { name: file.name })}
                  onClick={() => removeFile(index)}
                  disabled={disabled}
                >
                  <X className="size-4" />
                </Button>
              </Sheet>
            </li>
          ))}
          {collapsed && !atCapacity && (
            <li className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
              >
                {multiple ? <Plus className="size-4" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                {multiple ? t("common.addMoreFiles") : t("dropzone.replaceFile")}
              </Button>
            </li>
          )}
          {!collapsed && multiple && !atCapacity && (
            <li>
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
              >
                <Plus className="size-4" /> {t("dropzone.addMore")}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
