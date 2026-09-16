"use client"

import * as React from "react"
import { useRouter } from "@palettelab/sdk/router"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { apiRequest } from "@/lib/api-helper"
import { ImageDetailModal } from "@/app/explore/image-detail-modal"
import { HoverVideo } from "@/components/ui/hover-video"
import type { Favourite } from "@/app/explore/types"
import { useT, useTimeAgo } from "@/lib/i18n"

interface Item {
  id: string
  type?: string
  url?: string
  // First-frame still of a completed video, extracted server-side — shown as
  // the <video poster> so a preview never flashes black while the clip loads.
  thumbnail_url?: string | null
  status?: string
  prompt?: string
  model_name?: string
  key_frame_id?: string
  key_frame_name?: string
  project_name?: string
  project_id?: string
  aspect_ratio?: string
  created_at?: string
  updated_at?: string
  group?: string | null
}

interface KeyFrame {
  id: string
  key_frame_name: string
  items?: Item[]
}

interface Project {
  id: string
  name: string
  client?: string | null
  type: "video"
  key_frames?: KeyFrame[]
  created_at: string
  updated_at: string
}

function flattenCompleted(project: Project): Item[] {
  const out: Item[] = []
  for (const kf of project.key_frames ?? []) {
    for (const item of kf.items ?? []) {
      // Only videos are listed here — image generation is gone.
      if (item.status === "completed" && item.url && (item.type ?? "video") === "video")
        out.push({ ...item, key_frame_name: kf.key_frame_name, project_name: project.name, project_id: project.id })
    }
  }
  return out
}

function itemToFavourite(item: Item): Favourite {
  return {
    id: item.id,
    type: "video",
    url: item.url!,
    thumbnail_url: item.thumbnail_url,
    prompt: item.prompt,
    model_name: item.model_name,
    project_name: item.project_name,
    project_id: item.project_id,
    key_frame_id: item.key_frame_id,
    key_frame_name: item.key_frame_name,
    aspect_ratio: item.aspect_ratio,
    created_at: item.created_at,
    updated_at: item.updated_at,
    group: item.group,
  }
}

function ProjectArchiveSection({
  project,
  onOpenDetail,
}: {
  project: Project
  onOpenDetail: (fav: Favourite) => void
}) {
  const router = useRouter()
  const { t } = useT()
  const timeAgo = useTimeAgo()
  const completed = flattenCompleted(project)
  const preview = completed.slice(0, 4)
  const videoCount = completed.length

  return (
    <div className="flex flex-col gap-3">
      {/* Section header */}
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-bold uppercase tracking-wide">{project.name}</span>
          {project.client && (
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {project.client}
            </span>
          )}
          <span className="text-xs text-muted-foreground uppercase tracking-widest">
            <span className="text-foreground font-semibold">{videoCount}</span> VID ·{" "}
            {t("archive.updatedAt", { when: timeAgo(project.updated_at || project.created_at) })}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className=" text-xs tracking-widest shrink-0"
          onClick={() => router.push(`/archive/${project.id}`)}
        >
          {t("archive.open")}
        </Button>
      </div>

      {/* Image strip — first 4 completed images at natural aspect ratio */}
      {preview.length === 0 ? (
        <div className="border border-dashed border-border60 h-32 w-full flex items-center justify-center">
          <span className="text-xs uppercase tracking-widest text-muted-foreground/60">
            {t("archive.noImages")}
          </span>
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {preview.map((item) => (
            <div
              key={item.id}
              className="relative shrink-0 h-48 bg-secondary/40 border border-border40 overflow-hidden cursor-pointer"
              onClick={() => onOpenDetail(itemToFavourite(item))}
            >
              <HoverVideo
                src={item.url!}
                type="video"
                poster={item.thumbnail_url}
                className="h-48 w-auto"
              />
              {item.group && (
                <div
                  className="absolute top-2 right-2 size-2.5 ring-2 ring-background/60"
                  style={{ backgroundColor: item.group, borderRadius: "50%" }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const PAGE_SIZE = 10

export function ArchivePage() {
  const { t } = useT()
  const [projects, setProjects] = React.useState<Project[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [hasMore, setHasMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<Favourite | null>(null)
  const sentinelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiRequest(`/projects?page=1&page_size=${PAGE_SIZE}`)
      .then((res) => {
        if (cancelled) return
        const list: Project[] = Array.isArray(res) ? res : res?.projects ?? []
        setProjects(list)
        setPage(1)
        setHasMore(1 < (res?.total_pages ?? 1))
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const loadMore = React.useCallback(async () => {
    if (!hasMore || loadingMore || loading) return
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const res = await apiRequest(`/projects?page=${nextPage}&page_size=${PAGE_SIZE}`)
      const list: Project[] = Array.isArray(res) ? res : res?.projects ?? []
      setProjects((prev) => [...prev, ...list])
      setPage(nextPage)
      setHasMore(nextPage < (res?.total_pages ?? 1))
    } catch (e) {
      console.error("Failed to load more projects:", e)
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, loading, page])

  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const handleGroupChange = (id: string, group: string | null) => {
    setDetail((prev) => (prev && (prev.id === id || prev.content_id === id) ? { ...prev, group } : prev))
    setProjects((prev) =>
      prev.map((p) => ({
        ...p,
        key_frames: (p.key_frames ?? []).map((kf) => ({
          ...kf,
          items: (kf.items ?? []).map((i) => (i.id === id ? { ...i, group } : i)),
        })),
      }))
    )
  }

  const handleDelete = (id: string) => {
    setProjects((prev) =>
      prev.map((p) => ({
        ...p,
        key_frames: (p.key_frames ?? []).map((kf) => ({
          ...kf,
          items: (kf.items ?? []).filter((i) => i.id !== id),
        })),
      }))
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto p-8 gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-4xl font-bold uppercase tracking-wide">{t("archive.title")}</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("archive.subtitle")}
        </p>
      </div>
      <Separator orientation="horizontal" className="h-px w-full" />

      {loading && (
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("archive.loading")}</p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && !error && projects.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("archive.noProjects")}
          </p>
          <p className="text-xs text-muted-foreground/60">
            {t("archive.noProjectsHint")}
          </p>
        </div>
      )}

      {projects.map((p) => (
        <ProjectArchiveSection key={p.id} project={p} onOpenDetail={setDetail} />
      ))}

      <div ref={sentinelRef} className="h-10 flex items-center justify-center">
        {loadingMore && (
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("common.loading")}</p>
        )}
      </div>

      {detail && (
        <ImageDetailModal
          fav={detail}
          onClose={() => setDetail(null)}
          onGroupChange={handleGroupChange}
          onDelete={handleDelete}
          {...(() => {
            const navFavs = projects.flatMap((p) => flattenCompleted(p).map(itemToFavourite))
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
