"use client"

import * as React from "react"
import { FileText } from "lucide-react"

import { useT } from "@/lib/i18n"
import { cn, formatBytes } from "@/lib/utils"

/**
 * The document being reviewed, at a size you can actually read.
 *
 * The scan flow asks the user to confirm seven fields that were read off a
 * receipt — and until now showed that receipt as a 64×64 thumbnail in a
 * filename strip. Verification you can't perform isn't verification.
 *
 * PDFs are not embedded: the plugin renders in a sandboxed frame
 * (palette-plugin.json `frontend.sandbox`), where an inline PDF is typically
 * blocked and leaves a dead grey box. They get an honest file card instead.
 */
export function DocumentPreview({ file, className }: { file: File; className?: string }) {
  const t = useT()
  const [url, setUrl] = React.useState<string | null>(null)
  const isImage = file.type.startsWith("image/")

  React.useEffect(() => {
    if (!isImage) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, isImage])

  return (
    <figure
      className={cn(
        "receipt-preview flex flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-sunken/60",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL, not a static asset
          <img
            src={url}
            alt={t("scan.documentAlt", { name: file.name })}
            className="max-h-[26rem] w-full rounded-lg object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileText className="size-6" aria-hidden />
            </span>
            <p className="text-body font-medium">{file.name}</p>
            <p className="text-caption text-muted-foreground">{t("scan.pdfNoPreview")}</p>
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-inline border-t border-border px-3 py-2 text-caption text-muted-foreground">
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 numeral">{formatBytes(file.size)}</span>
      </figcaption>
    </figure>
  )
}
