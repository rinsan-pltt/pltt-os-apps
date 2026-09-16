"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { apiRequest } from "@/lib/api-helper"
import { useProjectContext } from "@/components/providers/project-context"
import { ImageDetailModal } from "@/app/explore/image-detail-modal"
import { FilterPill } from "@/app/explore/filter-pill"
import { ENGINE_PILLS, MARK_COLORS, type EngineFilter, type Favourite, type MarkFilter, type GridMode } from "@/app/explore/types"

interface Item {
  id: string
  url?: string
  status?: string
  prompt?: string
  model_name?: string
  key_frame_id?: string
  created_at?: string
  aspect_ratio?: string
  group?: string | null
}

interface KeyFrame {
  id: string
  key_frame_name: string
  key_frame_number: number
  items?: Item[]
}

interface Project {
  id: string
  name: string
  client?: string | null
  key_frames?: KeyFrame[]
}


function ImageCard({ item, onClick }: { item: Item; onClick: () => void }) {
  return (
    <div
      className="relative mb-2 break-inside-avoid bg-secondary/40 border border-border40 overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      <img
        src={item.url}
        alt={item.prompt || ""}
        className="w-full h-auto block"
      />
      {item.group && (
        <div
          className="absolute top-2 right-2 size-2.5 ring-2 ring-background/60"
          style={{ backgroundColor: item.group, borderRadius: "50%" }}
        />
      )}
    </div>
  )
}

