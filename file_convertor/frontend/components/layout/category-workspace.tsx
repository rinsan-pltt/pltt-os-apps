"use client"

/**
 * A category as a working screen: one upload at the top, every tool in the
 * section beside it.
 *
 * `/category/<slug>` used to be the home grid with a filter on it — a page of
 * cards, each a link to a tool with its own dropzone. That made the upload
 * belong to the tool rather than to the document: running a PDF through
 * Compress and then Rotate meant choosing the file, converting, going back,
 * choosing the SAME file again. The file now belongs to the section, and the
 * tool is what changes beneath it.
 *
 * The tool pages at `/tools/<slug>` are untouched and still work standalone —
 * they are what a home-page card, a search result and a shared link open.
 */

import * as React from "react"
import Link from "next/link"
import { FileUp, FolderOpen, TriangleAlert, X } from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { DataRoomPicker } from "@/components/layout/data-room-picker"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { PageHeader } from "@/components/layout/page-header"
import { ToolPanel } from "@/components/layout/tool-panel"
import { toolIcon } from "@/components/layout/tool-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Sheet } from "@/components/ui/sheet"
import type { DataRoomFile } from "@/lib/api"
import { setSessionDataRoomFile, setSessionFiles, useFileSession } from "@/lib/file-session"
import { useT, useRegistryText } from "@/lib/i18n"
import { categoryTone } from "@/lib/tool-tone"
import {
  categoryAccept,
  categoryMultiple,
  formatSummary,
  toolFit,
  toolHref,
  toolsInCategory,
  usesSectionFile,
  type Category,
  type Tool,
  type ToolFit,
} from "@/lib/tools"
import { listArrowNav } from "@/lib/arrow-nav"
import { cn } from "@/lib/utils"

