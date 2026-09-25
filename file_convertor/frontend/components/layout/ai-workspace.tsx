"use client"

import * as React from "react"
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { PanelContent, PanelShell } from "@/components/ui/panel-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DocumentChat } from "@/components/layout/document-chat"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { buildPagesMarkup, fitPagesToWidth, pagesToExportHtml } from "@/components/layout/edit-workspace"
import { useWorkspaceFiles, type WorkspaceFileProps } from "@/hooks/use-workspace-files"
import { cn } from "@/lib/utils"
import { useT, useRegistryText } from "@/lib/i18n"
import {
  exportEditedHtml,
  proofreadDocument,
  type ExtractedPage,
  type ProofreadResult,
} from "@/lib/api"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "working" | "done" | "error"

/**
 * The corrected document drawn exactly as the editor draws it — same pages,
 * same positions, same fonts — read-only. The old preview was the corrected
 * plain text, which is why the layout looked lost.
 */
function CorrectedPreview({ pages }: { pages: ExtractedPage[] }) {
  const t = useT()
  const frameRef = React.useRef<HTMLDivElement>(null)
  const pagesRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const root = pagesRef.current
    const frame = frameRef.current
    if (!root || !frame) return
    root.innerHTML = buildPagesMarkup(pages, t)
    fitPagesToWidth(root, frame)
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => fitPagesToWidth(root, frame))
    ro.observe(frame)
    return () => ro.disconnect()
  }, [pages, t])

  return (
    <div ref={frameRef} className="max-h-[70vh] overflow-y-auto rounded-lg border bg-muted/60 px-3 py-4">
      <div ref={pagesRef} aria-label={t("ai.correctedDoc")} />
    </div>
  )
}

/** Download the corrected pages in the document's own format (and as PDF),
 *  through the same exporter the editor uses — so a .docx comes back a .docx
 *  with its layout, not a text dump. */
function CorrectedDownload({ pages, text, filename }: { pages: ExtractedPage[]; text: string; filename: string }) {
  const t = useT()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const ext = (filename.split(".").pop() ?? "pdf").toLowerCase()
  const original = ext === "hwp" ? "hwpx" : ext
  const formats = original === "pdf" ? ["pdf"] : [original, "pdf"]
  const basename = filename.replace(/\.[^.]+$/, "")

  const download = async (format: string) => {
    setBusy(format)
    setError(null)
    try {
      await exportEditedHtml(pagesToExportHtml(pages), format, `${basename}_corrected`)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.exportFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {formats.map((format, i) => (
          <Button
            key={format}
            size="sm"
            variant={i === 0 ? "default" : "outline"}
            disabled={busy !== null}
            onClick={() => void download(format)}
          >
            {busy === format ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t("ai.downloadAs", { format: format.toUpperCase() })}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("ai.copied") : t("ai.copy")}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  )
}

const FIX_BADGE: Record<string, string> = {
  spelling: "border-rose-300 text-rose-600 dark:text-rose-400",
  grammar: "border-blue-300 text-blue-600 dark:text-blue-400",
  punctuation: "border-amber-300 text-amber-600 dark:text-amber-400",
  clarity: "border-emerald-300 text-emerald-600 dark:text-emerald-400",
}

export function AiWorkspace({
  tool,
  files: filesProp,
  onFilesChange,
  embedded,
}: { tool: Tool } & WorkspaceFileProps) {
  const t = useT()
  const reg = useRegistryText()
  const isSummarize = tool.slug === "summarize-document"
  const [files, setFiles] = useWorkspaceFiles(filesProp, onFilesChange)
  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [proofread, setProofread] = React.useState<ProofreadResult | null>(null)

  const reset = () => {
    setStatus("idle")
    setError(null)
    setProofread(null)
  }

  // The file can also change from the section workspace's upload bar, which
  // never runs the dropzone handler — so the same reset hangs off the file.
  const stagedFile = files[0]
  React.useEffect(() => {
    if (status !== "working") reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedFile])

  const run = async () => {
    if (files.length === 0) return
    setStatus("working")
    setError(null)
    setProofread(null)
    try {
      setProofread(await proofreadDocument(files[0]))
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai.requestFailed"))
      setStatus("error")
    }
  }


  return (
    // The summarizer's chat spans the same width as the upload above it; the
    // proofreader keeps the reading measure for its fix list.
    <div className={cn("w-full min-w-0 space-y-6", !isSummarize && "max-w-3xl", !embedded && "mx-auto")}>
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
                if (status !== "working") reset()
              }}
              disabled={status === "working"}
            />
          )}

          {/* The summarizer is a chat about the file: its summary lengths
              are suggestion chips there, and any question can be asked. */}
          {isSummarize && files[0] && <DocumentChat tool={tool} file={files[0]} />}

          {status === "error" && error && (
            <Alert tone="error">{error}</Alert>
          )}

          {status === "working" && (
            <BusyPanel label={t("ai.checking")} />
          )}

          {!isSummarize && (
          <div className="flex items-center gap-3">
            <Button
              size="lg"
              className="flex-1"
              disabled={files.length === 0 || status === "working"}
              onClick={run}
            >
              {status === "working" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("ai.checking")}
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> {reg.toolAction(tool)}
                </>
              )}
            </Button>
            {(files.length > 0 || status !== "idle") && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setFiles([])
                  reset()
                }}
                disabled={status === "working"}
              >
                <RefreshCw className="size-4" /> {t("common.startOver")}
              </Button>
            )}
          </div>
          )}
        </PanelContent>
      </PanelShell>

      {proofread && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="size-5 text-emerald-500" />
                {proofread.fix_count === 0
                  ? t("ai.noMistakes")
                  : t("ai.fixesApplied", { count: proofread.fix_count })}
              </CardTitle>
              <CardDescription>
                {proofread.filename} · {proofread.model}
              </CardDescription>
            </CardHeader>
            {proofread.fix_count > 0 && (
              <CardContent>
                <ul className="space-y-3">
                  {proofread.fixes.filter((fix) => fix.applied !== false).map((fix, i) => (
                    <li key={i} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1.5 flex items-center gap-2">
                        <Badge className={FIX_BADGE[fix.type] ?? ""}>{t(`ai.fixType.${fix.type}`, undefined, fix.type)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {fix.page ? `${t("ai.onPage", { n: fix.page })} · ` : ""}
                          {fix.explanation}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through dark:bg-rose-950 dark:text-rose-300">
                          {fix.before}
                        </span>
                        <span aria-hidden>→</span>
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          {fix.after}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("ai.correctedDoc")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CorrectedPreview pages={proofread.pages} />
              <CorrectedDownload
                pages={proofread.pages}
                text={proofread.corrected_text}
                filename={proofread.filename}
              />
            </CardContent>
          </Card>
        </>
      )}

    </div>
  )
}
