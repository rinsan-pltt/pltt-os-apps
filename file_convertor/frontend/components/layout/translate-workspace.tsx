"use client"

import * as React from "react"
import { Download, FileCode, FileText, Languages, Loader2, RefreshCw } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { exportEditedHtml, translateDocument } from "@/lib/api"
import { useWorkspaceFiles, type WorkspaceFileProps } from "@/hooks/use-workspace-files"
import { useT, useRegistryText } from "@/lib/i18n"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "translating" | "ready" | "error"

const EXPORT_FORMATS = [
  { format: "pdf" as const, label: "edit.downloadPdf", icon: Download },
  { format: "docx" as const, label: "edit.downloadWord", icon: Download },
  { format: "txt" as const, label: "edit.downloadTxt", icon: FileText },
  { format: "html" as const, label: "edit.downloadHtml", icon: FileCode },
]

const LANGUAGES = [
  "Korean", "English",
  "Spanish", "French", "German", "Portuguese", "Italian", "Dutch",
  "Hindi", "Arabic", "Chinese (Simplified)", "Japanese", "Russian",
]

export function TranslateWorkspace({
  tool,
  files: filesProp,
  // Aliased: this screen already has a local `onFilesChange` handler, and the
  // prop is what that handler ultimately writes through.
  onFilesChange: onFilesChangeProp,
  embedded,
}: { tool: Tool } & WorkspaceFileProps) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = useWorkspaceFiles(filesProp, onFilesChangeProp)
  const [language, setLanguage] = React.useState("Korean")
  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [exporting, setExporting] = React.useState<string | null>(null)
  const editorRef = React.useRef<HTMLDivElement>(null)
  const pendingHtml = React.useRef<string>("")

  const basename = (files[0]?.name ?? "document").replace(/\.[^.]+$/, "")

  React.useEffect(() => {
    if (status === "ready" && editorRef.current && pendingHtml.current) {
      editorRef.current.innerHTML = pendingHtml.current
      pendingHtml.current = ""
    }
  }, [status])

  // The file can also change from the section workspace's upload bar, which
  // never touches the handler below — so the same reset hangs off the file.
  const stagedFile = files[0]
  React.useEffect(() => {
    setError(null)
    setDirty(false)
    setStatus("idle")
  }, [stagedFile])

  // Uploading a file no longer translates instantly — it just stages the file.
  // Translation starts only when the user clicks the Translate button.
  const onFilesChange = (next: File[]) => {
    setFiles(next)
    setError(null)
    setDirty(false)
    setStatus("idle")
  }

  const startTranslate = async () => {
    if (files.length === 0 || status === "translating") return
    setError(null)
    setStatus("translating")
    try {
      const result = await translateDocument(files[0], language)
      pendingHtml.current = result.html
      setStatus("ready")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("translate.couldNotTranslate"))
      setStatus("error")
    }
  }

  const doExport = async (format: "pdf" | "docx" | "html" | "txt") => {
    const html = editorRef.current?.innerHTML ?? ""
    if (!html.trim()) return
    setExporting(format)
    setError(null)
    try {
      await exportEditedHtml(html, format, `${basename}_${language.toLowerCase().replace(/\s+/g, "_")}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.exportFailed"))
    } finally {
      setExporting(null)
    }
  }

  if (status !== "ready") {
    return (
      <div className="w-full max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
            <CardDescription>{reg.toolDescription(tool)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-1.5">
              <Label htmlFor="target-language">{t("translate.translateTo")}</Label>
              <Select
                id="target-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={status === "translating"}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>{reg.language(l)}</option>
                ))}
              </Select>
            </div>
            {/* The section workspace draws the upload for the whole category;
                see the note in use-workspace-files.ts. */}
            {!embedded && (
              <FileDropzone
                accept={tool.accept}
                multiple={false}
                files={files}
                onFilesChange={onFilesChange}
                disabled={status === "translating"}
              />
            )}
            <Button
              size="lg"
              className="w-full"
              disabled={files.length === 0 || status === "translating"}
              onClick={startTranslate}
            >
              {status === "translating" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t("translate.translatingTo", { language: reg.language(language) })}
                </>
              ) : (
                <>
                  <Languages className="size-4" /> {reg.toolAction(tool)}
                </>
              )}
            </Button>
            {status === "translating" && (
              <BusyPanel
                label={t("translate.translatingTo", { language: reg.language(language) })}
              />
            )}
            {error && (
              <Alert tone="error">{error}</Alert>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-0">
      <div className="sticky top-14 z-30 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <Languages className="size-4 shrink-0 text-cyan-500" />
            <span className="truncate">{files[0]?.name}</span>
            <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-xs text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
              → {reg.language(language)}
            </span>
            {dirty && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {t("common.edited")}
              </span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {EXPORT_FORMATS.map(({ format, label, icon: Icon }) => (
              <Button
                key={format}
                size="sm"
                variant={format === "pdf" ? "default" : "outline"}
                disabled={exporting !== null}
                onClick={() => doExport(format)}
              >
                {exporting === format ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                {t(label)}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={exporting !== null} onClick={() => onFilesChange([])}>
              <RefreshCw className="size-4" /> {t("common.close")}
            </Button>
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>

      <div className="-mx-4 min-h-[80vh] bg-muted/60 px-4 py-8">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          role="textbox"
          aria-multiline="true"
          aria-label="Translated document editor"
          onInput={() => setDirty(true)}
          className="doc-sheet mx-auto min-h-[75vh] w-full max-w-[900px] rounded-sm border bg-white p-10 text-[15px] leading-relaxed text-neutral-900 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-14"
        />
      </div>

      <p className="py-4 text-center text-xs text-muted-foreground">
        {t("translate.note")}
      </p>
    </div>
  )
}
