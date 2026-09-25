"use client"

import * as React from "react"
import { Download, Globe, Loader2, RefreshCw } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { PanelContent, PanelShell } from "@/components/ui/panel-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { downloadBlob, runUrlTool, type ToolResult } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useT, useRegistryText } from "@/lib/i18n"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "working" | "done" | "error"

export function UrlWorkspace({
  tool,
  /** Rendered inside the section workspace, which heads the panel itself. */
  embedded,
}: {
  tool: Tool
  embedded?: boolean
}) {
  const t = useT()
  const reg = useRegistryText()
  const [url, setUrl] = React.useState("")
  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ToolResult | null>(null)

  const canRun = /^https?:\/\/.+/i.test(url.trim()) && status !== "working"

  const run = async () => {
    if (!canRun) return
    setStatus("working")
    setError(null)
    try {
      const res = await runUrlTool(tool.slug, url.trim())
      setResult(res)
      setStatus("done")
      downloadBlob(res.blob, res.filename)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("url.conversionFailed"))
      setStatus("error")
    }
  }

  return (
    // Embedded, the URL field fills the section's card — capped at the form
    // measure it sat in the card's left corner once the section went full
    // width. The standalone page keeps its centred form.
    <div className={cn("w-full min-w-0 space-y-6", !embedded && "mx-auto max-w-form")}>
      <PanelShell embedded={embedded}>
        {!embedded && (
          <CardHeader>
            <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
            <CardDescription>{reg.toolDescription(tool)}</CardDescription>
          </CardHeader>
        )}
        <PanelContent embedded={embedded} className="space-y-6">
          <div className="grid gap-1.5">
            <Label htmlFor="page-url">{t("url.pageUrl")}</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="page-url"
                type="url"
                placeholder="https://example.com/article"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (status !== "working") setStatus("idle")
                }}
                disabled={status === "working"}
                className="pl-9"
              />
            </div>
          </div>

          {status === "error" && error && (
            <Alert tone="error">{error}</Alert>
          )}

          {status === "done" && (
            <Alert tone="success" action={<Button variant="outline" size="sm" onClick={() => result && downloadBlob(result.blob, result.filename)}>
                <Download className="size-4" /> {t("common.downloadAgain")}
              </Button>}>{t("common.doneDownloadStarted")}</Alert>
          )}

          {status === "working" && (
            <BusyPanel label={t("common.converting")} />
          )}

          {/* Held to the form measure so the button sits on the left at the
              same width as every other tool's, not stretched across the card. */}
          <div className="flex max-w-form items-center gap-3">
            <Button size="lg" className="flex-1" disabled={!canRun} onClick={run}>
              {status === "working" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t("common.converting")}
                </>
              ) : (
                reg.toolAction(tool)
              )}
            </Button>
            {(url || status !== "idle") && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setUrl("")
                  setStatus("idle")
                  setError(null)
                  setResult(null)
                }}
                disabled={status === "working"}
              >
                <RefreshCw className="size-4" /> {t("common.startOver")}
              </Button>
            )}
          </div>
        </PanelContent>
      </PanelShell>

      <p className={cn("text-xs text-muted-foreground", !embedded && "text-center")}>{t("url.note")}</p>
    </div>
  )
}
