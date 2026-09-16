"use client"

import * as React from "react"
// next/image is not supported under the palette-app framework; use plain <img>.
import {
  IconPhoto,
  IconArchive,
  IconCompass,
  IconSparkle,
  IconLayout,
  IconChevronDown,
  IconLayoutBoard,
  IconPlus,
  IconArrowUp,
  IconX,
  IconGripVertical,
  IconFlower,
} from "@tabler/icons-react"
import { useRouter, usePathname } from "@palettelab/sdk/router"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NavMain } from "@/components/nav-main"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarGroup,
} from "@/components/ui/sidebar"
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
import { useProjectContext, type KeyFrame } from "@/components/providers/project-context"
import { apiRequest } from "@/lib/api-helper"
import { toast } from "@/components/ui/sonner"
import { useT } from "@/lib/i18n"

const BrandIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
    className={cn("size-5 text-primary shrink-0", className)}
  >
    <path d="M3 0H29L32 3V22L22 32H3L0 29V3L3 0Z" fill="currentColor" />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M25.581 8.89871L24.1314 7.42581C23.8629 7.1529 23.501 7 23.1219 7H10.021C9.64191 7 9.2781 7.1529 9.01143 7.42581L6.41905 10.06C6.15048 10.3329 6 10.7006 6 11.0858V25H8V9.90516C8 9.26452 8.51238 9 9.14286 9H23.4286C23.7448 9 24 9.25935 24 9.58065V17.6148C24 18.2555 23.4876 19 22.8571 19H10V21H21.979C22.3581 21 22.7219 20.8471 22.9886 20.5742L25.581 17.4581C25.8495 17.1852 26 16.8174 26 16.4323V9.92452C26 9.53935 25.8495 9.16968 25.581 8.89871Z"
      className="fill-background"
    />
  </svg>
)

