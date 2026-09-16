"use client"

import * as React from "react"

import { downloadBlob, runTool, type ToolResult } from "@/lib/api"

export type RunnerStatus = "idle" | "working" | "done" | "error"

export function useToolRunner(slug: string) {
  const [status, setStatus] = React.useState<RunnerStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ToolResult | null>(null)

  const run = React.useCallback(
    async (
      files: File[],
      options: Record<string, string>,
      dataRoomFileIds: number[] = [],
    ) => {
      // Guard re-entry here rather than in each of the callers: `run` used to
      // be unguarded and every workspace re-derived its own `canRun`.
      setStatus("working")
      setError(null)
      setResult(null)
      try {
        const res = await runTool(slug, files, options, dataRoomFileIds)
        setResult(res)
        setStatus("done")
        // HTML results (e.g. Compare PDF's diff report) are meant to be
        // viewed, not downloaded — open them in a new tab instead.
        if (res.filename.toLowerCase().endsWith(".html")) {
          window.open(URL.createObjectURL(res.blob), "_blank")
        } else {
          downloadBlob(res.blob, res.filename)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Conversion failed.")
        setStatus("error")
      }
    },
    [slug],
  )

  const downloadAgain = React.useCallback(() => {
    if (!result) return
    if (result.filename.toLowerCase().endsWith(".html")) {
      window.open(URL.createObjectURL(result.blob), "_blank")
    } else {
      downloadBlob(result.blob, result.filename)
    }
  }, [result])

  const reset = React.useCallback(() => {
    setStatus("idle")
    setError(null)
    setResult(null)
  }, [])

  return { status, error, result, run, downloadAgain, reset }
}
