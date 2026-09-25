"use client"

import * as React from "react"
import { Download, FolderOpen } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { PanelContent, PanelShell } from "@/components/ui/panel-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { RunBar } from "@/components/ui/run-bar"
import { Select } from "@/components/ui/select"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { DataRoomPicker } from "@/components/layout/data-room-picker"
import { type DataRoomFile } from "@/lib/api"
import { Sheet } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useToolRunner } from "@/hooks/use-tool-runner"
import { useWorkspaceFiles, type WorkspaceFileProps } from "@/hooks/use-workspace-files"
import { useT, useRegistryText } from "@/lib/i18n"
import { passwordLengthProblem, type Tool, type ToolOption } from "@/lib/tools"

/** File extensions that refer to the same underlying format for conversion purposes. */
function normalizeExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "")
  return e === "jpeg" ? "jpg" : e
}

function fileExt(file: File): string {
  return normalizeExt(file.name.split(".").pop() ?? "")
}

/** The single extension shared by every uploaded file, or null if there are
 *  no files or they don't all share one extension. */
function commonUploadedExt(files: File[]): string | null {
  if (files.length === 0) return null
  const exts = new Set(files.map(fileExt))
  return exts.size === 1 ? [...exts][0] : null
}

export function ToolWorkspace({
  tool,
  /** A file already in the Data Room, chosen there and passed in the URL. Its
   *  bytes are read server-side, so it is never downloaded to the browser. */
  dataRoomFile,
  onClearDataRoomFile,
  onPickDataRoomFile,
  files: filesProp,
  onFilesChange,
  embedded,
}: {
  tool: Tool
  dataRoomFile?: { id: number; name: string } | null
  onClearDataRoomFile?: () => void
  onPickDataRoomFile?: (file: DataRoomFile) => void
} & WorkspaceFileProps) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = useWorkspaceFiles(filesProp, onFilesChange)
  const [options, setOptions] = React.useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {}
    for (const opt of tool.options ?? []) {
      if (opt.kind === "select") defaults[opt.name] = opt.default
    }
    return defaults
  })
  const { status, error, result, run, downloadAgain, reset } = useToolRunner(tool.slug)
  const isHtmlResult = result?.filename.toLowerCase().endsWith(".html") ?? false

  const uploadedExt = commonUploadedExt(files)

  const choicesFor = (opt: ToolOption) => {
    if (opt.kind !== "select") return []
    if (!opt.excludeUploadedExtension || !uploadedExt) return opt.choices
    return opt.choices.filter((c) => normalizeExt(c.value) !== uploadedExt)
  }

  const missingRequired = (tool.options ?? []).find(
    (opt) => "required" in opt && opt.required && !(options[opt.name] ?? "").trim(),
  )
  // A Data Room selection counts as an input, so the run button and the
  // "needs N files" check treat both sources the same.
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const roomIds = dataRoomFile ? [dataRoomFile.id] : []
  const inputCount = files.length + roomIds.length
  const hasRequiredFileCount = tool.exactFiles ? inputCount === tool.exactFiles : inputCount > 0
  const badLength = (tool.options ?? [])
    .map((opt) => ({ opt, problem: passwordLengthProblem(opt, options[opt.name] ?? "") }))
    .find((entry) => entry.problem)
  const canRun = hasRequiredFileCount && !missingRequired && !badLength && status !== "working"

  // A disabled button with no stated cause is a dead end. Most specific first:
  // "you need one more file" is more actionable than "fill in the password".
  const blockedReason = !hasRequiredFileCount
    ? tool.exactFiles
      ? t("tool.needExactFiles", { count: tool.exactFiles, have: inputCount })
      : t("tool.needFile")
    : missingRequired
      ? t("tool.needOption", { label: reg.optLabel(tool.slug, missingRequired) })
      : badLength && badLength.opt.kind === "password"
        ? badLength.problem === "short"
          ? t("tool.passwordTooShort", { label: reg.optLabel(tool.slug, badLength.opt), min: badLength.opt.minLength ?? 0 })
          : t("tool.passwordTooLong", { label: reg.optLabel(tool.slug, badLength.opt), max: badLength.opt.maxLength ?? 0 })
        : null

  // The file can also change from the section workspace's upload bar, which
  // never runs the dropzone handler — so the same reset hangs off the file.
  const stagedFile = files[0]
  React.useEffect(() => {
    if (status === "done" || status === "error") reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedFile])

  const setOption = (name: string, value: string) => {
    setOptions((prev) => ({ ...prev, [name]: value }))
  }

  // If the uploaded files' shared format is the currently-selected choice
  // (now hidden), fall back to the first format that's still offered.
  React.useEffect(() => {
    for (const opt of tool.options ?? []) {
      if (opt.kind !== "select" || !opt.excludeUploadedExtension) continue
      const available = choicesFor(opt)
      const current = options[opt.name]
      if (!available.some((c) => c.value === current) && available[0]) {
        setOption(opt.name, available[0].value)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedExt])

  return (
    <div className={cn("w-full min-w-0 max-w-form space-y-block", !embedded && "mx-auto")}>
      <PanelShell embedded={embedded}>
        <PanelContent embedded={embedded} className="space-y-section">
          {/* The section workspace shows the chosen Data Room file in its own
              file bar, so the panel would otherwise say it twice. */}
          {dataRoomFile && !embedded && (
            <div className="space-y-2">
              <p className="text-caption text-muted-foreground">{t("dataRoom.usingFile")}</p>
              <Sheet flush className="flex items-center gap-3 px-3 py-2.5">
                <FolderOpen className="size-4 shrink-0 text-sheet-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ui" dir="ltr" title={dataRoomFile.name}>
                  {dataRoomFile.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearDataRoomFile}
                  disabled={status === "working"}
                  className="shrink-0 text-sheet-muted hover:bg-black/5 hover:text-sheet-foreground"
                >
                  {t("dataRoom.useDifferent")}
                </Button>
              </Sheet>
            </div>
          )}

          {/* Hidden when embedded: the section workspace carries one upload
              above every tool in the category, so a second dropzone here would
              be a second answer to the same question. */}
          {!embedded && (
            <FileDropzone
              accept={tool.accept}
              multiple={tool.multiple}
              capture={tool.capture}
              maxFiles={tool.exactFiles}
              files={files}
              onFilesChange={(next) => {
                setFiles(next)
                if (status === "done" || status === "error") reset()
              }}
              disabled={status === "working"}
            />
          )}

          {/* The second way in. A tool could only ever be fed a local upload,
              so a document this app had just produced had to be downloaded and
              handed straight back — the Data Room already holds it, and the
              backend reads its bytes directly (`data_room_file_ids`), so the
              file never travels to the browser and back. */}
          {!dataRoomFile && !embedded && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
                disabled={status === "working"}
              >
                <FolderOpen className="size-4" aria-hidden />
                {t("dataRoom.pick")}
              </Button>
            </div>
          )}

          {/* Options appear only once there is a file to apply them to — asking
              "which format?" above an empty dropzone is a question about
              nothing. */}
          {(tool.options ?? []).length > 0 && inputCount > 0 && (
            <div className="grid gap-block sm:grid-cols-2">
              {(tool.options ?? []).map((opt) => (
                <div key={opt.name} className="grid min-w-0 gap-1.5">
                  <Label htmlFor={`opt-${opt.name}`}>{reg.optLabel(tool.slug, opt)}</Label>
                  {opt.kind === "select" ? (
                    <Select
                      id={`opt-${opt.name}`}
                      value={options[opt.name] ?? opt.default}
                      onChange={(e) => setOption(opt.name, e.target.value)}
                      disabled={status === "working"}
                    >
                      {choicesFor(opt).map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {reg.optChoice(tool.slug, opt.name, choice.value, choice.label)}
                        </option>
                      ))}
                    </Select>
                  ) : opt.kind === "password" ? (
                    <PasswordInput
                      id={`opt-${opt.name}`}
                      minLength={opt.minLength}
                      maxLength={opt.maxLength}
                      placeholder={reg.optPlaceholder(tool.slug, opt.name, opt.placeholder)}
                      value={options[opt.name] ?? ""}
                      onChange={(e) => setOption(opt.name, e.target.value)}
                      disabled={status === "working"}
                    />
                  ) : (
                    <Input
                      id={`opt-${opt.name}`}
                      placeholder={reg.optPlaceholder(tool.slug, opt.name, opt.placeholder)}
                      value={options[opt.name] ?? ""}
                      onChange={(e) => setOption(opt.name, e.target.value)}
                      disabled={status === "working"}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {status === "error" && error && (
            <Alert
              tone="error"
              action={
                <Button variant="outline" size="sm" onClick={() => run(files, options, roomIds)}>
                  {t("common.retry")}
                </Button>
              }
            >
              {error}
            </Alert>
          )}

          {status === "done" && (
            <Alert
              tone="success"
              action={
                <Button variant="outline" size="sm" onClick={downloadAgain}>
                  <Download aria-hidden />{" "}
                  {isHtmlResult ? t("common.viewAgain") : t("common.downloadAgain")}
                </Button>
              }
            >
              {isHtmlResult ? t("tool.doneComparison") : t("common.doneDownloadStarted")}
              {result?.filename && (
                <span className="ml-1 font-medium" dir="ltr">
                  {result.filename}
                </span>
              )}
            </Alert>
          )}

          {status === "working" && <BusyPanel label={t("common.converting")} />}

          <RunBar
            label={reg.toolAction(tool)}
            busyLabel={t("common.converting")}
            busy={status === "working"}
            disabled={!canRun}
            blockedReason={blockedReason}
            onRun={() => run(files, options, roomIds)}
            onReset={
              inputCount > 0 || status !== "idle"
                ? () => {
                    setFiles([])
                    onClearDataRoomFile?.()
                    reset()
                  }
                : undefined
            }
          />
        </PanelContent>
      </PanelShell>

      <DataRoomPicker
        tool={tool}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(file) => onPickDataRoomFile?.(file)}
      />
    </div>
  )
}