function KeyFrameRow({
  keyFrame,
  projectId,
  isActive,
  isDragging,
  translateY,
  animate,
  onSelect,
  onRenamed,
  onDeleted,
  onRowPointerDown,
}: {
  keyFrame: KeyFrame
  projectId: string
  isActive: boolean
  isDragging: boolean
  translateY: number
  animate: boolean
  onSelect: () => void
  onRenamed: (updated: KeyFrame) => void
  onDeleted: (id: string) => void
  onRowPointerDown: (e: React.PointerEvent) => void
}) {
  const { t } = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(keyFrame.key_frame_name)
  const [deleting, setDeleting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = async () => {
    const name = draft.trim()
    setEditing(false)
    if (!name || name === keyFrame.key_frame_name) {
      setDraft(keyFrame.key_frame_name)
      return
    }
    try {
      const res = await apiRequest(`/projects/${projectId}/key-frames/${keyFrame.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      onRenamed({ ...keyFrame, ...res, key_frame_name: res.key_frame_name ?? name })
    } catch (err) {
      setDraft(keyFrame.key_frame_name)
      toast.error(t("errors.renameFailed"), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Deleting is destructive (the keyframe and all its generations go away),
  // so the X only opens a confirmation dialog — same contract as project
  // deletion.
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await apiRequest(`/projects/${projectId}/key-frames/${keyFrame.id}`, { method: "DELETE" })
      setConfirmOpen(false)
      onDeleted(keyFrame.id)
    } catch (err) {
      toast.error(t("errors.deleteKeyFrameFailed"), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      data-kf-id={keyFrame.id}
      onPointerDown={onRowPointerDown}
      style={{
        transform: `translateY(${translateY}px)`,
        transition: animate ? "transform 200ms cubic-bezier(0.2, 0, 0, 1)" : "none",
        zIndex: isDragging ? 50 : undefined,
        position: "relative",
        touchAction: "none",
      }}
      className={cn(
        "flex items-center px-2 py-1.5 ml-4 text-xs uppercase tracking-widest border-l-2 group select-none",
        !isDragging && "transition-colors",
        isActive
          ? "border-l-primary/50 bg-secondary font-semibold"
          : "border-l-transparent hover:border-l-border text-muted-foreground hover:text-foreground hover:bg-secondary",
        isDragging ? "bg-secondary shadow-lg cursor-grabbing" : "cursor-grab"
      )}
    >
      <IconGripVertical
        className={cn(
          "size-3 shrink-0 mr-1 text-muted-foreground transition-opacity pointer-events-none",
          isDragging ? "opacity-60" : "opacity-0 group-hover:opacity-40"
        )}
        strokeWidth={1.5}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") {
              setDraft(keyFrame.key_frame_name)
              setEditing(false)
            }
          }}
          className="bg-transparent outline-none w-full text-xs tracking-widest uppercase"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          className="flex-1 text-left truncate uppercase"
          title={t("sidebar.doubleClickRename")}
        >
          {keyFrame.key_frame_name}
        </button>
      )}
      <button
        type="button"
        data-no-drag
        onClick={(e) => {
          e.stopPropagation()
          setConfirmOpen(true)
        }}
        disabled={deleting}
        className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-destructive disabled:opacity-30"
        aria-label={t("sidebar.deleteKeyFrame")}
      >
        <IconX className="size-3" strokeWidth={1.5} />
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="uppercase tracking-widest text-sm">{t("sidebar.deleteKeyFrame")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.deleteKeyFrameConfirm", { name: keyFrame.key_frame_name })}
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
    </div>
  )
}

function CurrentProjectSection() {
  const { currentProject, setCurrentProject, activeKeyFrameId, setActiveKeyFrameId } =
    useProjectContext()
  const { t } = useT()
  const router = useRouter()
  const pathname = usePathname()
  const [expanded, setExpanded] = React.useState(true)
  const [creating, setCreating] = React.useState(false)
  const [editingName, setEditingName] = React.useState(false)
  const [nameDraft, setNameDraft] = React.useState("")
  const nameInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editingName) nameInputRef.current?.select()
  }, [editingName])
  const [drag, setDrag] = React.useState<{
    id: string
    fromIndex: number
    toIndex: number
    offsetY: number
    rowHeight: number
  } | null>(null)

  const keyFrames = currentProject?.key_frames ?? []
  const listRef = React.useRef<HTMLDivElement>(null)

  const dragRef = React.useRef({
    drag: null as typeof drag,
    keyFrames: [] as KeyFrame[],
    startClientY: 0,
    pending: null as { id: string; clientY: number; fromIndex: number; rowHeight: number } | null,
  })
  dragRef.current.drag = drag
  dragRef.current.keyFrames = keyFrames

  const handleRowPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return
    // Ignore drags initiated on interactive children (rename input, delete button)
    if ((e.target as HTMLElement).closest("input, [data-no-drag]")) return
    const rowEl = e.currentTarget as HTMLElement
    const rowHeight = rowEl.getBoundingClientRect().height
    const fromIndex = dragRef.current.keyFrames.findIndex((kf) => kf.id === id)
    if (fromIndex === -1) return
    dragRef.current.pending = { id, clientY: e.clientY, fromIndex, rowHeight }
  }

  React.useEffect(() => {
    const DRAG_THRESHOLD = 4

    const onMove = (e: PointerEvent) => {
      const pending = dragRef.current.pending
      const d = dragRef.current.drag
      if (pending && !d) {
        const dy = e.clientY - pending.clientY
        if (Math.abs(dy) < DRAG_THRESHOLD) return
        dragRef.current.startClientY = pending.clientY
        const total = dragRef.current.keyFrames.length
        const rawIndex = pending.fromIndex + Math.round(dy / pending.rowHeight)
        const toIndex = Math.max(0, Math.min(total - 1, rawIndex))
        setDrag({
          id: pending.id,
          fromIndex: pending.fromIndex,
          toIndex,
          offsetY: dy,
          rowHeight: pending.rowHeight,
        })
        return
      }
      if (!d) return
      const offsetY = e.clientY - dragRef.current.startClientY
      const total = dragRef.current.keyFrames.length
      const rawIndex = d.fromIndex + Math.round(offsetY / d.rowHeight)
      const toIndex = Math.max(0, Math.min(total - 1, rawIndex))
      setDrag({ ...d, offsetY, toIndex })
    }

    const onUp = () => {
      const d = dragRef.current.drag
      const kfs = dragRef.current.keyFrames
      const wasDragging = !!d
      dragRef.current.pending = null
      if (!d) return
      setDrag(null)
      // Swallow the click that follows a drag so selection doesn't fire
      if (wasDragging) {
        const suppress = (ev: MouseEvent) => {
          ev.preventDefault()
          ev.stopPropagation()
        }
        document.addEventListener("click", suppress, { capture: true, once: true })
      }
      if (d.fromIndex === d.toIndex) return

      const reordered = [...kfs]
      const [moved] = reordered.splice(d.fromIndex, 1)
      reordered.splice(d.toIndex, 0, moved)
      const newNumber = d.toIndex + 1

      const project = currentProject
      if (!project) return
      setCurrentProject({ ...project, key_frames: reordered })

      apiRequest(`/projects/${project.id}/key-frames/${d.id}/order`, {
        method: "PATCH",
        body: JSON.stringify({ new_key_frame_number: newNumber }),
      }).catch((err) => {
        setCurrentProject({ ...project, key_frames: kfs })
        toast.error(t("errors.reorderKeyFrameFailed"), {
          description: err instanceof Error ? err.message : String(err),
        })
      })
    }

    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
    return () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
    }
  }, [setCurrentProject, currentProject?.id])

  const getRowTranslate = (index: number, id: string): number => {
    if (!drag) return 0
    if (drag.id === id) return drag.offsetY
    const { fromIndex, toIndex, rowHeight } = drag
    if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -rowHeight
    if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return rowHeight
    return 0
  }

  // Only show when we're actually inside a project route (project page or its archive view)
  if (
    !currentProject ||
    !(
      pathname.startsWith(`/projects/${currentProject.id}`) ||
      pathname.startsWith(`/archive/${currentProject.id}`)
    )
  )
    return null
  const projectId = currentProject.id
  const thumbnail = keyFrames
    .flatMap((kf) => kf.items ?? [])
    .find((item) => item.status === "completed" && item.url)?.url ?? null

  const handleCreateKeyFrame = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await apiRequest(`/projects/${projectId}/key-frames`, {
        method: "POST",
      })
      const newKf: KeyFrame = {
        id: res.id,
        key_frame_name: res.key_frame_name,
        key_frame_number: res.key_frame_number,
        created_at: res.created_at,
        items: [],
      }
      setCurrentProject({
        ...currentProject,
        key_frames: [...keyFrames, newKf],
      })
      setActiveKeyFrameId(newKf.id)
    } catch (err) {
      toast.error(t("errors.createKeyFrameFailed"), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setCreating(false)
    }
  }

  const handleRenamed = (updated: KeyFrame) => {
    setCurrentProject({
      ...currentProject,
      key_frames: keyFrames.map((kf) => (kf.id === updated.id ? { ...kf, ...updated } : kf)),
    })
  }

  const startRenameProject = () => {
    setNameDraft(currentProject.name)
    setEditingName(true)
  }

  const commitRenameProject = async () => {
    const name = nameDraft.trim()
    setEditingName(false)
    if (!name || name === currentProject.name) return
    const previousName = currentProject.name
    // Optimistic update; revert on failure.
    setCurrentProject({ ...currentProject, name })
    try {
      const res = await apiRequest(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      setCurrentProject({ ...currentProject, name: res.name ?? name })
    } catch (err) {
      setCurrentProject({ ...currentProject, name: previousName })
      toast.error("Rename failed", {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleDeleted = (id: string) => {
    const remaining = keyFrames.filter((kf) => kf.id !== id)
    setCurrentProject({ ...currentProject, key_frames: remaining })
    if (activeKeyFrameId === id) {
      setActiveKeyFrameId(remaining[0]?.id ?? null)
    }
  }

  return (
    <SidebarGroup className="p-0 py-3 border-b border-border group-data-[collapsible=icon]:hidden">
      {/* Header */}
      <div className="px-2 pb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-muted-foreground/60">{t("sidebar.currentProject")}</span>
        <Button
          variant="ghost"
          size="iconSm"
          className="size-5 border border-border60"
          onClick={() => router.push("/")}
          aria-label={t("sidebar.backToProjects")}
        >
          <IconArrowUp className="size-3" strokeWidth={1.5} />
        </Button>
      </div>

      {/* Project row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v)
        }}
        className="flex items-center gap-2 px-2 py-1.5 w-full text-left bg-secondary border-l-2 border-l-primary/50 hover:bg-secondary/50 transition-colors cursor-pointer"
      >
        <IconChevronDown
          className={cn("size-3 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")}
          strokeWidth={1.5}
        />
        <div className="size-7 bg-secondary border border-border shrink-0 overflow-hidden flex items-center justify-center">
          {thumbnail ? (
            <img src={thumbnail} alt="" className="size-full object-cover" />
          ) : (
            <IconFlower className="size-4 text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1 leading-tight">
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRenameProject}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") commitRenameProject()
                if (e.key === "Escape") setEditingName(false)
              }}
              className="bg-transparent outline-none w-full text-xs font-bold uppercase tracking-wide"
            />
          ) : (
            <span
              className="text-xs font-bold uppercase truncate tracking-wide"
              onDoubleClick={(e) => {
                e.stopPropagation()
                startRenameProject()
              }}
              title="Double-click to rename"
            >
              {currentProject.name}
            </span>
          )}
          {currentProject.client && (
            <span className="text-[11px] text-muted-foreground uppercase truncate tracking-wide">
              {currentProject.client}
            </span>
          )}
        </div>
      </div>

      {/* Keyframes list */}
      {expanded && (
        <div ref={listRef} className="flex flex-col mt-1">
          {keyFrames.map((kf, index) => (
            <KeyFrameRow
              key={kf.id}
              keyFrame={kf}
              projectId={projectId}
              isActive={activeKeyFrameId === kf.id}
              isDragging={drag?.id === kf.id}
              translateY={getRowTranslate(index, kf.id)}
              animate={!!drag && drag.id !== kf.id}
              onSelect={() => setActiveKeyFrameId(kf.id)}
              onRenamed={handleRenamed}
              onDeleted={handleDeleted}
              onRowPointerDown={(e) => handleRowPointerDown(kf.id, e)}
            />
          ))}

          {/* New keyframe */}
          <button
            onClick={handleCreateKeyFrame}
            disabled={creating}
            className="flex items-center gap-2 px-2 py-1.5 ml-7 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground border-l-2 border-l-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="border border-border60 size-4 flex items-center justify-center shrink-0">
              <IconPlus className="size-3" strokeWidth={1.5} />
            </span>
            {creating ? t("common.creating") : t("sidebar.newKeyframe")}
          </button>
        </div>
      )}
    </SidebarGroup>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useT()

  const navItems = [
    {
      title: t("nav.create"),
      icon: IconSparkle,
      isActive: pathname === "/" || pathname.startsWith("/projects/"),
      onClick: () => router.push("/"),
    },
    {
      title: t("nav.archive"),
      icon: IconLayoutBoard,
      isActive: pathname.startsWith("/archive"),
      onClick: () => router.push("/archive"),
    },
    {
      title: t("nav.explore"),
      icon: IconCompass,
      isActive: pathname === "/explore",
      onClick: () => router.push("/explore"),
    },
  ]

  return (
    <Sidebar collapsible="icon" className="font-mono" {...props}>
      <SidebarHeader className="bg-secondary/50">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="uppercase text-sm h-[31px]" tooltip={t("nav.brand")}>
              <a href="/">
                <BrandIcon />
                <span>{t("nav.imageCreative")}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="bg-secondary/50" >
        <NavMain items={navItems} />
        <CurrentProjectSection />
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
