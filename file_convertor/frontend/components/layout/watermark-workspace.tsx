"use client"

import * as React from "react"
import { Loader2, RefreshCw } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ResizeHandle } from "@/components/ui/resize-handle"
import { Label } from "@/components/ui/label"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { downloadBlob, organizePreview, runTool, type OrganizePreview } from "@/lib/api"
import { useRegistryText } from "@/lib/i18n"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "working" | "done" | "error"

// The preview thumbnails come from the same 0.3x render used by Organize PDF
// (`fitz.Matrix(0.3, 0.3)` in organize.py), so dividing the loaded <img>'s
// pixel size by 0.3 recovers the page's real size in PDF points.
const PREVIEW_SCALE = 0.3
const WIDTH_MIN = 20
const WIDTH_MAX = 1000
const WIDTH_DEFAULT = 300

const clampWidth = (n: number) => Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n))

/** Natural pixel width of `text` at a 100px font — used to size the preview
 *  overlay so its width tracks the requested watermark width in points. */
function measureTextWidth(text: string): number {
  if (typeof document === "undefined") return 100
  const canvas = (measureTextWidth as { _c?: HTMLCanvasElement })._c ?? document.createElement("canvas")
  ;(measureTextWidth as { _c?: HTMLCanvasElement })._c = canvas
  const ctx = canvas.getContext("2d")
  if (!ctx) return 100
  ctx.font = "100px sans-serif"
  return Math.max(1, ctx.measureText(text || " ").width)
}

