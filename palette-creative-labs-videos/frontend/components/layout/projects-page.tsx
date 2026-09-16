"use client"

import * as React from "react"
import { useRouter } from "@palettelab/sdk/router"
import { IconDots, IconPlus, IconX, IconTrash } from "@tabler/icons-react"
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/sonner"
import { apiRequest } from "@/lib/api-helper"
import { useProjectContext, type ProjectInfo } from "@/components/providers/project-context"
import { HoverVideo } from "@/components/ui/hover-video"
import { useContentWidth } from "@/components/layout/content-width-context"
import { useT, useTimeAgo } from "@/lib/i18n"

// Derive the project-grid column count from the AppShell content width (the app
// window's content area). Targets a comfortable card width and fills the row,
// so the grid reflows with the window rather than the browser viewport.
const GRID_PADDING = 48 // projects page p-6 (left + right)
const GRID_GAP = 12 // gap-3
const MIN_CARD = 240
const MAX_COLS = 6

function columnsForContentWidth(width: number | null): number | null {
  if (width == null) return null
  const avail = width - GRID_PADDING
  const cols = Math.floor((avail + GRID_GAP) / (MIN_CARD + GRID_GAP))
  return Math.max(1, Math.min(MAX_COLS, cols))
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5 p-4 [&:not(:first-child)]:border-l border-border">
      <span className="text-xs uppercase text-muted-foreground tracking-widest">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-muted-foreground uppercase tracking-widest">{sub}</span>}
    </div>
  )
}

function getProjectThumbnail(project: ProjectInfo): { url: string; thumbnail_url?: string | null } | null {
  for (const kf of project.key_frames ?? []) {
    for (const item of kf.items ?? []) {
      if (item.status === "completed" && item.url) return { url: item.url, thumbnail_url: item.thumbnail_url }
    }
  }
  return null
}

function countCompletedImages(project: ProjectInfo): number {
  let count = 0
  for (const kf of project.key_frames ?? []) {
    for (const item of kf.items ?? []) {
      if (item.status === "completed" && item.url) count++
    }
  }
  return count
}

// "Marked" mirrors the Explore/Archive definition: an item with a color group set.
function countMarkedItems(project: ProjectInfo): number {
  let count = 0
  for (const kf of project.key_frames ?? []) {
    for (const item of kf.items ?? []) {
      if (item.group) count++
    }
  }
  return count
}

// "Recent missions" — completed generations, not just new projects; most
// activity happens inside a project created long ago, so counting project
// creation alone stays at 0 almost all the time.
function countRecentItems(project: ProjectInfo, sinceMs: number): number {
  let count = 0
  for (const kf of project.key_frames ?? []) {
    for (const item of kf.items ?? []) {
      if (
        item.status === "completed" &&
        item.url &&
        item.created_at &&
        new Date(item.created_at).getTime() >= sinceMs
      ) {
        count++
      }
    }
  }
  return count
}

