"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { IconPhotoPlus, IconX, IconArrowsMaximize } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/sonner"
import { usePlttCreativeVideoPortalContainer } from "@/components/ui/app-portal"
import { InfoHint } from "@/components/ui/info-hint"

// Either a local file picked/dropped by the user (uploaded on generate) or an
// already-hosted image (e.g. a generated image reused as a start frame), which
// needs no re-upload.
export type RefImage =
  | { file: File; url?: undefined; previewUrl: string }
  | { file?: undefined; url: string; previewUrl: string }
  | null

// Upload constraints for start/end/reference/element images.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_BYTES = 30 * 1024 * 1024 // 30 MB
const UPLOAD_HINT = "Supported formats: JPEG, PNG, WebP. Max 30 MB."

/**
 * A reference-image slot for the video panel. Accepts an image by clicking
 * (file picker) or by dragging one onto it — mirroring the image control
 * panel's reference upload. Once set it shows the preview with a "view larger"
 * icon (opens a closable full-screen viewer) and a remove button.
 */
export function ReferenceSlot({
  label,
  optionalLabel,
  value,
  onChange,
  className,
  hint,
}: {
  label: string
  optionalLabel: string
  value: RefImage
  onChange: (v: RefImage) => void
  className?: string
  // Shows an "i" icon next to the label that reveals this text on click.
  hint?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [viewing, setViewing] = React.useState(false)
  const portalHost = usePlttCreativeVideoPortalContainer()

  const setFile = (file: File | undefined | null) => {
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Unsupported image format", { description: "Use JPEG, PNG or WebP." })
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image too large", { description: "Maximum size is 30 MB." })
      return
    }
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl)
    onChange({ file, previewUrl: URL.createObjectURL(file) })
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl)
    onChange(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  // Close the large viewer on Escape.
  React.useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewing(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [viewing])

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files?.length) {
          setFile(e.dataTransfer.files[0])
          return
        }
        // Hosted image dragged in (e.g. a generated image from the
        // workspace) — take its URL directly, no upload needed.
        const uri = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"))
          .split("\n")[0]
          ?.trim()
        if (uri && /^https?:\/\//.test(uri)) {
          if (value?.file) URL.revokeObjectURL(value.previewUrl)
          onChange({ url: uri, previewUrl: uri })
        }
      }}
      title={UPLOAD_HINT}
      className={cn(
        "group relative rounded-lg aspect-square bg-muted/50 flex flex-col items-center justify-center text-sm border border-dashed p-4 gap-1.5 cursor-pointer hover:bg-muted/70 transition-colors overflow-hidden text-muted-foreground",
        dragOver && "border-accent-foreground/50 bg-muted/80",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0])}
      />
      {value ? (
        <>
          <img src={value.previewUrl} alt={label} className="absolute inset-0 size-full object-cover" />
          {/* View larger */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setViewing(true)
            }}
            aria-label="View larger"
            title="View larger"
            className="absolute top-1 left-1 z-10 size-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
          >
            <IconArrowsMaximize className="size-3" />
          </button>
          {/* Remove */}
          <button
            type="button"
            onClick={clear}
            aria-label="Remove"
            title="Remove"
            className="absolute top-1 right-1 z-10 size-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
          >
            <IconX className="size-3" />
          </button>
        </>
      ) : (
        <>
          <IconPhotoPlus className="size-5 opacity-60" />
          <div className="flex items-center gap-1">
            <p className="font-medium text-sm text-center">{label}</p>
            {hint && <InfoHint text={hint} />}
          </div>
          <p>{optionalLabel}</p>
        </>
      )}

      {/* Large viewer — portaled out of the panel so the fixed overlay isn't
          re-scoped by an ancestor. Click backdrop, the close button, or Escape. */}
      {viewing && value &&
        createPortal(
          <div
            // Portaled content bubbles through the REACT tree, so without
            // stopPropagation these clicks reach the slot's onClick and reopen
            // the file picker. Stop them here.
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
            onClick={(e) => {
              e.stopPropagation()
              setViewing(false)
            }}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setViewing(false)
              }}
              aria-label="Close"
              className="absolute z-10 cursor-pointer top-4 right-4 size-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors"
            >
              <IconX className="size-5" />
            </button>
            <img
              src={value.previewUrl}
              alt={label}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          portalHost ?? document.body,
        )}
    </div>
  )
}
