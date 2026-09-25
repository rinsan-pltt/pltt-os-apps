"use client"

/**
 * One tool's working surface, chosen by its `kind`.
 *
 * Lifted out of `tool-view.tsx` because two screens now render a tool: its own
 * page at `/tools/<slug>`, and the section workspace at `/category/<slug>`,
 * where the same panel appears beside the other tools in its category. Keeping
 * one switch means a new `kind` is wired in once.
 */

import { AiWorkspace } from "@/components/layout/ai-workspace"
import { CompareWorkspace } from "@/components/layout/compare-workspace"
import { CropWorkspace } from "@/components/layout/crop-workspace"
import { EditWorkspace } from "@/components/layout/edit-workspace"
import { OrganizeWorkspace } from "@/components/layout/organize-workspace"
import { PageNumbersWorkspace } from "@/components/layout/page-numbers-workspace"
import { RotateWorkspace } from "@/components/layout/rotate-workspace"
import { SignWorkspace } from "@/components/layout/sign-workspace"
import { ToolWorkspace } from "@/components/layout/tool-workspace"
import { TranslateWorkspace } from "@/components/layout/translate-workspace"
import { UrlWorkspace } from "@/components/layout/url-workspace"
import { WatermarkWorkspace } from "@/components/layout/watermark-workspace"
import type { WorkspaceFileProps } from "@/hooks/use-workspace-files"
import type { DataRoomFile } from "@/lib/api"
import type { Tool } from "@/lib/tools"

export interface ToolPanelProps extends WorkspaceFileProps {
  tool: Tool
  /** A Data Room file chosen instead of an upload. Only the plain converter
   *  reads one today — the editors work on bytes they load themselves. */
  dataRoomFile?: { id: number; name: string } | null
  onClearDataRoomFile?: () => void
  onPickDataRoomFile?: (file: DataRoomFile) => void
}

export function ToolPanel({
  tool,
  dataRoomFile,
  onClearDataRoomFile,
  onPickDataRoomFile,
  ...fileProps
}: ToolPanelProps) {
  switch (tool.kind) {
    case "ai":
      return <AiWorkspace tool={tool} {...fileProps} />
    case "edit":
      return <EditWorkspace tool={tool} {...fileProps} />
    case "organize":
      return <OrganizeWorkspace tool={tool} {...fileProps} />
    case "url":
      // Takes a URL, so there is no file to hand it — but it still needs to
      // know not to draw its own heading inside the section's panel.
      return <UrlWorkspace tool={tool} embedded={fileProps.embedded} />
    case "page-numbers":
      return <PageNumbersWorkspace tool={tool} {...fileProps} />
    case "rotate":
      return <RotateWorkspace tool={tool} {...fileProps} />
    case "sign":
      return <SignWorkspace tool={tool} {...fileProps} />
    case "translate":
      return <TranslateWorkspace tool={tool} {...fileProps} />
    case "compare":
      // Two documents, two panes: it takes the section's first file on the
      // left and its second on the right, and keeps its own per-pane pickers
      // for swapping one side.
      return <CompareWorkspace tool={tool} {...fileProps} />
    case "watermark":
      return <WatermarkWorkspace tool={tool} {...fileProps} />
    case "crop":
      return <CropWorkspace tool={tool} {...fileProps} />
    default:
      return (
        <ToolWorkspace
          tool={tool}
          dataRoomFile={dataRoomFile}
          onClearDataRoomFile={onClearDataRoomFile}
          onPickDataRoomFile={onPickDataRoomFile}
          {...fileProps}
        />
      )
  }
}

/** Whether a tool takes over the full width — the editors and side-by-side
 *  surfaces, as opposed to the form-shaped converters. */
export function isWideTool(tool: Tool): boolean {
  return (
    tool.kind === "edit" ||
    tool.kind === "organize" ||
    tool.kind === "translate" ||
    tool.kind === "compare"
  )
}