function ProjectCard({
  project,
  onDeleted,
  onRenamed,
}: {
  project: ProjectInfo
  onDeleted: (id: string) => void
  onRenamed: (updated: ProjectInfo) => void
}) {
  const router = useRouter()
  const { setCurrentProject, clearChatTarget } = useProjectContext()
  const { t } = useT()
  const timeAgo = useTimeAgo()
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(project.name)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const thumb = getProjectThumbnail(project)
  const imgCount = countCompletedImages(project)
  const when = timeAgo(project.updated_at || project.created_at)

  React.useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const handleOpen = () => {
    // Drop any edit anchor from a previous session so the project opens on the
    // PROMPT tab with a clean URL (no `?edit=`), even when reopening the same
    // project that was last edited.
    clearChatTarget()
    setCurrentProject(project)
    router.push(`/projects/${project.id}`)
  }

  const commitRename = async () => {
    const name = draft.trim()
    setEditing(false)
    if (!name || name === project.name) {
      setDraft(project.name)
      return
    }
    try {
      const res = await apiRequest(`/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      onRenamed({ ...project, ...res, name: res.name ?? name })
    } catch (err) {
      setDraft(project.name)
      toast.error("Rename failed", {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await apiRequest(`/projects/${project.id}`, { method: "DELETE" })
      onDeleted(project.id)
      toast.success(t("projects.deletedToast"))
    } catch (err) {
      toast.error(t("projects.deleteFailed"), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  return (
    <>
      <div className="group flex flex-col border border-border60 overflow-hidden text-left hover:border-border transition-colors">
        {/* Thumbnail or fallback */}
        <div className="aspect-8/5 relative overflow-hidden cursor-pointer" onClick={handleOpen}>
          {thumb ? (
            <HoverVideo src={thumb.url} poster={thumb.thumbnail_url} className="size-full object-cover" />
          ) : (
            <div
              className="relative size-full flex items-center justify-center bg-secondary/30"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, transparent 0, transparent 10px, rgba(255,255,255,0.04) 10px, rgba(255,255,255,0.04) 11px)",
              }}
            >
              <span className="relative z-10 text-xs uppercase tracking-widest text-muted-foreground/60 text-center px-4">
                {t("projects.noImagery")}
              </span>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-0.5 px-3 py-3 bg-secondary/50 border-t border-border40">
          <div className="flex justify-between items-center">
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename()
                  if (e.key === "Escape") {
                    setDraft(project.name)
                    setEditing(false)
                  }
                }}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm font-bold uppercase tracking-wide"
              />
            ) : (
              <span
                className="text-sm font-bold uppercase truncate tracking-wide cursor-pointer"
                onClick={handleOpen}
                onDoubleClick={() => setEditing(true)}
                title="Double-click to rename"
              >
                {project.name}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="iconSm" className="h-4 shrink-0">
                  <IconDots />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive focus:bg-destructive/10 gap-2"
                  onClick={() => setDeleteOpen(true)}
                >
                  <IconTrash className="size-3.5" strokeWidth={1.5} />
                  {t("projects.deleteProject")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-baseline justify-between gap-3 cursor-pointer" onClick={handleOpen}>
            <span className="text-xs text-muted-foreground uppercase truncate tracking-widest">
              {project.client || "—"}
            </span>
            <span className="text-xs uppercase tracking-widest text-muted-foreground shrink-0">
              <span className="text-foreground font-semibold">{imgCount}</span> IMG · {when}
            </span>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="uppercase tracking-widest text-sm">{t("projects.deleteProject")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("projects.deleteConfirm", { name: project.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function NewProjectCard({ onClick }: { onClick: () => void }) {
  const { t } = useT()
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer flex-col items-center justify-center border border-dashed border-border hover:border-border h-full min-h-[160px] transition-colors gap-2 text-muted-foreground hover:text-foreground"
    >
      <div className="border border-border p-1.5">
        <IconPlus className="size-5" strokeWidth={1.5} />
      </div>
      <span className="text-xs uppercase tracking-widest">{t("projects.newProject")}</span>
    </button>
  )
}

function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (project: ProjectInfo) => void
}) {
  const { t } = useT()
  const [name, setName] = React.useState("")
  const [client, setClient] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiRequest("/projects", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), type: "video", client: client.trim() || undefined }),
      })
      onCreated({
        id: res.id,
        name: res.name || name.trim(),
        client: res.client || client.trim() || undefined,
        type: "video",
        key_frames: res.key_frames || [],
        created_at: res.created_at || new Date().toISOString(),
        updated_at: res.updated_at || res.created_at,
      })
      setName("")
      setClient("")
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.createProjectFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 sm:max-w-xl overflow-hidden border border-border bg-muted"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <DialogTitle className="uppercase text-xs tracking-widest font-semibold">{t("projects.newProject")}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="iconSm" className="border border-border">
              <IconX className="size-3" strokeWidth={1.5} />
              <span className="sr-only">{t("common.close")}</span>
            </Button>
          </DialogClose>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-5 px-5 py-5">
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">{t("projects.projectName")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("projects.namePlaceholder")}
                className=" placeholder:normal-case border-border"
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">{t("projects.client")}</Label>
              <Input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder={t("common.optional")}
                className=" border-border"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {/* Footer — full-width split buttons */}
          <div className="flex border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="flex-1 uppercase text-xs tracking-widest h-12 border-r border-border"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || loading}
              className="flex-1 uppercase text-xs tracking-widest h-12"
            >
              {loading ? t("common.creating") : t("projects.createProject")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectsPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const { projects, setProjects, addProject, setCurrentProject, setActiveKeyFrameId, clearChatTarget } = useProjectContext()
  const { t } = useT()
  const router = useRouter()
  const contentWidth = useContentWidth()
  const gridCols = columnsForContentWidth(contentWidth)

  React.useEffect(() => {
    apiRequest("/projects")
      .then((res) => setProjects(res.projects ?? []))
      .catch(() => { })
  }, [setProjects])

  const handleCreated = (project: ProjectInfo) => {
    clearChatTarget()
    addProject(project)
    setCurrentProject(project)
    setActiveKeyFrameId(project.key_frames?.[0]?.id ?? null)
    router.push(`/projects/${project.id}`)
  }

  const activeCount = projects.length
  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000
  const thisWeekCount = projects.reduce((sum, p) => sum + countRecentItems(p, weekAgoMs), 0)
  const archivedCount = projects.reduce((sum, p) => sum + countMarkedItems(p), 0)

  return (
    <div className="flex flex-col flex-1 overflow-auto p-6 gap-6">
      {/* Stats header — min 600px wide; scrolls horizontally when the window is
          narrower than that. */}
      <div className="shrink-0 overflow-x-auto">
        <div className="flex w-full border border-border" style={{ minWidth: 600 }}>
          <StatCard label={t("projects.activeProjects")} value={activeCount} sub={t("projects.foldersUnderManagement")} />
          <StatCard label={t("projects.enginesOnline")} value="3 / 3" sub={t("projects.engines")} />
          <StatCard label={t("projects.archived")} value={archivedCount} sub={t("projects.markedCompositions")} />
          <StatCard label={t("projects.thisWeek")} value={thisWeekCount} sub={t("projects.recentMissions")} />
        </div>
      </div>

      {/* Section sub-header */}
      <div className="flex items-baseline justify-between mt-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("projects.heading")}</span>
        <span className="text-xs uppercase tracking-widest text-muted-foreground/60">
          {t("projects.selectToOpen")}
        </span>
      </div>

      {/* Projects grid — column count tracks the AppShell content width (the app
          window), not the viewport. Tailwind classes are the pre-measurement
          fallback; the inline style wins once the width is known. */}
      <div className="flex-1">
        <div
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
          style={gridCols ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } : undefined}
        >
          <NewProjectCard onClick={() => setDialogOpen(true)} />
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onDeleted={(id) => setProjects((prev) => prev.filter((x) => x.id !== id))}
              onRenamed={(updated) =>
                setProjects((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
              }
            />
          ))}
        </div>
      </div>
      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </div>
  )
}