export function WatermarkWorkspace({ tool }: { tool: Tool }) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = React.useState<File[]>([])

  const [preview, setPreview] = React.useState<OrganizePreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [pageSize, setPageSize] = React.useState<{ width: number; height: number } | null>(null)
  const [selectedPage, setSelectedPage] = React.useState(1)

  const [text, setText] = React.useState("CONFIDENTIAL")
  const [color, setColor] = React.useState("#FF0000")
  const [opacity, setOpacity] = React.useState(35)
  const [diagonal, setDiagonal] = React.useState(true)
  const [pos, setPos] = React.useState({ x: 0.5, y: 0.5 })
  const [width, setWidth] = React.useState(String(WIDTH_DEFAULT))

  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)

  const pickerRef = React.useRef<HTMLDivElement>(null)
  const resizeStart = React.useRef<{ clientX: number; width: number; pickerWidthPx: number } | null>(null)

  const pdfFile = files[0] ?? null
  const canRun = !!pdfFile && !!preview && text.trim().length > 0 && status !== "working"

  React.useEffect(() => {
    if (!pdfFile) {
      setPreview(null)
      setPageSize(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    organizePreview(pdfFile)
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        setSelectedPage(p.pages.length > 0 ? p.pages[0].index : 1)
      })
      .catch((e) => {
        if (cancelled) return
        setPreview(null)
        setPreviewError(e instanceof Error ? e.message : t("watermark.previewFailed"))
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

  // Natural width/height (px, at font 100) of the current text, giving the
  // overlay box the right aspect ratio for its requested point width.
  const natWidth = React.useMemo(() => measureTextWidth(text), [text])
  const viewH = 130 // room for ascenders/descenders around the 100px glyphs

  const overlaySize = React.useMemo(() => {
    if (!pageSize) return null
    const widthPt = clampWidth(Number(width) || WIDTH_DEFAULT)
    const heightPt = widthPt * (viewH / natWidth)
    return { widthPct: (widthPt / pageSize.width) * 100, heightPct: (heightPt / pageSize.height) * 100 }
  }, [pageSize, width, natWidth])

  const updatePosFromEvent = (clientX: number, clientY: number) => {
    const el = pickerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    setPos({
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    })
  }

  const onResizeHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pageSize || !pickerRef.current) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeStart.current = {
      clientX: e.clientX,
      width: clampWidth(Number(width) || WIDTH_DEFAULT),
      pickerWidthPx: pickerRef.current.getBoundingClientRect().width,
    }
  }
  const onResizeHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current
    if (!start || !pageSize || start.pickerWidthPx === 0) return
    e.stopPropagation()
    const deltaPt = ((e.clientX - start.clientX) / start.pickerWidthPx) * pageSize.width
    setWidth(String(clampWidth(Math.round(start.width + deltaPt * 2))))
  }
  const onResizeHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    resizeStart.current = null
  }

  const run = async () => {
    if (!pdfFile) return
    setStatus("working")
    setError(null)
    try {
      const result = await runTool(tool.slug, [pdfFile], {
        text: text.trim(),
        color,
        opacity: String(opacity),
        x: pos.x.toFixed(4),
        y: pos.y.toFixed(4),
        width: String(clampWidth(Number(width) || WIDTH_DEFAULT)),
        rotate: diagonal ? "45" : "0",
      })
      downloadBlob(result.blob, result.filename)
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("watermark.failed"))
      setStatus("error")
    }
  }

  const startOver = () => {
    setFiles([])
    setPreview(null)
    setPageSize(null)
    setStatus("idle")
  }

  const cx = natWidth / 2
  const cy = viewH / 2

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
          <CardDescription>{reg.toolDescription(tool)}</CardDescription>
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

          <div className="grid gap-1.5">
            <Label htmlFor="wm-text">{t("watermark.text")}</Label>
            <Input
              id="wm-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("watermark.textPlaceholder")}
              disabled={status === "working"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wm-color">{t("watermark.color")}</Label>
              <input
                id="wm-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={status === "working"}
                className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent p-1"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wm-opacity">Opacity ({opacity}%)</Label>
              <input
                id="wm-opacity"
                type="range"
                min={5}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                disabled={status === "working"}
                className="h-9 w-full cursor-pointer accent-primary"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wm-width">{t("watermark.widthPt")}</Label>
              <Input
                id="wm-width"
                type="number"
                min={WIDTH_MIN}
                max={WIDTH_MAX}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                disabled={status === "working"}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={diagonal ? "default" : "outline"}
              onClick={() => setDiagonal((v) => !v)}
              disabled={status === "working"}
            >
              Diagonal (45°)
            </Button>
            <span className="text-xs text-muted-foreground">
              Drag the watermark on the page to position it; drag the corner handle to resize.
            </span>
          </div>

          {pdfFile && preview && preview.pages.length > 1 && (
            <div className="grid gap-1.5">
              <Label>{t("watermark.previewPage")}</Label>
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
              <Label>Position{preview && preview.pages.length > 1 ? ` (page ${selectedPage})` : ""}</Label>
              {pageSize && (
                <span className="text-xs text-muted-foreground">
                  {Math.round(pageSize.width)} × {Math.round(pageSize.height)} pt
                </span>
              )}
            </div>
            <div
              ref={pickerRef}
              onPointerDown={(e) => {
                if (!pageSize) return
                e.currentTarget.setPointerCapture(e.pointerId)
                updatePosFromEvent(e.clientX, e.clientY)
              }}
              onPointerMove={(e) => {
                if (e.buttons !== 1) return
                updatePosFromEvent(e.clientX, e.clientY)
              }}
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
                  {previewLoading ? t("watermark.rendering") : t("watermark.uploadFirst")}
                </div>
              )}
              {currentPage && overlaySize && (
                <div
                  className="absolute"
                  style={{
                    left: `${pos.x * 100}%`,
                    top: `${pos.y * 100}%`,
                    width: `${overlaySize.widthPct}%`,
                    height: `${overlaySize.heightPct}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <svg
                    viewBox={`0 0 ${natWidth} ${viewH}`}
                    preserveAspectRatio="none"
                    className="h-full w-full"
                    style={{ overflow: "visible", opacity: opacity / 100 }}
                  >
                    <text
                      x={cx}
                      y={cy}
                      fontSize={100}
                      fontFamily="sans-serif"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={color}
                      transform={diagonal ? `rotate(-45 ${cx} ${cy})` : undefined}
                    >
                      {text || " "}
                    </text>
                  </svg>
                  <ResizeHandle
                    label={t("watermark.resize")}
                    value={clampWidth(Number(width) || WIDTH_DEFAULT)}
                    min={WIDTH_MIN}
                    max={WIDTH_MAX}
                    onChange={(next) => setWidth(String(next))}
                    onPointerDown={onResizeHandlePointerDown}
                    onPointerMove={onResizeHandlePointerMove}
                    onPointerUp={onResizeHandlePointerUp}
                    className="-bottom-1.5 -right-1.5"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("watermark.everyPage")}</p>
          </div>

          {status === "error" && error && (
            <Alert tone="error">{error}</Alert>
          )}
          {status === "done" && (
            <Alert tone="success">{t("common.doneDownloadStarted")}</Alert>
          )}
          {status === "working" && (
            <BusyPanel label={t("watermark.working")} />
          )}

          <div className="flex items-center gap-3">
            <Button size="lg" className="flex-1" disabled={!canRun} onClick={run}>
              {status === "working" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Adding watermark…
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
