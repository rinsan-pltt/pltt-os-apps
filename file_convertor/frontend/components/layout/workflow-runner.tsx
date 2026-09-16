"use client"

import * as React from "react"
import { ChevronRight, Loader2, RefreshCw, Workflow as WorkflowIcon } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { downloadBlob, runTool } from "@/lib/api"
import { useT, useRegistryText } from "@/lib/i18n"
import { firstTool, type Workflow } from "@/lib/workflows"

type Status = "idle" | "running" | "done" | "error"

export function WorkflowRunner({ workflow }: { workflow: Workflow }) {
  const t = useT()
  const reg = useRegistryText()
  const entryTool = firstTool(workflow)
  const [files, setFiles] = React.useState<File[]>([])
  const [promptValues, setPromptValues] = React.useState<Record<string, string>>({})
  const [status, setStatus] = React.useState<Status>("idle")
  const [currentStep, setCurrentStep] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  if (!entryTool) {
    return <p className="text-sm text-destructive">{t("workflows.misconfigured")}</p>
  }

  const missingRequired = workflow.steps.some((step, i) =>
    (step.promptOptions ?? []).some(
      (opt) => "required" in opt && opt.required && !(promptValues[`${i}.${opt.name}`] ?? "").trim(),
    ),
  )
  const canRun = files.length > 0 && !missingRequired && status !== "running"

  const setPromptValue = (stepIndex: number, name: string, value: string) => {
    setPromptValues((prev) => ({ ...prev, [`${stepIndex}.${name}`]: value }))
  }

  const run = async () => {
    setStatus("running")
    setError(null)
    let currentFiles = files
    for (let i = 0; i < workflow.steps.length; i++) {
      setCurrentStep(i)
      const step = workflow.steps[i]
      const merged: Record<string, string> = { ...step.options }
      for (const opt of step.promptOptions ?? []) {
        merged[opt.name] = promptValues[`${i}.${opt.name}`] ?? (opt.kind === "select" ? opt.default : "")
      }
      try {
        const result = await runTool(step.toolSlug, currentFiles, merged)
        currentFiles = [new File([result.blob], result.filename, { type: result.blob.type })]
        if (i === workflow.steps.length - 1) {
          downloadBlob(result.blob, result.filename)
          setStatus("done")
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("workflows.stepFailedShort")
        setError(t("workflows.stepFailed", { step: i + 1, label: reg.stepLabel(step.label), msg }))
        setStatus("error")
        return
      }
    }
  }

  return (
    // No `mx-auto` and no card header: the page's band states the workflow's
    // name and description as its <h1>, and this used to repeat both inside
    // the card while centring itself away from that heading.
    <div className="w-full space-y-6">
      <Card>
        <CardContent className="space-y-6 pt-surface">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {workflow.steps.map((step, i) => (
              <React.Fragment key={step.toolSlug + i}>
                {i > 0 && <ChevronRight className="size-4" />}
                <span
                  className={
                    status === "running" && currentStep === i
                      ? "flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary"
                      : "rounded-full bg-muted px-2.5 py-1"
                  }
                >
                  {status === "running" && currentStep === i && <Loader2 className="size-3.5 animate-spin" />}
                  {reg.stepLabel(step.label)}
                </span>
              </React.Fragment>
            ))}
          </div>

          <FileDropzone
            accept={entryTool.accept}
            multiple={entryTool.multiple}
            capture={entryTool.capture}
            files={files}
            onFilesChange={(next) => {
              setFiles(next)
              if (status !== "running") setStatus("idle")
            }}
            disabled={status === "running"}
          />

          {workflow.steps.map((step, i) =>
            (step.promptOptions ?? []).length > 0 ? (
              <div key={step.toolSlug + i} className="grid gap-4 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("workflows.stepPrefix", { n: i + 1, label: reg.stepLabel(step.label) })}
                </p>
                {step.promptOptions!.map((opt) => (
                  <div key={opt.name} className="grid gap-1.5">
                    <Label htmlFor={`wf-${i}-${opt.name}`}>{reg.wfOptLabel(workflow.slug, i, opt.name, opt.label)}</Label>
                    {opt.kind === "select" ? (
                      <Select
                        id={`wf-${i}-${opt.name}`}
                        value={promptValues[`${i}.${opt.name}`] ?? opt.default}
                        onChange={(e) => setPromptValue(i, opt.name, e.target.value)}
                        disabled={status === "running"}
                      >
                        {opt.choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={`wf-${i}-${opt.name}`}
                        type={opt.kind === "password" ? "password" : "text"}
                        placeholder={"placeholder" in opt ? reg.wfOptPlaceholder(workflow.slug, i, opt.name, opt.placeholder) : ""}
                        value={promptValues[`${i}.${opt.name}`] ?? ""}
                        onChange={(e) => setPromptValue(i, opt.name, e.target.value)}
                        disabled={status === "running"}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null,
          )}

          {status === "error" && error && (
            <Alert tone="error">{error}</Alert>
          )}
          {status === "done" && (
            <Alert tone="success">{t("common.doneDownloadStarted")}</Alert>
          )}

          {status === "running" && (
            <BusyPanel label={t("workflows.running", { current: currentStep + 1, total: workflow.steps.length })} />
          )}

          <div className="flex items-center gap-3">
            <Button size="lg" className="flex-1" disabled={!canRun} onClick={run}>
              {status === "running" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t("workflows.running", { current: currentStep + 1, total: workflow.steps.length })}
                </>
              ) : (
                <>
                  <WorkflowIcon className="size-4" /> {t("workflows.runWorkflow")}
                </>
              )}
            </Button>
            {(files.length > 0 || status !== "idle") && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setFiles([])
                  setStatus("idle")
                  setError(null)
                }}
                disabled={status === "running"}
              >
                <RefreshCw className="size-4" /> {t("common.startOver")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">{t("workflows.autoRunNote")}</p>
    </div>
  )
}
