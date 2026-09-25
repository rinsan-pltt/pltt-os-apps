"use client"

/**
 * Rotate PDF, with the page in front of you while you choose the angle.
 *
 * It used to be a select and a button: you picked "90° clockwise" from a
 * dropdown, pressed Rotate, and the first sight of the result was whatever
 * landed in your downloads folder. Every other tool in this app that changes
 * how a page LOOKS — crop, watermark, sign — shows the page while you set it
 * up, and rotation is the most visual of the three.
 *
 * The preview is the real first page, fetched from the same `/organize/preview`
 * endpoint those three use, turned with a CSS transform so the angle is
 * legible before anything is sent anywhere.
 */

import * as React from "react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { PanelContent, PanelShell } from "@/components/ui/panel-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RunBar } from "@/components/ui/run-bar"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { useWorkspaceFiles, type WorkspaceFileProps } from "@/hooks/use-workspace-files"
import { downloadBlob, organizePreview, runTool, type OrganizePreview } from "@/lib/api"
import { useT, useRegistryText } from "@/lib/i18n"
import type { Tool, ToolOption } from "@/lib/tools"
import { cn } from "@/lib/utils"

type Status = "idle" | "working" | "done" | "error"

/** The angle choices come from the registry, not from here: the backend
 *  validates against that same list, and the labels are translated by slug. */
function angleOption(tool: Tool): Extract<ToolOption, { kind: "select" }> | null {
  const opt = (tool.options ?? []).find((o) => o.name === "angle")
  return opt && opt.kind === "select" ? opt : null
}

export function RotateWorkspace({
  tool,
  files: filesProp,
  onFilesChange,
  embedded,
}: { tool: Tool } & WorkspaceFileProps) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = useWorkspaceFiles(filesProp, onFilesChange)

  const option = angleOption(tool)
  const [angle, setAngle] = React.useState(option?.default ?? "90")

  const [preview, setPreview] = React.useState<OrganizePreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [selectedPage, setSelectedPage] = React.useState(1)

  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)

  const pdfFile = files[0] ?? null

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
        setPreviewError(e instanceof Error ? e.message : t("rotate.previewFailed"))
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

  const run = async () => {
    if (!pdfFile) return
    setStatus("working")
    setError(null)
    try {
      const result = await runTool(tool.slug, [pdfFile], { angle })
      downloadBlob(result.blob, result.filename)
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rotate.failed"))
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
          {previewLoading && <BusyPanel label={t("rotate.loadingPreview")} />}

          {pdfFile && page && (
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="rotate-angle">{option ? reg.optLabel(tool.slug, option) : t("rotate.angle")}</Label>
                {/* A segmented control rather than a dropdown: three choices
                    that each change the picture below are worth showing at
                    once, and a select hides two of them behind a click. */}
                <div id="rotate-angle" role="radiogroup" className="flex flex-wrap gap-2">
                  {(option?.choices ?? []).map((choice) => {
                    const on = choice.value === angle
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setAngle(choice.value)}
                        disabled={status === "working"}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-ui transition-colors duration-[var(--dt-dur-fast)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on
                            ? "border-primary/50 bg-primary/10 font-medium text-primary"
                            : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                          status === "working" && "pointer-events-none opacity-60",
                        )}
                      >
                        {reg.optChoice(tool.slug, "angle", choice.value, choice.label)}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* A SQUARE frame, deliberately: the bounding box of a page
                  turned by a multiple of 90° is the same box with its sides
                  swapped, so anything that fits this frame upright still fits
                  it turned. No measuring, and nothing clips mid-transition. */}
              <div className="flex h-80 w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/20 p-4">
                {/* The SQUARE is the inner box, not the frame: a full-width
                    square frame was 960px tall on a desktop and pushed the
                    page picker and the run button off the screen. */}
                <div className="flex aspect-square h-full items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.thumbnail}
                    alt={t("rotate.previewAlt", { page: page.index, angle })}
                    className="max-h-full max-w-full rounded-sm shadow-[var(--dt-shadow-md)] transition-transform ease-[var(--dt-ease-out)] duration-[var(--dt-dur-slow)]"
                    style={{ transform: `rotate(${Number(angle) || 0}deg)` }}
                  />
                </div>
              </div>

              {preview && preview.pages.length > 1 && (
                <div className="grid gap-1.5">
                  <Label>{t("rotate.previewPage", { total: preview.pages.length })}</Label>
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
                  {/* The rotation applies to the whole document; the picker
                      only chooses which page you are looking at. */}
                  <p className="text-caption text-muted-foreground">{t("rotate.appliesToAll")}</p>
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
                    setAngle(option?.default ?? "90")
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
