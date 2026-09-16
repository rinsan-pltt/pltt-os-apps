"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronRight, Download, FileText, FolderOpen, Inbox, Sparkles } from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { ToolPickerDialog } from "@/components/layout/tool-picker-dialog"
import { listDataRoom, type DataRoomFile, type DataRoomListing } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { cn, formatBytes } from "@/lib/utils"

/**
 * The Data Room — everything this app has been given and everything it has
 * produced, in the org's shared room under `Document Toolbox/`.
 *
 * Two folders you open: `Uploads` holds what you handed to a tool, `Results`
 * holds what a tool produced — grouped into one sub-folder per tool, because a
 * flat list of outputs stops being answerable ("which of these came out of the
 * compressor?") after a few dozen conversions.
 *
 * Where you are lives in the URL (`/data-room/results/merge-pdf`), the same way
 * the home page's category filter does — so every level is linkable, survives a
 * reload, and the back button steps out of it.
 *
 * Path segments rather than `?folder=…&tool=…`: a query string does not survive
 * an in-app click inside a Palette OS window. See the note on `toolHref` in
 * lib/tools.ts.
 */

/** A Results sub-folder's URL form.
 *
 *  The folder is named after the tool that filled it ("Compress PDF"), and
 *  putting that straight in the URL produced `Compress%20PDF` — an escape
 *  sequence in a link people are meant to read. Derived from the folder's own
 *  name rather than looked up in the tool registry, so a folder left behind by
 *  a renamed or removed tool still addresses itself correctly. */
