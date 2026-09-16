"use client"

import * as React from "react"
import { FolderOpen, Inbox, Sparkles } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { listDataRoom, type DataRoomFile, type DataRoomListing } from "@/lib/api"
import { useT } from "@/lib/i18n"
import type { Tool } from "@/lib/tools"
import { cn, formatBytes } from "@/lib/utils"

/**
 * "Choose from the Data Room" — the inverse of `ToolPickerDialog`.
 *
 * That one starts from a file and picks a tool; this starts from the tool you
 * already opened and picks a file the platform is holding. Until now the only
 * route into a tool was a local upload, so a document the app had *just
 * produced* had to be downloaded and handed back in by hand.
 *
 * Files are offered from Uploads and from every per-tool Results folder, each
 * labelled with where it came from — "board-pack.pdf" means something rather
 * different depending on whether it is the original or the compressor's output.
 *
 * Only files this tool actually accepts are listed. The backend validates by
 * extension (`core/files.save_bytes`), so offering the rest would be offering
 * a rejection one click later.
 */
function acceptsFile(accept: string, filename: string): boolean {
  const ext = "." + (filename.split(".").pop() ?? "").toLowerCase()
  return accept
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(ext)
}

type Entry = { file: DataRoomFile; source: string; kind: "upload" | "result" }

function flatten(listing: DataRoomListing, uploadsLabel: string): Entry[] {
  const out: Entry[] = listing.uploads.files.map((file) => ({
    file,
    source: uploadsLabel,
    kind: "upload" as const,
  }))
  for (const file of listing.results.files) {
    out.push({ file, source: listing.results.name, kind: "result" })
  }
  for (const folder of listing.results.folders ?? []) {
    for (const file of folder.files) out.push({ file, source: folder.name, kind: "result" })
  }
  // Newest first: the file you want is almost always the one just produced.
  return out.sort((a, b) => b.file.id - a.file.id)
}

export function DataRoomPicker({
  tool,
  open,
  onClose,
  onPick,
}: {
  tool: Tool
  open: boolean
  onClose: () => void
  onPick: (file: DataRoomFile) => void
}) {
  const t = useT()
  const titleId = React.useId()
  const [listing, setListing] = React.useState<DataRoomListing | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Fetched when the dialog opens, not on mount: every tool page would
  // otherwise call the Data Room on load for a dialog most visits never open.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setListing(null)
    listDataRoom()
      .then((l) => !cancelled && setListing(l))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [open])

  const all = listing ? flatten(listing, listing.uploads.name) : []
  const usable = all.filter((e) => acceptsFile(tool.accept, e.file.original_filename))

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} labelledBy={titleId}>
      <div className="space-y-block">
        <div className="min-w-0">
          <h2 id={titleId} className="text-heading">
            {t("dataRoom.pickTitle")}
          </h2>
          <p className="mt-1 text-caption text-muted-foreground">{t("dataRoom.pickHint")}</p>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        {listing && !listing.available && <Alert tone="info">{listing.detail}</Alert>}

        {listing === null && !error && (
          <p className="py-6 text-center text-ui text-muted-foreground">{t("dataRoom.pickLoading")}</p>
        )}

        {/* Three different empty states, because they need three different
            answers: the room is empty, the room has files but none this tool
            can open, or there is something to show. Collapsing the first two
            into "no files" is what leaves someone staring at a dialog with no
            idea whether to upload something or pick a different tool. */}
        {listing?.available && all.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <FolderOpen className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-ui font-medium">{t("dataRoom.pickEmptyTitle")}</p>
            <p className="mt-1 text-caption text-muted-foreground">{t("dataRoom.pickEmptyHint")}</p>
          </div>
        )}

        {listing?.available && all.length > 0 && usable.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <FolderOpen className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-ui font-medium">
              {t("dataRoom.pickNoneUsableTitle", { tool: tool.title })}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {t("dataRoom.pickNoneUsableHint", { count: all.length })}
            </p>
          </div>
        )}

        {usable.length > 0 && (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto" aria-label={t("dataRoom.pickTitle")}>
            {usable.map((entry) => {
              const Icon = entry.kind === "upload" ? Inbox : Sparkles
              return (
                <li key={entry.file.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(entry.file)
                      onClose()
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left",
                      "transition-colors duration-[var(--dt-dur-instant)] ease-out",
                      "hover:border-primary/40 hover:bg-accent",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-ui"
                        dir="ltr"
                        title={entry.file.original_filename}
                      >
                        {entry.file.original_filename}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {entry.source} · {formatBytes(entry.file.file_size)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
