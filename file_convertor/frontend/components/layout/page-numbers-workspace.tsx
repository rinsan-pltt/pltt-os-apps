"use client"

/**
 * Page numbers, placed on the page in front of you.
 *
 * It used to be a dropdown with six position names and nothing to look at, so
 * "bottom-left" was a guess you confirmed by downloading the result. The page
 * is now shown with the number where it will actually print, and the number
 * can be dragged there directly.
 *
 * Drag and dropdown are the SAME value, not two views of it: the drag snaps to
 * the nearest of the six positions the backend accepts, writes that one piece
 * of state, and the dropdown renders from it. Moving either moves both,
 * because underneath there is only one.
 */

import * as React from "react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PanelContent, PanelShell } from "@/components/ui/panel-shell"
import { RunBar } from "@/components/ui/run-bar"
import { Select } from "@/components/ui/select"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { useWorkspaceFiles, type WorkspaceFileProps } from "@/hooks/use-workspace-files"
import { downloadBlob, organizePreview, runTool, type OrganizePreview } from "@/lib/api"
import { useT, useRegistryText } from "@/lib/i18n"
import type { Tool, ToolOption } from "@/lib/tools"
import { cn } from "@/lib/utils"

type Status = "idle" | "working" | "done" | "error"

/** The inset the backend places the number at (20pt on a 612×792 page), as a
 *  fraction of the page — so the chip in the preview sits where the number
 *  will actually print rather than merely in the right corner. */
const INSET_X = 20 / 612
const INSET_Y = 20 / 792

/** How tall the preview page is drawn. */
const PREVIEW_HEIGHT = 320

function positionOption(tool: Tool): Extract<ToolOption, { kind: "select" }> | null {
  const opt = (tool.options ?? []).find((o) => o.name === "position")
  return opt && opt.kind === "select" ? opt : null
}

/** The position keyword nearest a point on the page.
 *
 *  Thirds horizontally (left / center / right) and halves vertically, which is
 *  the grid the six choices actually form — there is no middle row to snap to. */
function nearestPosition(xFrac: number, yFrac: number): string {
  const horizontal = xFrac < 1 / 3 ? "left" : xFrac < 2 / 3 ? "center" : "right"
  const vertical = yFrac < 0.5 ? "top" : "bottom"
  return `${vertical}-${horizontal}`
}

/** Where a keyword sits, as CSS percentages, mirroring `_anchor_point`. */
function chipStyle(position: string): React.CSSProperties {
  const [vertical, horizontal] = position.split("-")
  const style: React.CSSProperties = {}
  if (vertical === "top") style.top = `${INSET_Y * 100}%`
  else style.bottom = `${INSET_Y * 100}%`
  if (horizontal === "left") style.left = `${INSET_X * 100}%`
  else if (horizontal === "right") style.right = `${INSET_X * 100}%`
  else {
    style.left = "50%"
    style.transform = "translateX(-50%)"
  }
  return style
}

