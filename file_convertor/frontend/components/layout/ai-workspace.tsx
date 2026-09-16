"use client"

import * as React from "react"
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { useT, useRegistryText } from "@/lib/i18n"
import {
  exportAiText,
  proofreadDocument,
  summarizeDocument,
  type ProofreadResult,
  type SummarizeResult,
} from "@/lib/api"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "working" | "done" | "error"

function ExportBar({ text, basename }: { text: string; basename: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const [exporting, setExporting] = React.useState<"pdf" | "txt" | null>(null)
  const [exportError, setExportError] = React.useState<string | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setExportError(t("ai.couldNotCopy"))
    }
  }

  const doExport = async (format: "pdf" | "txt") => {
    setExporting(format)
    setExportError(null)
    try {
      await exportAiText(text, format, basename)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : t("common.exportFailed"))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("ai.copied") : t("ai.copy")}
        </Button>
        <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => doExport("pdf")}>
          {exporting === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {t("ai.exportPdf")}
        </Button>
        <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => doExport("txt")}>
          {exporting === "txt" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          {t("ai.exportTxt")}
        </Button>
      </div>
      {exportError && <p className="text-xs text-destructive">{exportError}</p>}
    </div>
  )
}

const FIX_BADGE: Record<string, string> = {
  spelling: "border-rose-300 text-rose-600 dark:text-rose-400",
  grammar: "border-blue-300 text-blue-600 dark:text-blue-400",
  punctuation: "border-amber-300 text-amber-600 dark:text-amber-400",
  clarity: "border-emerald-300 text-emerald-600 dark:text-emerald-400",
}

export function AiWorkspace({ tool }: { tool: Tool }) {
  const t = useT()
  const reg = useRegistryText()
  const isSummarize = tool.slug === "summarize-document"
  const [files, setFiles] = React.useState<File[]>([])
  const [length, setLength] = React.useState("medium")
  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<SummarizeResult | null>(null)
  const [proofread, setProofread] = React.useState<ProofreadResult | null>(null)

  const reset = () => {
    setStatus("idle")
    setError(null)
    setSummary(null)
    setProofread(null)
  }

  const run = async () => {
    if (files.length === 0) return
    setStatus("working")
    setError(null)
    setSummary(null)
    setProofread(null)
    try {
      if (isSummarize) {
        setSummary(await summarizeDocument(files[0], length))
      } else {
        setProofread(await proofreadDocument(files[0]))
      }
      setStatus("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai.requestFailed"))
      setStatus("error")
    }
  }

  const basename = (files[0]?.name ?? "document").replace(/\.[^.]+$/, "")

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
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
              if (status !== "working") reset()
            }}
            disabled={status === "working"}
          />

          {isSummarize && (
            <div className="grid gap-1.5">
              <Label htmlFor="opt-length">{t("ai.summaryLength")}</Label>
              <Select
                id="opt-length"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                disabled={status === "working"}
              >
                <option value="short">{t("ai.lengthShort")}</option>
                <option value="medium">{t("ai.lengthMedium")}</option>
                <option value="detailed">{t("ai.lengthDetailed")}</option>
              </Select>
            </div>
          )}

          {status === "error" && error && (
            <Alert tone="error">{error}</Alert>
          )}

          {status === "working" && (
            <BusyPanel label={isSummarize ? t("ai.summarizing") : t("ai.checking")} />
          )}

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
                  {isSummarize ? t("ai.summarizing") : t("ai.checking")}
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
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="size-5 text-purple-500" /> {t("ai.summary")}
            </CardTitle>
            <CardDescription>
              {summary.filename} · {summary.model}
              {summary.truncated && ` · ${t("ai.truncatedModelLimit")}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">
              {summary.summary}
            </div>
            <ExportBar text={summary.summary} basename={`${basename}_summary`} />
          </CardContent>
        </Card>
      )}

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
                  {proofread.fixes.map((fix, i) => (
                    <li key={i} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1.5 flex items-center gap-2">
                        <Badge className={FIX_BADGE[fix.type] ?? ""}>{t(`ai.fixType.${fix.type}`, undefined, fix.type)}</Badge>
                        <span className="text-xs text-muted-foreground">{fix.explanation}</span>
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
              <div className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">
                {proofread.corrected_text}
              </div>
              <ExportBar text={proofread.corrected_text} basename={`${basename}_corrected`} />
            </CardContent>
          </Card>
        </>
      )}

    </div>
  )
}