export function CategoryWorkspace({ category }: { category: Category }) {
  const t = useT()
  const reg = useRegistryText()

  const tools = React.useMemo(() => toolsInCategory(category), [category])
  const accept = React.useMemo(() => categoryAccept(category), [category])
  const multiple = React.useMemo(() => categoryMultiple(category), [category])

  // Not component state: the sidebar remounts this component when it moves
  // between categories, and the whole promise is that the file does not care.
  // See lib/file-session.ts.
  const { files, dataRoomFile } = useFileSession()
  const setFiles = setSessionFiles
  const setDataRoomFile = setSessionDataRoomFile

  const [activeSlug, setActiveSlug] = React.useState(() => tools[0]?.slug ?? "")
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const railRef = React.useRef<HTMLUListElement>(null)

  // The sidebar moves between categories without remounting this component, so
  // the selected tool has to follow the section. The FILE deliberately does
  // not: carrying a PDF from Organize to Optimize is the same document and the
  // same intent, and any tool that cannot take it says so in the rail.
  React.useEffect(() => {
    setActiveSlug(tools[0]?.slug ?? "")
  }, [category, tools])

  const active = tools.find((tool) => tool.slug === activeSlug) ?? tools[0]

  // A Data Room selection is an input like any other and carries a filename,
  // so the format check applies to it exactly as it does to an upload.
  const inputs = React.useMemo(
    () => [...files, ...(dataRoomFile ? [{ name: dataRoomFile.name }] : [])],
    [files, dataRoomFile],
  )

  const fit = active ? toolFit(active, inputs) : ({ ok: true } as ToolFit)

  // Uploading a PDF into Convert PDF used to leave "Word to PDF" selected and
  // show a warning where the tool should be — the screen answered a question
  // nobody asked. The selection follows the file to the first tool that can
  // use it, and only when the current one cannot; a deliberate choice of a
  // compatible tool is never overridden.
  //
  // Keyed on the INPUTS alone. With `active` in the dependencies the effect
  // re-fired on the user's own selection, so clicking a greyed tool to find
  // out why it is greyed bounced straight back to the previous one — the rail
  // looked broken. Changing the file is the only thing that may move it.
  React.useEffect(() => {
    if (!active || toolFit(active, inputs).ok) return
    // A tool that consumes the file, in preference to one that merely
    // tolerates it: dropping a PDF into Convert PDF landed on "HTML to PDF",
    // which is never greyed out because its input is a URL — technically a
    // fit, and obviously not what the file was dropped for.
    const usable =
      tools.find((tool) => usesSectionFile(tool) && toolFit(tool, inputs).ok) ??
      tools.find((tool) => toolFit(tool, inputs).ok)
    if (usable) setActiveSlug(usable.slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs])
  const needsFile = active ? usesSectionFile(active) : false
  const hasInput = inputs.length > 0

  /** Why a tool is greyed out, as a sentence. */
  const fitReason = (result: ToolFit): string | null => {
    if (result.ok) return null
    if (result.reason === "format") {
      return t("section.needsFormat", { formats: result.formats.join(", ") })
    }
    if (result.reason === "exact") return t("section.needsExact", { count: result.need })
    return t("section.needsSingle")
  }

  if (!active) return null

  const ActiveIcon = toolIcon(active)
  const unusableCount = tools.filter((tool) => !toolFit(tool, inputs).ok).length

  /** What the selected tool takes, capped the same way the dropzone caps it. */
  const acceptedSummary = (tool: Tool) => {
    if (!usesSectionFile(tool)) return ""
    const { shown, more } = formatSummary(tool.accept)
    return t("section.acceptsFormats", {
      tool: reg.toolTitle(tool),
      formats: more > 0 ? `${shown} ${t("dropzone.andMore", { count: more })}` : shown,
    })
  }

  const rail = (
    // Always a column, in every section and for every kind of tool. The rail
    // sat beside the panel for the form-shaped tools and wrapped into a row
    // above it for the editors, which meant the same control changed axis
    // depending on which tool you had selected. One axis, one place.
    //
    // Rows are deliberately compact — a 40px row, not a 78px card. Convert
    // PDF has thirteen tools, and at card height that list was 1000px long:
    // it ran off the bottom of a laptop screen and put a second scrollbar
    // inside a page that already scrolled. At this height the longest section
    // in the app fits without one.
    // Up/Down move through the tools and select each as they go — the list is
    // a picker, so arriving on a tool IS choosing it (Home/End jump to ends).
    <ul
      ref={railRef}
      onKeyDown={(e) => {
        const moved = listArrowNav(e, railRef.current, "button[data-tool-slug]")
        const slug = moved?.getAttribute("data-tool-slug")
        if (slug) setActiveSlug(slug)
      }}
      className="flex min-w-0 flex-col gap-0.5 overflow-y-auto pr-1 max-h-[19rem] lg:max-h-[calc(100dvh-11rem)]"
    >
      {tools.map((tool) => {
        const toolFitResult = toolFit(tool, inputs)
        const reason = fitReason(toolFitResult)
        const selected = tool.slug === active.slug
        const Icon = toolIcon(tool)
        return (
          <li key={tool.slug} className="min-w-0">
            <button
              type="button"
              data-tool-slug={tool.slug}
              onClick={() => setActiveSlug(tool.slug)}
              // `aria-disabled`, not `disabled`. A disabled button leaves the
              // tab order, so the only explanation of WHY a tool is greyed —
              // its tooltip — was unreachable by keyboard. It stays selectable
              // instead, and the panel states the reason in full.
              aria-disabled={!toolFitResult.ok || undefined}
              aria-current={selected ? "true" : undefined}
              // The reason is on the control itself, so it reaches a pointer
              // as a tooltip and a screen reader as the accessible description
              // — not only the sighted reader of the caption below.
              title={reason ?? undefined}
              className={cn(
                "group relative flex w-full min-w-0 items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 text-left",
                "transition-colors duration-[var(--dt-dur-fast)]",
                // No focus ring: arrowing through the list selects as it
                // goes, so the selected row's own highlight already says where
                // focus is, and a ring drew a second box around it. A row
                // reached by Tab without being selected gets the hover shade.
                "focus-visible:outline-none focus-visible:bg-muted/50",
                // The selected row is a quiet surface with a primary marker,
                // NOT a filled primary pill: the sidebar's active category is
                // already a solid orange pill two inches to the left, and two
                // of those side by side read as two competing selections.
                selected ? "bg-muted text-foreground" : "hover:bg-muted/50",
                !toolFitResult.ok && !selected && "opacity-60",
              )}
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                />
              )}
              <Icon
                aria-hidden
                className={cn(
                  "size-4 shrink-0",
                  // The tint is the SELECTED row's, not every row's. Thirteen
                  // identical blue tiles carried no information and buried the
                  // one row that mattered.
                  selected ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              <span className={cn("min-w-0 flex-1 truncate text-ui", selected && "font-medium")}>
                {reg.toolTitle(tool)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  /** The panel's two waiting states. Deliberately NOT the `Sheet` surface:
   *  that is paper white in both themes because it means "this is your
   *  document", and an empty prompt is the one thing that is not a document —
   *  it rendered as a blank white slab across the dark workspace. */
  /** The panel's two waiting states. Deliberately NOT the `Sheet` surface:
   *  that is paper white in both themes because it means "this is your
   *  document", and an empty prompt is the one thing that is not a document —
   *  it rendered as a blank white slab across the dark workspace.
   *
   *  A row rather than a tall panel, too. A 176px dashed box sitting directly
   *  under a 290px dropzone read as two empty boxes competing for the same
   *  job; this one states its line and gets out of the way. */
  const notice = (title: string, hint: string, tone: "wait" | "mismatch") => (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-dashed px-4 py-4",
        tone === "mismatch" ? "border-warning/40 bg-warning-subtle" : "border-border bg-muted/20",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          tone === "mismatch" ? "text-warning" : "bg-muted text-muted-foreground",
        )}
      >
        {tone === "mismatch" ? <TriangleAlert className="size-5" /> : <FileUp className="size-4" />}
      </span>
      <div className="min-w-0">
        <p className={cn("text-ui font-medium", tone === "mismatch" && "text-warning-text")}>{title}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p>
      </div>
    </div>
  )

  const panel = (() => {
    // Compare and HTML to PDF bring their own inputs, so they open straight
    // into their own surface whatever the section's dropzone holds.
    if (!needsFile) return <ToolPanel tool={active} embedded />
    // Nothing loaded: the drop area above IS the prompt, and a second one
    // under it asked for the same file twice.
    if (!hasInput) return null
    if (!fit.ok) {
      return notice(fitReason(fit) ?? "", t("section.mismatchHint", { tool: reg.toolTitle(active) }), "mismatch")
    }
    return (
      <ToolPanel
        tool={active}
        embedded
        files={files}
        onFilesChange={setFiles}
        dataRoomFile={dataRoomFile}
        onClearDataRoomFile={() => setDataRoomFile(null)}
        onPickDataRoomFile={(file: DataRoomFile) =>
          setDataRoomFile({ id: file.id, name: file.original_filename })
        }
      />
    )
  })()

  return (
    <AppShell>
      {/* No trailing control. "Open Word to PDF on its own page" sat out at the
          far right of the band, a thousand pixels from the tool it named and
          level with the section title it had nothing to do with. It now sits
          beside that tool's own heading, below. */}
      <PageHeader
        title={reg.category(category)}
        description={t("section.subtitle")}
        width="full"
      />

      {/* Full width for every tool, not just the wide editors: capped at the
          grid measure, a big monitor left an empty band down the right while
          Organize alone ran to the edge. */}
      <div className="w-full min-w-0 px-gutter py-section">
        {/* The rail runs down the left of the tool card. That vertical strip
            was dead space, and it is exactly the room a long section needs —
            thirteen tools fit beside the tool instead of above it.

            Under `lg` the grid becomes one column and the rail sits above the
            tool, which is the same order the eye takes across the desktop
            layout: pick on the left, work on the right. */}
        <div className="grid min-w-0 gap-block lg:grid-cols-[var(--dt-toolrail-w)_minmax(0,1fr)] lg:items-start">
          <nav aria-label={t("section.chooseTool")} className="min-w-0">
            <div className="lg:sticky lg:top-0">
              <h2 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t("section.chooseTool")}
              </h2>
              {/* Said once, here, rather than repeated under every greyed row. */}
              <p className="mb-2 mt-0.5 min-h-[1lh] text-micro text-muted-foreground">
                {unusableCount > 0 ? t("section.needDifferentFile", { count: unusableCount }) : ""}
              </p>
              {rail}
            </div>
          </nav>

          {/* ONE object: the tool's name, the file it is working on, and its
              controls, inside a single card.

              They were three stacked panels before — an upload card, a bare
              heading, then the tool's own card — and the screen read as a page
              that happened to have a converter somewhere on it rather than as
              a tool you had picked up. The rail chooses the tool; this card is
              the tool. */}
          <Card className="min-w-0 self-start overflow-hidden">
            <div className="flex min-w-0 flex-wrap items-start gap-3 border-b border-border bg-muted/20 p-surface">
              <span
                aria-hidden
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  categoryTone(active.category),
                )}
              >
                <ActiveIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-heading">{reg.toolTitle(active)}</h2>
                {/* Always exactly two lines: a one-line description reserves
                    the second and a longer one is clamped (full text on
                    hover), so switching tools never moves the drop area. */}
                <p
                  title={reg.toolDescription(active)}
                  className="mt-0.5 line-clamp-2 min-h-[2lh] max-w-[70ch] text-pretty text-caption text-muted-foreground"
                >
                  {reg.toolDescription(active)}
                </p>
              </div>
              <Link
                href={toolHref(active.slug)}
                // Its own line on a phone: beside the title it squeezed the
                // description into four lines to save one.
                className="order-last basis-full shrink-0 text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:order-none sm:basis-auto sm:text-right"
              >
                {t("section.openToolPage")}
              </Link>
            </div>

            {/* The file this section is working on. A strip once something is
                loaded — it is context for the tool below, not the subject of
                the screen. */}
            {needsFile && (
              <div className="space-y-3 border-b border-border p-surface">
                <FileDropzone
                  accept={accept}
                  multiple={active.multiple}
                  maxFiles={active.exactFiles}
                  files={files}
                  onFilesChange={setFiles}
                  compactWhenFilled
                />

                {/* What the SELECTED tool takes, which is not what the drop
                    area takes: the section accepts anything its tools do
                    between them, so on Convert PDF the two differ by sixteen
                    formats. Only while empty — once a file is in, the rail
                    says which tools can use it. */}
                {!hasInput && (
                  // One line whatever the tool, for the same reason as the
                  // description above.
                  <p
                    title={acceptedSummary(active)}
                    className="truncate text-center text-caption text-muted-foreground"
                  >
                    {acceptedSummary(active)}
                  </p>
                )}

                {dataRoomFile ? (
                  <Sheet flush className="flex items-center gap-3 px-3 py-2.5">
                    <FolderOpen className="size-4 shrink-0 text-sheet-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-ui" dir="ltr" title={dataRoomFile.name}>
                      {dataRoomFile.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDataRoomFile(null)}
                      className="shrink-0 text-sheet-muted hover:bg-black/5 hover:text-sheet-foreground"
                    >
                      <X className="size-4" aria-hidden />
                      {t("common.close")}
                    </Button>
                  </Sheet>
                ) : (
                  files.length === 0 && (
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPickerOpen(true)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <FolderOpen className="size-4" aria-hidden />
                        {t("dataRoom.pick")}
                      </Button>
                    </div>
                  )
                )}
              </div>
            )}

            {panel && <div className="min-w-0 p-surface">{panel}</div>}
          </Card>
        </div>
      </div>

      <DataRoomPicker
        tool={active}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(file) => setDataRoomFile({ id: file.id, name: file.original_filename })}
      />
    </AppShell>
  )
}
