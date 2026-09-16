"use client"

import * as React from "react"
import { Loader2, Maximize2, RefreshCw } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { downloadBlob, organizePreview, runTool, type OrganizePreview } from "@/lib/api"
import { useRegistryText } from "@/lib/i18n"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "working" | "done" | "error"
type Rect = { x: number; y: number; w: number; h: number }

const PREVIEW_SCALE = 0.3
const MIN_FRAC = 0.05
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
const DEFAULT_RECT: Rect = { x: 0.06, y: 0.06, w: 0.88, h: 0.88 }

// Resize handles: position (% within the crop box) + drag mode + cursor.
const HANDLES = [
  { id: "nw", l: 0, t: 0, cursor: "nwse-resize" },
  { id: "n", l: 50, t: 0, cursor: "ns-resize" },
  { id: "ne", l: 100, t: 0, cursor: "nesw-resize" },
  { id: "e", l: 100, t: 50, cursor: "ew-resize" },
  { id: "se", l: 100, t: 100, cursor: "nwse-resize" },
  { id: "s", l: 50, t: 100, cursor: "ns-resize" },
  { id: "sw", l: 0, t: 100, cursor: "nesw-resize" },
  { id: "w", l: 0, t: 50, cursor: "ew-resize" },
] as const

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function CropWorkspace({ tool }: { tool: Tool }) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = React.useState<File[]>([])

  const [preview, setPreview] = React.useState<OrganizePreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [pageSize, setPageSize] = React.useState<{ width: number; height: number } | null>(null)
  const [selectedPage, setSelectedPage] = React.useState(1)
  const [rect, setRect] = React.useState<Rect>(DEFAULT_RECT)

  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)

  const pickerRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ mode: string; sx: number; sy: number; rect: Rect } | null>(null)

  const pdfFile = files[0] ?? null
  const canRun = !!pdfFile && !!preview && status !== "working"

  React.useEffect(() => {
    if (!pdfFile) {
      setPreview(null)
      setPageSize(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    setRect(DEFAULT_RECT)
    organizePreview(pdfFile)
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        setSelectedPage(p.pages.length > 0 ? p.pages[0].index : 1)
      })
      .catch((e) => {
        if (cancelled) return
        setPreview(null)
        setPreviewError(e instanceof Error ? e.message : t("crop.previewFailed"))
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfFile])

  const currentPage = preview?.pages.find((p) => p.index === selectedPage) ?? null

  const onPreviewImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setPageSize({ width: img.naturalWidth / PREVIEW_SCALE, height: img.naturalHeight / PREVIEW_SCALE })
    }
  }

  const pickerFrac = (clientX: number, clientY: number) => {
    const el = pickerRef.current!
    const r = el.getBoundingClientRect()
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height }
  }

  const beginDrag = (mode: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pageSize || !pickerRef.current) return
    e.stopPropagation()
    pickerRef.current.setPointerCapture(e.pointerId)
    const f = pickerFrac(e.clientX, e.clientY)
    drag.current = { mode, sx: f.x, sy: f.y, rect: { ...rect } }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const f = pickerFrac(e.clientX, e.clientY)
    const dx = f.x - d.sx
    const dy = f.y - d.sy
    if (d.mode === "move") {
      const x = Math.min(Math.max(0, d.rect.x + dx), 1 - d.rect.w)
      const y = Math.min(Math.max(0, d.rect.y + dy), 1 - d.rect.h)
      setRect({ x, y, w: d.rect.w, h: d.rect.h })
      return
    }
    let left = d.rect.x
    let top = d.rect.y
    let right = d.rect.x + d.rect.w
    let bottom = d.rect.y + d.rect.h
    if (d.mode.includes("w")) left = Math.min(clamp01(d.rect.x + dx), right - MIN_FRAC)
    if (d.mode.includes("e")) right = Math.max(clamp01(right + dx), left + MIN_FRAC)
    if (d.mode.includes("n")) top = Math.min(clamp01(d.rect.y + dy), bottom - MIN_FRAC)
    if (d.mode.includes("s")) bottom = Math.max(clamp01(bottom + dy), top + MIN_FRAC)
    setRect({ x: left, y: top, w: right - left, h: bottom - top })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    try {
      pickerRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* capture may already be released */
    }
  }

  // Kept-area size and the resulting margins, in PDF points.
  const readout = React.useMemo(() => {
    if (!pageSize) return null
    const { width: W, height: H } = pageSize
    return {
      keepW: Math.round(rect.w * W),
      keepH: Math.round(rect.h * H),
      top: Math.round(rect.y * H),
      right: Math.round((1 - rect.x - rect.w) * W),
      bottom: Math.round((1 - rect.y - rect.h) * H),
      left: Math.round(rect.x * W),
    }
  }, [pageSize, rect])

  const run = async () => {
    if (!pdfFile) return
    setStatus("working")
    setError(null)
    try {
      const result = await runTool(tool.slug, [pdfFile], {
        rect: [rect.x, rect.y, rect.w, rect.h].map((v) => v.toFixed(4)).join(","),
      })
      downloadBlob(result.blob, result.filename)
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("crop.failed"))
      setStatus("error")
    }
  }

  const startOver = () => {
    setFiles([])
    setPreview(null)
    setPageSize(null)
    setRect(DEFAULT_RECT)
    setStatus("idle")
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
          <CardDescription>{t("crop.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FileDropzone
            accept={tool.accept}
            multiple={false}
            files={files}
            onFilesChange={(next) => {
              setFiles(next)
              setStatus("idle")
            }}
            disabled={status === "working"}
          />

          {previewError && (
            <Alert tone="error">{previewError}</Alert>
          )}

          {pdfFile && preview && preview.pages.length > 1 && (
            <div className="grid gap-1.5">
              <Label>{t("crop.previewPage")}</Label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {preview.pages.map((p) => (
                  <button
                    key={p.index}
                    type="button"
                    onClick={() => setSelectedPage(p.index)}
                    disabled={status === "working"}
                    className={cn(
                      "flex shrink-0 flex-col items-center gap-1 rounded-lg border-2 p-1 transition-colors",
                      selectedPage === p.index ? "border-primary" : "border-transparent hover:border-border",
                    )}
                  >
                    <img
                      src={p.thumbnail}
                      alt={`Page ${p.index}`}
                      className="h-20 w-auto rounded border bg-white object-contain"
                      draggable={false}
                    />
                    <span className="text-xs text-muted-foreground">{p.index}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Crop area{preview && preview.pages.length > 1 ? ` (page ${selectedPage})` : ""}</Label>
              {readout && (
                <span className="text-xs text-muted-foreground">
                  Keep {readout.keepW} × {readout.keepH} pt
                </span>
              )}
            </div>
            <div
              ref={pickerRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative touch-none select-none overflow-hidden rounded-lg border bg-muted/30"
            >
              {currentPage ? (
                <img
                  src={currentPage.thumbnail}
                  alt={`Page ${selectedPage} preview`}
                  className="block w-full"
                  onLoad={onPreviewImgLoad}
                  draggable={false}
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  {previewLoading ? t("crop.rendering") : t("crop.uploadFirst")}
                </div>
              )}
              {currentPage && pageSize && (
                <div
                  onPointerDown={beginDrag("move")}
                  className="absolute border-2 border-primary"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                    cursor: "move",
                  }}
                >
                  {HANDLES.map((hd) => (
                    <div
                      key={hd.id}
                      onPointerDown={beginDrag(hd.id)}
                      className="absolute size-3 rounded-[2px] border-2 border-white bg-primary shadow"
                      style={{ left: `${hd.l}%`, top: `${hd.t}%`, transform: "translate(-50%, -50%)", cursor: hd.cursor }}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {readout
                  ? `Trim T ${readout.top} · R ${readout.right} · B ${readout.bottom} · L ${readout.left} pt — applied to every page.`
                  : t("crop.everyPage")}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRect(FULL)}
                disabled={status === "working" || !pageSize}
              >
                <Maximize2 className="size-4" aria-hidden /> {t("crop.fullPage")}
              </Button>
            </div>
          </div>

          {status === "error" && error && (
            <Alert tone="error">{error}</Alert>
          )}
          {status === "done" && (
            <Alert tone="success">{t("common.doneDownloadStarted")}</Alert>
          )}
          {status === "working" && (
            <BusyPanel label={t("crop.working")} />
          )}

          <div className="flex items-center gap-3">
            <Button size="lg" className="flex-1" disabled={!canRun} onClick={run}>
              {status === "working" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Cropping…
                </>
              ) : (
                reg.toolAction(tool)
              )}
            </Button>
            {(files.length > 0 || status !== "idle") && (
              <Button variant="ghost" size="lg" onClick={startOver} disabled={status === "working"}>
                <RefreshCw className="size-4" /> Start over
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
