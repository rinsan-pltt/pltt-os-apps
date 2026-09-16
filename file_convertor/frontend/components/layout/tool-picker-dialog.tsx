"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Dialog } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { categoryTone } from "@/lib/tool-tone"
import { useT, useRegistryText } from "@/lib/i18n"
import { CATEGORIES, TOOLS, toolFileHref, type Tool } from "@/lib/tools"
import { type DataRoomFile } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * "Use this file with…" — pick a tool for a document already in the Data Room.
 *
 * Only tools that actually accept the file's type are offered. Showing all 37
 * and letting the user pick one that will reject the file a second later is
 * the kind of dead end this app was full of: the backend validates by
 * extension (`core/files.save_bytes`), so the filter here and the check there
 * agree by construction.
 */
function acceptsFile(tool: Tool, filename: string): boolean {
  const ext = "." + (filename.split(".").pop() ?? "").toLowerCase()
  return tool.accept
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(ext)
}

export function ToolPickerDialog({
  file,
  onClose,
}: {
  file: DataRoomFile | null
  onClose: () => void
}) {
  const t = useT()
  const reg = useRegistryText()
  const router = useRouter()
  const titleId = React.useId()
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    if (file) setQuery("")
  }, [file])

  const usable = React.useMemo(() => {
    if (!file) return []
    const needle = query.trim().toLowerCase()
    return TOOLS.filter((tool) => acceptsFile(tool, file.original_filename)).filter((tool) => {
      if (!needle) return true
      const haystack = `${tool.title} ${tool.description} ${reg.toolTitle(tool)}`.toLowerCase()
      return needle.split(/\s+/).every((w) => haystack.includes(w))
    })
  }, [file, query, reg])

  if (!file) return null

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      labelledBy={titleId}
      className="max-w-lg"
    >
      <h2 id={titleId} className="text-heading">
        {t("dataRoom.pickTool")}
      </h2>
      <p className="mt-1 truncate text-caption text-muted-foreground" dir="ltr">
        {file.original_filename}
      </p>

      {usable.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-caption text-muted-foreground">
          {t("dataRoom.noToolAccepts")}
        </p>
      ) : (
        <>
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("home.searchPlaceholder")}
            aria-label={t("home.searchAria")}
            className="mt-4"
          />
          <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
            {CATEGORIES.map((cat) => {
              const tools = usable.filter((tool) => tool.category === cat)
              if (tools.length === 0) return null
              return (
                <li key={cat}>
                  <p className="px-1 pb-1 pt-2 text-micro uppercase text-muted-foreground">
                    {reg.category(cat)}
                  </p>
                  <ul>
                    {tools.map((tool) => (
                      <li key={tool.slug}>
                        <button
                          type="button"
                          onClick={() => {
                            onClose()
                            // The id travels in the URL, so the tool page can be
                            // opened (or reloaded, or shared) with the file
                            // already selected.
                            router.push(toolFileHref(tool.slug, file.id))
                          }}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-ui",
                            "hover:bg-accent hover:text-accent-foreground",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              categoryTone(tool.category),
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{reg.toolTitle(tool)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </Dialog>
  )
}