const folderSlug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
type FolderKey = "uploads" | "results"
const isFolderKey = (v: string | null): v is FolderKey => v === "uploads" || v === "results"
export default function DataRoomPage() {
  const t = useT()
  // `null` means "still reading" — distinct from an empty listing, so the page
  // never shows "nothing here yet" while the request is in flight.
  const [listing, setListing] = React.useState<DataRoomListing | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pickFor, setPickFor] = React.useState<DataRoomFile | null>(null)
  // `/data-room`, `/data-room/<folder>`, `/data-room/results/<tool>`.
  const routeParams = useParams<{ path?: string[] }>()
  const segments = React.useMemo(() => {
    const raw = routeParams?.path
    return Array.isArray(raw) ? raw : raw ? [raw] : []
  }, [routeParams])

  const load = React.useCallback(() => {
    setError(null)
    listDataRoom()
      .then(setListing)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  React.useEffect(load, [load])

  const raw = segments[0] ?? null
  const open: FolderKey | null = isFolderKey(raw) ? raw : null
  const rawTool = segments[1] ?? null

  const toolFolders = React.useMemo(() => listing?.results.folders ?? [], [listing])
  // An unknown tool segment falls back to the Results listing rather than an
  // empty screen, the same way an unknown folder falls back to the landing.
  const openTool =
    open === "results" && rawTool
      ? toolFolders.find(
          (f) => folderSlug(f.name) === folderSlug(rawTool) || f.name === rawTool,
        ) ?? null
      : null

  // Results holds no files of its own now, so its count is what its tool
  // folders hold (plus anything archived loose before they existed).
  const resultsCount = listing
    ? listing.results.files.length + toolFolders.reduce((n, f) => n + f.files.length, 0)
    : null

  const folders = React.useMemo(
    () =>
      [
        { key: "uploads" as const, icon: Inbox, title: t("dataRoom.uploads"), hint: t("dataRoom.uploadsHint"), count: listing?.uploads.files.length ?? null },
        { key: "results" as const, icon: Sparkles, title: t("dataRoom.results"), hint: t("dataRoom.resultsHint"), count: resultsCount },
      ],
    [listing, t, resultsCount],
  )
  const current = open ? folders.find((f) => f.key === open) ?? null : null
  const loading = listing === null && !error

  return (
    <AppShell>
      {/* The same band as home and Workflows. This page also used the narrower
          `--dt-w-page` measure, which on a large display centred it into a
          1280px column with ~520px of dead gutter each side while Workflows
          next door ran to 1760px — two sibling pages, two different layouts.
          Both are on `--dt-w-grid` now. */}
      <PageHeader
        title={openTool ? openTool.name : current ? current.title : t("dataRoom.title")}
        description={
          openTool
            ? t("dataRoom.toolFolderHint", { name: openTool.name })
            : current
              ? current.hint
              : t("dataRoom.subtitle")
        }
        breadcrumb={
          /* Only inside a folder, and only as the way back out.
 
             The landing page used to open with "Documents / Document Toolbox"
             above its own title — the room path and the app's own name, which
             the sidebar already shows and the <h1> already says. Three names
             for where you are, none of them the one you needed.
 
             The remaining crumb is labelled by its destination ("Data Room"),
             not by the app folder it happens to map to on the platform: the
             storage path is an implementation detail, while this is a link and
             a link should say where it goes. */
          current && (
            <nav aria-label={t("dataRoom.breadcrumb")} className="mb-2 min-w-0">
              <ol className="flex flex-wrap items-center gap-1 text-caption text-muted-foreground">
                <li className="flex items-center gap-1">
                  <FolderOpen className="size-3.5 shrink-0" aria-hidden />
                  <Link
                    href="/data-room"
                    className="-mx-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("dataRoom.title")}
                  </Link>
                </li>
                <li className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                  {openTool ? (
                    <Link
                      href={`/data-room/${current.key}`}
                      className="-mx-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {current.title}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-foreground">
                      {current.title}
                    </span>
                  )}
                </li>
                {openTool && (
                  <li className="flex items-center gap-1">
                    <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                    <span aria-current="page" className="text-foreground">
                      {openTool.name}
                    </span>
                  </li>
                )}
              </ol>
            </nav>
          )
        }
      />
      <div className="w-full min-w-0 max-w-grid space-y-section px-gutter py-section">
        {error && (
          <Alert
            tone="error"
            action={
              <Button variant="outline" size="sm" onClick={load}>
                {t("common.retry")}
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {/* Not an error: the Data Room is a platform service, so a local
            simulator legitimately has none. Say which runtime is missing it
            rather than showing an empty list that looks broken. */}
        {listing && !listing.available && <Alert tone="info">{listing.detail}</Alert>}

        {openTool ? (
          /* Inside one tool's folder. */
          <FileList files={openTool.files} loading={loading} onUse={setPickFor} />
        ) : current?.key === "results" ? (
          /* Results lists the tools that have produced something, not files.
             Anything archived loose before the grouping existed is listed
             underneath so it never becomes unreachable. */
          <>
            {toolFolders.length > 0 && (
              <ul className="grid gap-block grid-cols-[repeat(auto-fill,minmax(min(var(--dt-card-min),100%),1fr))]">
                {toolFolders.map((folder) => (
                  <li key={folder.id} className="min-w-0">
                    <FolderCard
                      href={`/data-room/results/${folderSlug(folder.name)}`}
                      icon={Sparkles}
                      title={folder.name}
                      hint={t("dataRoom.toolFolderHint", { name: folder.name })}
                      count={folder.files.length}
                      loading={loading}
                    />
                  </li>
                ))}
              </ul>
            )}
            {(toolFolders.length === 0 || listing!.results.files.length > 0) && (
              <FileList files={listing?.results.files ?? null} loading={loading} onUse={setPickFor} />
            )}
          </>
        ) : current ? (
          <FileList files={listing?.uploads.files ?? null} loading={loading} onUse={setPickFor} />
        ) : (
          <ul className="grid gap-block sm:grid-cols-2">
            {folders.map((folder) => (
              <li key={folder.key} className="min-w-0">
                <FolderCard
                  href={`/data-room/${folder.key}`}
                  icon={folder.icon}
                  title={folder.title}
                  hint={folder.hint}
                  count={folder.count}
                  loading={loading}
                />
              </li>
            ))}
          </ul>
        )}

        {listing !== null && (
          <p role="status" className="sr-only">
            {openTool
              ? t("dataRoom.folderAnnounce", { name: openTool.name, count: openTool.files.length })
              : current
                ? t("dataRoom.folderAnnounce", { name: current.title, count: current.count ?? 0 })
                : t("dataRoom.countAnnounce", {
                    count: (listing.uploads.files.length + (resultsCount ?? 0)),
                  })}
          </p>
        )}
      </div>

      <ToolPickerDialog file={pickFor} onClose={() => setPickFor(null)} />
    </AppShell>
  )
}

/** One of the two folders, as a card you open. */
function FolderCard({
  href,
  icon: Icon,
  title,
  hint,
  count,
  loading,
}: {
  href: string
  icon: typeof Inbox
  title: string
  hint: string
  count: number | null
  loading: boolean
}) {
  const t = useT()
  return (
    <Link
      href={href}
      draggable={false}
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-border bg-card p-surface",
        "shadow-[var(--dt-shadow-sm)]",
        "transition-[transform,border-color,box-shadow] duration-[var(--dt-dur-fast)] ease-[var(--dt-ease-out)]",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--dt-shadow-md)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-heading group-hover:text-primary">{title}</span>
        <span className="mt-0.5 block text-caption text-muted-foreground">
          {loading || count === null
            ? hint
            : count === 1
              ? t("dataRoom.oneFile")
              : t("dataRoom.nFiles", { count })}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dt-dur-instant)] group-hover:translate-x-0.5"
      />
    </Link>
  )
}

function FileList({
  files,
  loading,
  onUse,
}: {
  files: DataRoomFile[] | null
  loading: boolean
  onUse: (file: DataRoomFile) => void
}) {
  const t = useT()
  return (
    <div className="min-w-0">
      <div className="space-y-2">
        {loading ? (
          // Layout-preserving, using the shimmer globals.css already defined.
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} aria-hidden className="fc-skeleton h-14 rounded-md" />
          ))
        ) : !files || files.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-caption text-muted-foreground">
            {t("dataRoom.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.id}>
                {/* A sheet: this row is the user's document. */}
                <Sheet flush className="flex items-center gap-3 px-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-sheet-muted" aria-hidden />
                  <span
                    className="min-w-0 flex-1 truncate text-ui"
                    dir="ltr"
                    title={file.original_filename}
                  >
                    {file.original_filename}
                  </span>
                  <span className="shrink-0 text-caption text-sheet-muted">
                    {formatBytes(file.file_size)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onUse(file)}
                      className="text-sheet-muted hover:bg-black/5 hover:text-sheet-foreground"
                    >
                      {t("dataRoom.useWith")}
                    </Button>
                    {/* A real link, so the browser handles the download and the
                        file never passes through this app again. */}
                    <a
                      href={file.file_url}
                      target="_blank"
                      rel="noreferrer"
                      download={file.original_filename}
                      aria-label={t("dataRoom.downloadNamed", { name: file.original_filename })}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md text-sheet-muted",
                        "hover:bg-black/5 hover:text-sheet-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <Download className="size-4" aria-hidden />
                    </a>
                  </div>
                </Sheet>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
