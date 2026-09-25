"use client"

import * as React from "react"
import { Eraser, ImageUp, Loader2, PenTool, RefreshCw } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { PanelContent, PanelShell } from "@/components/ui/panel-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ResizeHandle } from "@/components/ui/resize-handle"
import { Label } from "@/components/ui/label"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { downloadBlob, organizePreview, runTool, type OrganizePreview } from "@/lib/api"
import { useWorkspaceFiles, type WorkspaceFileProps } from "@/hooks/use-workspace-files"
import { useT, useRegistryText } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "working" | "done" | "error"
type SignatureMode = "draw" | "upload"

// The preview thumbnails come from the same 0.3x render used by Organize PDF
// (`fitz.Matrix(0.3, 0.3)` in organize.py), so dividing the loaded <img>'s
// pixel size by 0.3 recovers the page's real size in PDF points.
const PREVIEW_SCALE = 0.3

export interface SignaturePadHandle {
  toBlob: () => Promise<Blob | null>
  clear: () => void
}

const SignaturePad = React.forwardRef<
  SignaturePadHandle,
  { onChange: (hasStrokes: boolean) => void; onAspectChange: (aspect: number) => void }
>(function SignaturePad({ onChange, onAspectChange }, ref) {
  const t = useT()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const drawing = React.useRef(false)
  const hasStrokes = React.useRef(false)

  const getCtx = () => canvasRef.current?.getContext("2d") ?? null

  const clear = React.useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStrokes.current = false
    onChange(false)
  }, [onChange])

  React.useImperativeHandle(ref, () => ({
    toBlob: () =>
      new Promise((resolve) => {
        const canvas = canvasRef.current
        if (!canvas) return resolve(null)
        canvas.toBlob(resolve, "image/png")
      }),
    clear,
  }))

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * ratio
    canvas.height = canvas.clientHeight * ratio
    const ctx = getCtx()
    if (ctx) {
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2.5
      ctx.lineCap = "round"
      ctx.strokeStyle = "#111827"
    }
    if (canvas.clientWidth > 0) onAspectChange(canvas.clientHeight / canvas.clientWidth)
  }, [onAspectChange])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const { x, y } = point(e)
    const ctx = getCtx()
    ctx?.beginPath()
    ctx?.moveTo(x, y)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const { x, y } = point(e)
    const ctx = getCtx()
    ctx?.lineTo(x, y)
    ctx?.stroke()
    if (!hasStrokes.current) {
      hasStrokes.current = true
      onChange(true)
    }
  }
  const end = () => {
    drawing.current = false
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full cursor-crosshair touch-none rounded-lg border-2 border-dashed bg-white"
        aria-label={t("sign.drawSignature")}
      />
      <Button type="button" variant="outline" size="sm" onClick={clear}>
        <Eraser className="size-4" /> {t("sign.clear")}
      </Button>
    </div>
  )
})

