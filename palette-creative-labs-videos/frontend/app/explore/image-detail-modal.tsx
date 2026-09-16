import React from "react"
import { IconChevronLeft, IconChevronRight, IconCopy, IconDownload, IconMinus, IconPlus, IconTrash, IconSparkles, IconX } from "@tabler/icons-react"
import { CopyPromptButton } from "@/components/ui/copy-prompt-button"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/lib/api-helper"
import { toast } from "@/components/ui/sonner"
import { videoModelOptions } from "@/components/layout/video-helper"
import {
  usePromptComposer,
  remixSettingsFromItem,
} from "@/components/providers/prompt-composer-context"
import { MARK_COLORS, type Favourite } from "./types"
import { favId } from "./utils"
import { Button } from "@/components/ui/button"
import { useT, useTimeAgo } from "@/lib/i18n"

interface Props {
  fav: Favourite
  onClose: () => void
  onGroupChange: (id: string, group: string | null) => void
  onDelete?: (id: string) => void
  // Navigate to the previous/next image. Pass undefined when there is none —
  // the corresponding arrow is then hidden.
  onPrev?: () => void
  onNext?: () => void
}

export function ImageDetailModal({ fav, onClose, onGroupChange, onDelete, onPrev, onNext }: Props) {
  const { t } = useT()
  const timeAgo = useTimeAgo()
  const composer = usePromptComposer()
  const id = favId(fav)
  const model = videoModelOptions.find((m) => m.value === fav.model_name)
  const currentGroup = (fav.group || "").toUpperCase()
  const [updating, setUpdating] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  // Show a placeholder until the video's first frame is decoded so opening a
  // video never flashes black before it loads.
  const [videoLoaded, setVideoLoaded] = React.useState(false)

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") onPrev?.()
      else if (e.key === "ArrowRight") onNext?.()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, onPrev, onNext])

  React.useEffect(() => {
    setVideoLoaded(false)
  }, [fav.url])

  const setGroup = async (color: string | null) => {
    if (!id) return
    const target = color ? color.toUpperCase() : null
    if (target === (currentGroup || null)) return
    setUpdating(color ?? "null")
    onGroupChange(id, target)
    try {
      await apiRequest(`/favourites/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ group: target }),
      })
    } catch (err) {
      onGroupChange(id, fav.group ?? null)
      toast.error(t("explore.updateColorFailed"), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setUpdating(null)
    }
  }

  const handleCopy = async () => {
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
          const canvas = document.createElement("canvas")
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))), "image/png")
        }
        img.onerror = reject
        img.src = fav.url
      })
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
      toast.success(t("explore.imageCopied"))
    } catch {
      // fallback: copy URL
      try {
        await navigator.clipboard.writeText(fav.url)
        toast.success(t("explore.imageUrlCopied"))
      } catch {
        toast.error(t("explore.copyFailed"))
      }
    }
  }

  const handleDownload = async () => {
    try {
      const res = await fetch(fav.url)
      const blob = await res.blob()
      const ext = blob.type.split("/")[1] || "jpg"
      const filename = `${id || "image"}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t("explore.downloadFailed"))
    }
  }

  const handleDelete = async () => {
    if (!id || deleting) return
    setDeleting(true)
    try {
      await apiRequest(`/images/${id}`, { method: "DELETE" })
      onDelete?.(id)
      onClose()
    } catch (err) {
      toast.error(t("explore.deleteFailed"), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/10 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1400px] h-full max-h-[800px] bg-background border border-border grid grid-cols-[1fr_360px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: media */}
        {fav.url_before_upscale ? (
          <CompareSlider
            before={fav.url_before_upscale}
            after={fav.url}
            group={fav.group}
            onPrev={onPrev}
            onNext={onNext}
          />
        ) : (
          <div className="relative bg-background h-full flex items-center justify-center min-w-0 overflow-hidden border-r border-border50 select-none">
            <video
              src={fav.url}
              poster={fav.thumbnail_url ?? undefined}
              controls
              loop
              muted
              playsInline
              onLoadedData={(e) => {
                setVideoLoaded(true)
                e.currentTarget.play().catch(() => {})
              }}
              className="max-w-full max-h-full object-contain"
            />

            {/* Thumbnail placeholder until the first frame is decoded — only
                needed as a fallback when there's no server-extracted poster. */}
            {!videoLoaded && !fav.thumbnail_url && (
              <div className="absolute inset-0 bg-secondary/60 animate-pulse pointer-events-none" />
            )}

            {/* Color mark dot — top-right, mirrors the grid thumbnails. */}
            {fav.group && (
              <span
                className="absolute top-3 right-3 z-10 size-3 rounded-full ring-2 ring-black/40 pointer-events-none"
                style={{ backgroundColor: fav.group }}
              />
            )}

            {/* Prev/next arrows — vertically centered. */}
            {onPrev && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPrev() }}
                aria-label="Previous video"
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 size-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconChevronLeft className="size-5" strokeWidth={1.5} />
              </button>
            )}
            {onNext && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNext() }}
                aria-label="Next video"
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 size-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconChevronRight className="size-5" strokeWidth={1.5} />
              </button>
            )}
          </div>
        )}

        {/* Right: info */}
        <div className="flex flex-col min-h-0 bg-secondary/50">
          {/* Header with close */}
          <div className="flex items-center justify-end p-4 border-b">
            <Button variant="outline" size="iconSm" onClick={onClose}>
              <IconX />
            </Button>
          </div>

          {/* Content — the info rows and color mark stay pinned; only the
              prompt text scrolls when it grows too long. */}
          <div className="flex-1 min-h-0 px-6 py-5 flex flex-col gap-5">
            <InfoRow label={t("explore.project")} value={fav.project_name || fav.name} />
            <InfoRow label={t("explore.keyframe")} value={fav.key_frame_name} />
            <InfoRow label={t("explore.engine")} value={model?.label ?? fav.model_name} />
            <InfoRow label={t("explore.ratio")} value={fav.aspect_ratio} />
            <InfoRow label={t("explore.archived")} value={timeAgo(fav.updated_at || fav.created_at)} />

            <div className="border-t border-dashed border-border40" />

            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                  {t("explore.promptLabel")}
                </span>
                <CopyPromptButton text={fav.prompt} />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <p className="text-xs text-foreground leading-relaxed uppercase">
                  {fav.prompt || <span className="text-muted-foreground/60">—</span>}
                </p>
              </div>
            </div>

            <div className="border-t border-dashed border-border40" />

            <div className="flex flex-col gap-3 shrink-0">
              <span className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                {t("explore.colorMark")}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGroup(null)}
                  disabled={updating !== null}
                  aria-label={t("explore.noMark")}
                  title={t("explore.noMark")}
                  className={cn(
                    "size-3.5 rounded-full border-2 border-dashed border-border60 transition-transform hover:scale-110",
                    !currentGroup && "border-foreground bg-foreground/10",
                    updating !== null && "opacity-60"
                  )}
                />
                {MARK_COLORS.map((c) => {
                  const active = currentGroup === c.toUpperCase()
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setGroup(c)}
                      disabled={updating !== null}
                      aria-label={t("explore.markColor", { color: c })}
                      title={c}
                      className={cn(
                        "size-3.5 rounded-full transition-transform hover:scale-110",
                        active &&
                        "ring-1 ring-offset-1 ring-offset-secondary ring-foreground",
                        updating === c && "opacity-60"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          {/* Action buttons grid */}
          <div className="grid grid-cols-2 border-t">
            <ActionButton icon={<IconCopy className="size-3" />} label={t("common.copy")} onClick={handleCopy} />
            <ActionButton
              icon={<IconDownload className="size-3" />}
              label={t("common.download")}
              onClick={handleDownload}
              className="border-l border-border"
            />
            <ActionButton
              icon={<IconTrash className="size-3" />}
              label={deleting ? t("common.deleting") : t("common.delete")}
              onClick={handleDelete}
              disabled={deleting}
              className="border-t border-border"
            />
            <ActionButton
              icon={<IconSparkles className="size-3" />}
              label={t("video.remix")}
              onClick={() => {
                if (composer && fav.prompt) {
                  composer.reuse(fav.prompt, remixSettingsFromItem(fav))
                  onClose()
                }
              }}
              disabled={!composer || !fav.prompt}
              className="border-t border-l"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-3">
      <span className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
        {label}
      </span>
      <span className="text-xs tracking-wide text-foreground truncate uppercase">
        {value || <span className="text-muted-foreground/60">—</span>}
      </span>
    </div>
  )
}

function CompareSlider({
  before,
  after,
  group,
  onPrev,
  onNext,
}: {
  before: string
  after: string
  // Color mark of the image — shown as a dot left of the "After" label, the
  // same mark the plain view shows in its top-right corner.
  group?: string | null
  // Same prev/next navigation as the plain image view — undefined hides the
  // corresponding arrow.
  onPrev?: () => void
  onNext?: () => void
}) {
  const { t } = useT()
  const MIN_SCALE = 1
  const MAX_SCALE = 12
  const ZOOM_STEP = 1
  const [pos, setPos] = React.useState(50)
  const [scale, setScale] = React.useState(1)
  const [origin, setOrigin] = React.useState({ x: 50, y: 50 })
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const isZoomed = scale > 1

  // Step the zoom from the +/- control, resetting the pan once back at fit —
  // mirrors the plain view's applyScale.
  const applyScale = (next: number) => {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next))
    setScale(clamped)
    if (clamped <= 1) {
      setOrigin({ x: 50, y: 50 })
      setPan({ x: 0, y: 0 })
    }
  }

  // Wheel-to-zoom while zoomed in (when the +/- control is visible) — same as
  // the plain view. Native non-passive listener so preventDefault works.
  React.useEffect(() => {
    const el = containerRef.current
    if (!el || scale <= 1) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      applyScale(scale - e.deltaY * 0.01)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  const containerRef = React.useRef<HTMLDivElement>(null)
  const handleDrag = React.useRef<{ startX: number; startPos: number } | null>(null)
  const panDrag = React.useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null)

  const zoomStyle: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
    transformOrigin: `${origin.x}% ${origin.y}%`,
    transition: panDrag.current ? "none" : "transform 200ms ease",
  }

  // Compare handle drag — stop propagation so container pan doesn't trigger
  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    handleDrag.current = { startX: e.clientX, startPos: pos }
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (!handleDrag.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos(Math.min(100, Math.max(0, handleDrag.current.startPos + ((e.clientX - handleDrag.current.startX) / rect.width) * 100)))
  }
  const onHandleUp = () => { handleDrag.current = null }

  // Container: pan when zoomed, click to toggle zoom. `isDragging` drives the
  // grab/grabbing hand cursor while zoomed, like the plain image view.
  const [isDragging, setIsDragging] = React.useState(false)
  const onContainerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    panDrag.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false }
    if (isZoomed) setIsDragging(true)
  }
  const onContainerMove = (e: React.PointerEvent) => {
    if (!panDrag.current) return
    const dx = e.clientX - panDrag.current.startX
    const dy = e.clientY - panDrag.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panDrag.current.moved = true
    if (scale > 1) setPan({ x: panDrag.current.panX + dx, y: panDrag.current.panY + dy })
  }
  const onContainerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDrag.current) return
    const wasDrag = panDrag.current.moved
    panDrag.current = null
    setIsDragging(false)
    if (!wasDrag) {
      const rect = e.currentTarget.getBoundingClientRect()
      setOrigin({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
      setPan({ x: 0, y: 0 })
      setScale(s => s === 1 ? 3 : 1)
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative bg-background min-w-0 overflow-hidden border-r border-border50 select-none"
      // Not zoomed → zoom-in. Zoomed → grab (can pan), grabbing while the
      // button is held — same hand cursor as the plain image view.
      style={{ cursor: !isZoomed ? "zoom-in" : isDragging ? "grabbing" : "grab" }}
      onPointerDown={onContainerDown}
      onPointerMove={onContainerMove}
      onPointerUp={onContainerUp}
    >
      {/* After (upscaled) — full area, zoomed */}
      <div className="absolute inset-0" style={zoomStyle}>
        <img src={after} alt="After" className="w-full h-full object-contain" draggable={false} />
      </div>

      {/* Before (original) — clip-path at container level so handle aligns with visual edge */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <div className="absolute inset-0" style={zoomStyle}>
          <img src={before} alt="Before" className="w-full h-full object-contain" draggable={false} />
        </div>
      </div>

      {/* Spacer for natural height */}
      <img src={after} alt="" className="invisible w-full h-full object-contain" draggable={false} />

      {/* Divider */}
      <div className="absolute top-0 bottom-0 w-px bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)] pointer-events-none" style={{ left: `${pos}%` }} />

      {/* Handle */}
      <div
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 size-9 bg-white flex items-center justify-center shadow-md z-10"
        style={{ left: `${pos}%`, cursor: "col-resize" }}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M5 8H1M1 8L3 6M1 8L3 10M11 8H15M15 8L13 6M15 8L13 10" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Prev/next arrows — same as the plain image view; hidden while zoomed
          in so they don't get in the way of panning. */}
      {!isZoomed && onPrev && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onPrev() }}
          aria-label="Previous image"
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 size-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <IconChevronLeft className="size-5" strokeWidth={1.5} />
        </button>
      )}
      {!isZoomed && onNext && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onNext() }}
          aria-label="Next image"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 size-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <IconChevronRight className="size-5" strokeWidth={1.5} />
        </button>
      )}

      {/* Zoom control — only while zoomed in, like the plain view. Sits BELOW
          the "After" label, which already occupies the top-right corner. */}
      {isZoomed && (
        <div
          className="absolute top-10 right-3 z-10 flex flex-col border border-white/20 rounded-md overflow-hidden bg-black/50 text-white"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); applyScale(scale + ZOOM_STEP) }}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            className="size-8 flex items-center justify-center hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
          >
            <IconPlus className="size-4" strokeWidth={2} />
          </button>
          <div className="h-px bg-white/20" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); applyScale(scale - ZOOM_STEP) }}
            aria-label="Zoom out"
            className="size-8 flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer"
          >
            <IconMinus className="size-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Labels — the color mark dot sits left of "After", mirroring the
          plain view's top-right mark. */}
      <span className="absolute top-3 left-3 text-[10px] uppercase tracking-widest text-white/80 bg-black/50 px-1.5 py-0.5 pointer-events-none">{t("explore.before")}</span>
      <span className="absolute top-3 right-3 flex items-center gap-2 pointer-events-none">
        {group && (
          <span
            className="size-3 rounded-full ring-2 ring-black/40"
            style={{ backgroundColor: group }}
          />
        )}
        <span className="text-[10px] uppercase tracking-widest text-white/80 bg-black/50 px-1.5 py-0.5">{t("explore.after")}</span>
      </span>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  className,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Button
      onClick={onClick}
      size={"sm"}
      disabled={disabled}
      variant="ghost"
      className={cn('[&>svg]:size-3', className)}
    >
      {icon}
      <span>{label}</span>
    </Button>
  )
}