export function PageNumbersWorkspace({
  tool,
  files: filesProp,
  onFilesChange,
  embedded,
}: { tool: Tool } & WorkspaceFileProps) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = useWorkspaceFiles(filesProp, onFilesChange)

  const option = positionOption(tool)
  const [position, setPosition] = React.useState(option?.default ?? "bottom-center")
  const [start, setStart] = React.useState("1")

  const [preview, setPreview] = React.useState<OrganizePreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [selectedPage, setSelectedPage] = React.useState(1)

  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)

  const pdfFile = files[0] ?? null
  const pageRef = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState(false)
  // The page image's natural size, so the preview box can be given an explicit
  // width. `aspect-ratio` is not enough: in a shrink-to-fit box (inline-block)
  // `width: auto` resolves from content before the ratio is applied, so the
  // wrapper stayed 20px wide with the image overflowing it — and the chip's
  // percentage offsets were measured against that.
  const [naturalSize, setNaturalSize] = React.useState({ w: 210, h: 297 })

  React.useEffect(() => {
    if (!pdfFile) {
      setPreview(null)
      setStatus("idle")
      return
    }
    let cancelled = false
    setStatus("idle")
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
        setPreviewError(e instanceof Error ? e.message : t("pageNumbers.previewFailed"))
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfFile])

  const page = preview?.pages.find((p) => p.index === selectedPage) ?? preview?.pages[0] ?? null

  const previewWidth = Math.round((PREVIEW_HEIGHT * naturalSize.w) / naturalSize.h)

  /** The number this page will carry, so the chip shows the real label. */
  const startNumber = Number.parseInt(start, 10)
  const label = String(
    (Number.isFinite(startNumber) ? startNumber : 1) + ((page?.index ?? 1) - 1),
  )

  const moveFromPointer = (clientX: number, clientY: number) => {
    const el = pageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const xFrac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const yFrac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    setPosition(nearestPosition(xFrac, yFrac))
  }

  const run = async () => {
    if (!pdfFile) return
    setStatus("working")
    setError(null)
    try {
      const result = await runTool(tool.slug, [pdfFile], { position, start: start.trim() || "1" })
      downloadBlob(result.blob, result.filename)
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pageNumbers.failed"))
      setStatus("error")
    }
  }

  return (
    <div className={cn("w-full min-w-0 max-w-2xl space-y-6", !embedded && "mx-auto")}>
      <PanelShell embedded={embedded}>
        {!embedded && (
          <CardHeader>
            <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
            <CardDescription>{reg.toolDescription(tool)}</CardDescription>
          </CardHeader>
        )}
        <PanelContent embedded={embedded} className="space-y-6">
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

          {previewError && <Alert tone="error">{previewError}</Alert>}
          {previewLoading && <BusyPanel label={t("pageNumbers.loadingPreview")} />}

          {pdfFile && page && (
            <div className="space-y-4">
              {/* The page, with the number where it will print. Click or drag
                  anywhere on it to move the number to the nearest position. */}
              {/* The wrapper carries the page's aspect ratio and a definite
                  height, so it is exactly the size of the page image.
                  Shrink-to-fit could not do it: a replaced element sized by
                  height alone does not feed its ratio-derived width back into
                  the parent's shrink-to-fit, so the wrapper stayed 20px wide
                  while the image overflowed it at 247 — and the chip's
                  percentage offsets were measured against that 20px box. */}
              <div className="text-center">
                <div
                  ref={pageRef}
                  style={{ width: previewWidth, height: PREVIEW_HEIGHT }}
                  role="application"
                  aria-label={t("pageNumbers.dragHint")}
                  onPointerDown={(e) => {
                    if (status === "working") return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setDragging(true)
                    moveFromPointer(e.clientX, e.clientY)
                  }}
                  onPointerMove={(e) => {
                    if (e.buttons !== 1 || status === "working") return
                    moveFromPointer(e.clientX, e.clientY)
                  }}
                  onPointerUp={() => setDragging(false)}
                  onPointerCancel={() => setDragging(false)}
                  className={cn(
                    "relative inline-block touch-none select-none rounded-sm",
                    "shadow-[var(--dt-shadow-md)]",
                    status === "working" ? "cursor-default" : dragging ? "cursor-grabbing" : "cursor-grab",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.thumbnail}
                    alt={t("pageNumbers.previewAlt", { page: page.index })}
                    draggable={false}
                    onLoad={(e) => {
                      const el = e.currentTarget
                      if (el.naturalWidth && el.naturalHeight) {
                        setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight })
                      }
                    }}
                    className="block h-full w-full rounded-sm"
                  />
                  <span
                    aria-hidden
                    style={chipStyle(position)}
                    className={cn(
                      "absolute rounded px-1.5 py-0.5 text-micro font-medium tabular-nums",
                      "bg-primary text-primary-foreground shadow-[var(--dt-shadow-sm)]",
                      "transition-[top,bottom,left,right] duration-[var(--dt-dur-fast)] ease-[var(--dt-ease-out)]",
                    )}
                  >
                    {label}
                  </span>
                </div>
              </div>
              <p className="text-center text-caption text-muted-foreground">
                {t("pageNumbers.dragHint")}
              </p>

              <div className="grid gap-block sm:grid-cols-2">
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="pn-position">
                    {option ? reg.optLabel(tool.slug, option) : t("pageNumbers.position")}
                  </Label>
                  {/* The same state the drag writes — picking here moves the
                      chip, dragging the chip changes this. */}
                  <Select
                    id="pn-position"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    disabled={status === "working"}
                  >
                    {(option?.choices ?? []).map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {reg.optChoice(tool.slug, "position", choice.value, choice.label)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="pn-start">{t("pageNumbers.startAt")}</Label>
                  <Input
                    id="pn-start"
                    inputMode="numeric"
                    value={start}
                    placeholder="1"
                    onChange={(e) => setStart(e.target.value.replace(/[^\d]/g, ""))}
                    disabled={status === "working"}
                  />
                </div>
              </div>

              {preview && preview.pages.length > 1 && (
                <div className="grid gap-1.5">
                  <Label>{t("pageNumbers.previewPage", { total: preview.pages.length })}</Label>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {preview.pages.map((p) => (
                      <button
                        key={p.index}
                        type="button"
                        onClick={() => setSelectedPage(p.index)}
                        disabled={status === "working"}
                        aria-current={selectedPage === p.index ? "true" : undefined}
                        className={cn(
                          "shrink-0 rounded-lg border-2 p-1 transition-colors duration-[var(--dt-dur-fast)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedPage === p.index ? "border-primary" : "border-transparent hover:border-border",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumbnail} alt="" className="h-16 w-auto rounded-sm" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {status === "error" && error && <Alert tone="error">{error}</Alert>}
          {status === "done" && <Alert tone="success">{t("common.doneDownloadStarted")}</Alert>}

          <RunBar
            label={reg.toolAction(tool)}
            busyLabel={t("common.converting")}
            busy={status === "working"}
            disabled={!pdfFile || status === "working"}
            blockedReason={!pdfFile ? t("tool.needFile") : null}
            onRun={run}
            onReset={
              pdfFile || status !== "idle"
                ? () => {
                    setFiles([])
                    setPreview(null)
                    setPosition(option?.default ?? "bottom-center")
                    setStart("1")
                    setStatus("idle")
                    setError(null)
                  }
                : undefined
            }
          />
        </PanelContent>
      </PanelShell>
    </div>
  )
}