export function SignWorkspace({
  tool,
  files: filesProp,
  onFilesChange,
  embedded,
}: { tool: Tool } & WorkspaceFileProps) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = useWorkspaceFiles(filesProp, onFilesChange)
  const [mode, setMode] = React.useState<SignatureMode>("draw")
  const [hasSignature, setHasSignature] = React.useState(false)
  const [sigAspect, setSigAspect] = React.useState(0.35) // height / width
  const [signatureImage, setSignatureImage] = React.useState<File[]>([])
  const [uploadPreviewUrl, setUploadPreviewUrl] = React.useState<string | null>(null)

  const [preview, setPreview] = React.useState<OrganizePreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [pageSize, setPageSize] = React.useState<{ width: number; height: number } | null>(null)
  const [selectedPage, setSelectedPage] = React.useState(1)
  const [pos, setPos] = React.useState({ x: 0.78, y: 0.87 })
  const [width, setWidth] = React.useState("160")

  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)

  const sigPadRef = React.useRef<SignaturePadHandle>(null)
  const pickerRef = React.useRef<HTMLDivElement>(null)
  const resizeStart = React.useRef<{ clientX: number; width: number; pickerWidthPx: number } | null>(null)

  const pdfFile = files[0] ?? null
  const hasPlaceableSignature = mode === "draw" ? hasSignature : signatureImage.length > 0
  const canRun = !!pdfFile && !!preview && hasPlaceableSignature && status !== "working"

  React.useEffect(() => {
    if (!pdfFile) {
      setPreview(null)
      setPageSize(null)
      return
    }
    // A file can now arrive from the section workspace's upload bar instead of
    // this screen's dropzone, so the reset that used to sit in the dropzone
    // handler has to hang off the file itself — otherwise swapping the
    // document up there leaves the previous run's alert on screen.
    setStatus("idle")
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    organizePreview(pdfFile)
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        setSelectedPage(p.pages.length > 0 ? p.pages[p.pages.length - 1].index : 1)
      })
      .catch((e) => {
        if (cancelled) return
        setPreview(null)
        setPreviewError(e instanceof Error ? e.message : t("sign.couldNotPreview"))
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pdfFile])

  React.useEffect(() => {
    const file = signatureImage[0]
    if (!file) {
      setUploadPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setUploadPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [signatureImage])

  const currentPage = preview?.pages.find((p) => p.index === selectedPage) ?? null

  const onPreviewImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setPageSize({ width: img.naturalWidth / PREVIEW_SCALE, height: img.naturalHeight / PREVIEW_SCALE })
    }
  }

  const overlaySize = React.useMemo(() => {
    if (!pageSize) return null
    const widthPt = Math.min(400, Math.max(40, Number(width) || 160))
    const heightPt = widthPt * sigAspect
    return { widthPct: (widthPt / pageSize.width) * 100, heightPct: (heightPt / pageSize.height) * 100 }
  }, [pageSize, width, sigAspect])

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
      width: Math.min(400, Math.max(40, Number(width) || 160)),
      pickerWidthPx: pickerRef.current.getBoundingClientRect().width,
    }
  }
  const onResizeHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current
    if (!start || !pageSize || start.pickerWidthPx === 0) return
    e.stopPropagation()
    const deltaPt = ((e.clientX - start.clientX) / start.pickerWidthPx) * pageSize.width
    const nextWidth = Math.min(400, Math.max(40, Math.round(start.width + deltaPt)))
    setWidth(String(nextWidth))
  }
  const onResizeHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    resizeStart.current = null
  }

  const run = async () => {
    if (!pdfFile || !preview) return
    setStatus("working")
    setError(null)
    try {
      let signatureFile: File
      if (mode === "draw") {
        const blob = await sigPadRef.current?.toBlob()
        if (!blob) throw new Error(t("sign.captureFailed"))
        signatureFile = new File([blob], "signature.png", { type: "image/png" })
      } else {
        if (!signatureImage[0]) throw new Error(t("sign.uploadFirst"))
        signatureFile = signatureImage[0]
      }
      const result = await runTool(tool.slug, [pdfFile, signatureFile], {
        page: String(selectedPage),
        width,
        x: pos.x.toFixed(4),
        y: pos.y.toFixed(4),
      })
      downloadBlob(result.blob, result.filename)
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sign.signingFailed"))
      setStatus("error")
    }
  }

  const startOver = () => {
    setFiles([])
    setPreview(null)
    setPageSize(null)
    setStatus("idle")
  }

  return (
    <div className={cn("w-full min-w-0 max-w-2xl space-y-6", !embedded && "mx-auto")}>
      <PanelShell embedded={embedded}>
        {/* Embedded, the section workspace states the tool's name and what it
            does above the panel — this header would be the second copy. */}
        {!embedded && (
          <CardHeader>
            <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
            <CardDescription>{reg.toolDescription(tool)}</CardDescription>
          </CardHeader>
        )}
        <PanelContent embedded={embedded} className="space-y-6">
          {/* The section workspace draws the upload for the whole category;
              see the note in use-workspace-files.ts. */}
          {!embedded && (
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
          )}

          {previewError && (
            <Alert tone="error">{previewError}</Alert>
          )}

          {pdfFile && preview && preview.pages.length > 0 && (
            <div className="grid gap-1.5">
              <Label>{t("sign.pageTotal", { total: preview.pages.length })}</Label>
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
            <Label>{t("sign.signature")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "draw" ? "default" : "outline"}
                onClick={() => setMode("draw")}
                disabled={status === "working"}
              >
                <PenTool className="size-4" /> {t("sign.draw")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "upload" ? "default" : "outline"}
                onClick={() => setMode("upload")}
                disabled={status === "working"}
              >
                <ImageUp className="size-4" /> {t("sign.uploadImage")}
              </Button>
            </div>
            {mode === "draw" ? (
              <SignaturePad ref={sigPadRef} onChange={setHasSignature} onAspectChange={setSigAspect} />
            ) : (
              <FileDropzone
                accept=".png,.jpg,.jpeg,.webp"
                multiple={false}
                files={signatureImage}
                onFilesChange={setSignatureImage}
                disabled={status === "working"}
              />
            )}
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>{t("sign.positionOnPage", { n: selectedPage })}</Label>
              {pageSize && (
                <span className="text-xs text-muted-foreground">
                  {t("sign.pageSize", { w: Math.round(pageSize.width), h: Math.round(pageSize.height) })}
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
                  {previewLoading ? t("sign.loadingPages") : t("sign.uploadToPreview")}
                </div>
              )}
              {currentPage && hasPlaceableSignature && overlaySize && (
                <div
                  className="absolute flex items-center justify-center rounded border-2 border-primary bg-primary/10"
                  style={{
                    left: `${pos.x * 100}%`,
                    top: `${pos.y * 100}%`,
                    width: `${overlaySize.widthPct}%`,
                    height: `${overlaySize.heightPct}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {mode === "upload" && uploadPreviewUrl ? (
                    <img src={uploadPreviewUrl} alt={t("sign.signaturePreview")} className="h-full w-full object-contain" />
                  ) : (
                    <PenTool className="size-4 text-primary" />
                  )}
                  <ResizeHandle
                    label={t("sign.resizeSignature")}
                    value={Number(width) || 160}
                    min={40}
                    max={400}
                    onChange={(next) => setWidth(String(next))}
                    onPointerDown={onResizeHandlePointerDown}
                    onPointerMove={onResizeHandlePointerMove}
                    onPointerUp={onResizeHandlePointerUp}
                    className="-bottom-1.5 -right-1.5"
                  />
                </div>
              )}
            </div>
            {currentPage && (
              <p className="text-xs text-muted-foreground">
                {t("sign.placeHint")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-1">
              <Label htmlFor="sign-width">{t("sign.widthPt")}</Label>
              <Input
                id="sign-width"
                type="number"
                min={40}
                max={400}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                disabled={status === "working"}
              />
            </div>
          </div>

          {status === "error" && error && (
            <Alert tone="error">{error}</Alert>
          )}
          {status === "done" && (
            <Alert tone="success">{t("common.doneDownloadStarted")}</Alert>
          )}

          {status === "working" && (
            <BusyPanel label={t("common.signing")} />
          )}

          <div className="flex items-center gap-3">
            <Button size="lg" className="flex-1" disabled={!canRun} onClick={run}>
              {status === "working" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t("common.signing")}
                </>
              ) : (
                reg.toolAction(tool)
              )}
            </Button>
            {(files.length > 0 || status !== "idle") && (
              <Button variant="ghost" size="lg" onClick={startOver} disabled={status === "working"}>
                <RefreshCw className="size-4" /> {t("common.startOver")}
              </Button>
            )}
          </div>
        </PanelContent>
      </PanelShell>
    </div>
  )
}