function KeyFrameSection({
  keyFrame,
  columns,
  projectName,
  projectId,
  onOpenDetail,
}: {
  keyFrame: KeyFrame
  columns: GridMode
  projectName: string
  projectId: string
  onOpenDetail: (fav: Favourite) => void
}) {
  const completed = (keyFrame.items ?? []).filter((i) => i.status === "completed" && i.url)
  const colClass =
    columns === "random" ? "columns-2 md:columns-3 lg:columns-4"
      : columns === 1 ? "columns-1"
        : columns === 2 ? "columns-2"
          : columns === 3 ? "columns-3"
            : columns === 4 ? "columns-4"
              : "columns-5"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold uppercase tracking-wide">
          {keyFrame.key_frame_name}
        </span>
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          <span className="text-foreground font-semibold">{completed.length}</span> IMG
        </span>
      </div>

      {completed.length === 0 ? (
        <div className="border border-dashed border-border60 h-32 w-full" />
      ) : (
        <div className={cn(colClass, "gap-2")}>
          {completed.map((item) => (
            <ImageCard
              key={item.id}
              item={item}
              onClick={() =>
                onOpenDetail({
                  id: item.id,
                  url: item.url!,
                  prompt: item.prompt,
                  model_name: item.model_name,
                  project_name: projectName,
                  project_id: projectId,
                  key_frame_id: item.key_frame_id ?? keyFrame.id,
                  key_frame_name: keyFrame.key_frame_name,
                  aspect_ratio: item.aspect_ratio,
                  created_at: item.created_at,
                  group: item.group,
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectArchivePage({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<Project | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<Favourite | null>(null)

  const [engineFilter, setEngineFilter] = React.useState<EngineFilter>("all")
  const [markFilter, setMarkFilter] = React.useState<MarkFilter>("all")
  const [columns, setColumns] = React.useState<GridMode>("random")

  const { activeKeyFrameId } = useProjectContext()

  React.useEffect(() => {
    if (!activeKeyFrameId) return
    const el = document.getElementById(`kf-${activeKeyFrameId}`)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [activeKeyFrameId])

  React.useEffect(() => {
    apiRequest(`/projects/${projectId}`)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false))
  }, [projectId])

  const filteredKeyFrames = React.useMemo(() => {
    if (!project) return []
    return (project.key_frames ?? []).map((kf) => {
      const items = (kf.items ?? []).filter((item) => {
        if (engineFilter !== "all" && item.model_name !== engineFilter) return false
        if (markFilter === "none" && item.group) return false
        if (markFilter === "marked" && !item.group) return false
        if (markFilter !== "all" && markFilter !== "none" && markFilter !== "marked") {
          if ((item.group || "").toUpperCase() !== markFilter.toUpperCase()) return false
        }
        return true
      })
      return { ...kf, items }
    })
  }, [project, engineFilter, markFilter])

  const totals = React.useMemo(() => {
    const kfs = project?.key_frames ?? []
    const all = kfs.flatMap((kf) => kf.items ?? [])
    const completed = all.filter((i) => i.status === "completed" && i.url)
    return { keyFrames: kfs.length, completed: completed.length, total: all.length }
  }, [project])

  return (
    <div className="flex flex-col flex-1 overflow-auto p-8 gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-4xl font-bold uppercase tracking-wide">
          {project?.name || "Project"} · Keyframes
        </h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          <span className="text-foreground font-semibold">{totals.keyFrames}</span> Keyframes ·{" "}
          <span className="text-foreground font-semibold">{totals.completed}</span> /{" "}
          {totals.total} IMG
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* Filter bar — row 1: engines */}
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            {ENGINE_PILLS.map((p, i) => (
              <FilterPill
                key={p.value}
                active={engineFilter === p.value}
                onClick={() => setEngineFilter(p.value)}
                className={i > 0 ? "-ml-px" : ""}
              >
                {p.label}
              </FilterPill>
            ))}
          </div>
        </div>

        {/* Filter bar — row 2: marks + grid */}
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <FilterPill active={markFilter === "all"} onClick={() => setMarkFilter("all")}>
              All
            </FilterPill>
            <FilterPill active={markFilter === "none"} onClick={() => setMarkFilter("none")} className="-ml-px">
              No Marks
            </FilterPill>
            <FilterPill active={markFilter === "marked"} onClick={() => setMarkFilter("marked")} className="-ml-px">
              All Marks
            </FilterPill>
          </div>
          <div className="flex items-center">
            {MARK_COLORS.map((c, i) => (
              <Button
                key={c}
                variant="outline"
                size="xs"
                onClick={() => setMarkFilter(c)}
                aria-label={`Mark ${c}`}
                className={cn(i > 0 && "-ml-px")}
              >
                <span className="size-4 rounded-full" style={{ backgroundColor: c }} />
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center">
            <FilterPill active={columns === "random"} onClick={() => setColumns("random")}>
              Random
            </FilterPill>
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <FilterPill
                key={n}
                active={columns === n}
                onClick={() => setColumns(n)}
                className="-ml-px"
              >
                {String(n)}
              </FilterPill>
            ))}
          </div>
        </div>
      </div>

      <Separator orientation="horizontal" className="h-px w-full" />

      {loading && (
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Loading...</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Keyframe sections */}
      {filteredKeyFrames.map((kf, idx) => (
        <React.Fragment key={kf.id}>
          {idx > 0 && <Separator orientation="horizontal" className="h-px w-full" />}
          <div id={`kf-${kf.id}`}>
            <KeyFrameSection
              keyFrame={kf}
              columns={columns}
              projectName={project?.name ?? ""}
              projectId={projectId}
              onOpenDetail={setDetail}
            />
          </div>
        </React.Fragment>
      ))}

      {detail && (
        <ImageDetailModal
          fav={detail}
          onClose={() => setDetail(null)}
          onGroupChange={(id, group) =>
            setDetail((prev) => (prev && (prev.id === id || prev.content_id === id) ? { ...prev, group } : prev))
          }
          onDelete={(id) => {
            setProject((prev: Project | null) => {
              if (!prev) return prev
              return {
                ...prev,
                key_frames: (prev.key_frames ?? []).map((kf) => ({
                  ...kf,
                  items: (kf.items ?? []).filter((i) => i.id !== id),
                })),
              }
            })
          }}
          {...(() => {
            const navFavs: Favourite[] = filteredKeyFrames.flatMap((kf) =>
              (kf.items ?? [])
                .filter((item) => item.status === "completed" && item.url)
                .map((item) => ({
                  id: item.id,
                  url: item.url!,
                  prompt: item.prompt,
                  model_name: item.model_name,
                  project_name: project?.name ?? "",
                  project_id: projectId,
                  key_frame_id: item.key_frame_id ?? kf.id,
                  key_frame_name: kf.key_frame_name,
                  aspect_ratio: item.aspect_ratio,
                  created_at: item.created_at,
                  group: item.group,
                }))
            )
            const idx = navFavs.findIndex((f) => f.id === detail.id)
            return {
              onPrev: idx > 0 ? () => setDetail(navFavs[idx - 1]) : undefined,
              onNext: idx >= 0 && idx < navFavs.length - 1 ? () => setDetail(navFavs[idx + 1]) : undefined,
            }
          })()}
        />
      )}
    </div>
  )
}
