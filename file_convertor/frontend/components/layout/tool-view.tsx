"use client"

/**
 * A tool's whole screen, rendered from two places.
 *
 * It lives in a component rather than a page because two routes render it:
 * `/tools/<slug>` and `/tools/<slug>/file/<id>`, the second being a tool opened
 * with a Data Room file already chosen.
 */

import * as React from "react"
import { useParams, useRouter } from "next/navigation"

import { AppShell } from "@/components/layout/app-shell"
import { PageHeader } from "@/components/layout/page-header"
import { ToolPanel, isWideTool } from "@/components/layout/tool-panel"
import { useRegistryText } from "@/lib/i18n"
import { listDataRoom } from "@/lib/api"
import { toolFileHref, toolHref, type Tool } from "@/lib/tools"
import { cn } from "@/lib/utils"

export function ToolView({ tool }: { tool: Tool }) {
  const routeParams = useParams<{ fileId?: string }>()
  const router = useRouter()
  const reg = useRegistryText()

  // A file picked in the Data Room arrives as the `<id>` of
  // `/tools/<slug>/file/<id>`. The id is all that travels; the name is resolved
  // from the listing so the chip can show it, and the bytes never leave the
  // platform.
  const roomFileId = Number(routeParams?.fileId ?? "")
  const [roomFile, setRoomFile] = React.useState<{ id: number; name: string } | null>(null)
  React.useEffect(() => {
    if (!Number.isFinite(roomFileId) || roomFileId <= 0) {
      setRoomFile(null)
      return
    }
    let cancelled = false
    listDataRoom()
      .then((listing) => {
        // Every pool, including each per-tool Results folder. Results moved a
        // level deeper when they began being grouped by tool, and a lookup
        // across only the two top folders silently resolved to nothing — the
        // chip never appeared and the run button stayed disabled, with the id
        // sitting in the URL the whole time.
        const match = [
          ...listing.uploads.files,
          ...listing.results.files,
          ...(listing.results.folders ?? []).flatMap((f) => f.files),
        ].find((f) => f.id === roomFileId)
        if (!cancelled) {
          setRoomFile(match ? { id: match.id, name: match.original_filename } : null)
        }
      })
      .catch(() => {
        // The id is still usable — the backend resolves it independently — so
        // fall back to showing the id rather than dropping the selection.
        if (!cancelled) setRoomFile({ id: roomFileId, name: `#${roomFileId}` })
      })
    return () => {
      cancelled = true
    }
  }, [roomFileId])

  const clearRoomFile = React.useCallback(() => {
    setRoomFile(null)
    router.replace(toolHref(tool.slug))
  }, [router, tool.slug])

  // Picked from inside the tool. The chip is set straight from the dialog's own
  // data rather than waiting for the URL effect to resolve the id again, and
  // the id still goes into the URL so the choice survives a reload.
  const pickRoomFile = React.useCallback(
    (file: { id: number; original_filename: string }) => {
      setRoomFile({ id: file.id, name: file.original_filename })
      router.replace(toolFileHref(tool.slug, file.id))
    },
    [router, tool.slug],
  )

  // Shared with the section workspace, which lays itself out the same way.
  const wide = isWideTool(tool)

  // The page's width has to MATCH what the workspace renders, because this
  // header sits outside it: a container wider than its content is what left
  // the `PDF ->` chip stranded 840px from the title on a large display.
  //
  // Measured, not assumed — crop, sign and watermark each cap their own root
  // at 42rem and the AI workspaces at 48rem, so those are the widths used
  // here. The four `wide` editors cap nothing and take the whole area.
  const panel = tool.kind === "ai"

  return (
    // The sidebar's width is the user's standing choice, not this route's: the
    // wide surfaces (editor, organize, translate, compare) used to open with it
    // collapsed to a rail, which meant it visibly closed on the way in and
    // re-opened on the way out. Anyone who wants the canvas can collapse it
    // once and it stays collapsed.
    <AppShell>
      {/* The same band as home, Workflows and the Data Room, so a tool page
          opens the way every other page does: heading in a tinted strip closed
          by a rule, work beneath it. There is deliberately no "back to All
          tools" link — the sidebar carries that on every route, and a second
          copy above every page title was the same destination twice.

          The header carries no format chip. A `PDF -> DOCX` pair sat beside the
          title here, but by the time you have opened a tool you have already
          chosen it — the card you came from states the conversion, the dropzone
          below lists the formats it accepts, and a third copy next to the
          heading was decoration on the one screen with a job to do. `align` and
          the trailing slot go with it; `width` stays because it still decides
          the band's own measure. */}
      <PageHeader
        title={reg.toolTitle(tool)}
        description={wide ? undefined : reg.toolDescription(tool)}
        width={wide ? "full" : panel ? "panel" : "form"}
      />
      {/* The container is the same `--dt-w-grid` every other page uses, and the
          workspace is capped INSIDE it rather than the page being capped and
          centred. Both start at the same left edge, so a tool's heading and its
          card line up with each other and with the home page's heading — they
          used to sit at four different left edges (280 / 500 / 548 / 96 at
          1470px) depending on which page you had open. */}
      <div
        className={cn(
          "w-full min-w-0 px-gutter",
          wide ? "flex flex-col gap-block py-block" : "max-w-grid py-section",
        )}
      >
        <div className={cn("min-w-0", wide ? "" : panel ? "max-w-panel" : "max-w-form")}>
        <ToolPanel
          tool={tool}
          dataRoomFile={roomFile}
          onClearDataRoomFile={clearRoomFile}
          onPickDataRoomFile={pickRoomFile}
        />
        </div>
      </div>
    </AppShell>
  )
}
