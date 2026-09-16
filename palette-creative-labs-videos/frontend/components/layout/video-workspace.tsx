"use client"

import React, { type CSSProperties } from "react"
import { IconAlertTriangle, IconVideo, IconLoader2, IconPlayerPlayFilled, IconSparkles, IconVolume, IconVolumeOff } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useGenerationEvents, type GenerationItem } from "@/hooks/useGenerationEvents"
import { useProjectContext } from "@/components/providers/project-context"
import { useSharedGenerationEvents } from "@/components/providers/generation-events-context"
import { usePromptComposer, remixSettingsFromItem } from "@/components/providers/prompt-composer-context"
import { ImageDetailModal } from "@/app/explore/image-detail-modal"
import type { Favourite } from "@/app/explore/types"
import { CopyPromptButton } from "@/components/ui/copy-prompt-button"
import { videoModelOptions } from "./video-helper"
import { apiRequest } from "@/lib/api-helper"
import { Button } from "@/components/ui/button"
import { useT, useTimeAgo } from "@/lib/i18n"

interface ModelMeta {
  label: string
  color: string
}

function getModelMeta(modelName?: string): ModelMeta {
  if (!modelName) return { label: "Auto", color: "#94a3b8" }
  const match = videoModelOptions.find((m) => m.value === modelName)
  if (match) {
    const full = [match.label, match.version].filter(Boolean).join(" ")
    return { label: full, color: match.color ?? "#94a3b8" }
  }
  return { label: modelName, color: "#94a3b8" }
}

interface Batch {
  id: string
  model_name?: string
  prompt?: string
  key_frame_id?: string
  aspect_ratio?: string
  resolution?: string
  duration?: string
  created_at?: string
  items: GenerationItem[]
}

// One scrollable section of the workspace. In the key-frame view this is one
// per scene (title set) plus one for legacy sceneless items (title null); in
// the scene view it's a single untitled section — the sidebar selection
// already makes which scene is showing obvious.
interface WorkspaceSection {
  key: string
  title: string | null
  count: number
  batches: Batch[]
}

/** Groups items that share generation_id + model_name. */
function groupIntoBatches(items: GenerationItem[]): Batch[] {
  const sorted = [...items].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return ta - tb
  })

  const map = new Map<string, Batch>()
  for (const item of sorted) {
    const key = `${item.generation_id ?? item.id}|${item.model_name ?? ""}`
    const existing = map.get(key)
    if (existing) {
      existing.items.push(item)
      if (
        item.created_at &&
        (!existing.created_at ||
          new Date(item.created_at).getTime() > new Date(existing.created_at).getTime())
      ) {
        existing.created_at = item.created_at
      }
    } else {
      map.set(key, {
        id: key,
        model_name: item.model_name,
        prompt: item.prompt,
        key_frame_id: item.key_frame_id,
        aspect_ratio: item.aspect_ratio,
        resolution: item.resolution,
        duration: item.duration,
        created_at: item.created_at,
        items: [item],
      })
    }
  }

  // Newest batch first
  return Array.from(map.values()).sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })
}

// The backend stores durations as bare seconds ("5"); render them as "5s".
function formatDuration(d?: string): string | undefined {
  if (!d) return d
  const trimmed = d.trim()
  return /s$/i.test(trimmed) ? trimmed : `${trimmed}s`
}

function aspectStyle(ratio?: string): CSSProperties {
  if (!ratio) return { aspectRatio: "16 / 9" }
  const [w, h] = ratio.split(":")
  if (!w || !h) return { aspectRatio: "16 / 9" }
  return { aspectRatio: `${w} / ${h}` }
}

function gridColsFor(ratio?: string): string {
  if (!ratio) return "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3"
  const [w, h] = ratio.split(":").map((n) => parseFloat(n))
  if (!w || !h) return "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3"
  const aspect = w / h
  // Landscape (16:9, 4:3, 21:9, etc.) → 1 col below xl, 2 from xl, 3 from 2xl
  if (aspect > 1.2) return "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3"
  // Square or portrait → 1 col below lg, 2 from lg, 3 from xl, 4 from 2xl
  return "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
}

// Column count from the MEASURED workspace width (the app window's content area,
// not the viewport). Needed in the published OS, where the window is narrower
// than the viewport and viewport breakpoints (xl/2xl) never fire. Landscape
// videos get a wider target card so fewer fit per row.
const VIDEO_GRID_GAP = 12 // gap-3
function columnsForWidth(ratio: string | undefined, width: number | null): number | null {
  if (width == null) return null
  let target = 240 // square / portrait
  if (ratio) {
    const [w, h] = ratio.split(":").map((n) => parseFloat(n))
    if (w && h && w / h > 1.2) target = 360 // landscape → wider cards
  }
  const cols = Math.floor((width + VIDEO_GRID_GAP) / (target + VIDEO_GRID_GAP))
  return Math.max(1, Math.min(4, cols))
}

type FailureKind = "moderation" | "nsfw" | "error"

// Classify a failure ONLY from the stored error text. Content-moderation and
// NSFW rejections are shown as-is with no retry; everything else is treated as
// a transient error. Only ever called for items that actually failed.
function classifyFailure(error?: string | null): FailureKind {
  const e = (error || "").toLowerCase()
  if (/\bnsfw\b|explicit|sexual|pornograph|adult content/.test(e)) return "nsfw"
  if (/moderation|safety|content[ _-]?policy|flagged|prohibited|sensitive|blocked|violat|not allowed|disallowed|banned/.test(e)) {
    return "moderation"
  }
  return "error"
}

function cleanProviderMessage(text: string): string {
  let t = text.trim()
  t = t.replace(/^.*?\bAdditional information:\s*/i, "")
  t = t.replace(/contact us at\s+\S+\s+and include the request ID\s+\S+/i, "please contact us")
  t = t.replace(/\s*(?:and include the )?request ID\s+\S+/i, "")
  return t.trim()
}

function extractFailureMessage(error?: string | null): string {
  const raw = (error || "").trim()
  if (!raw) return ""
  const matches = [...raw.matchAll(/["'](?:msg|message)["']\s*:\s*(["'])((?:\\.|(?!\1).)*)\1/g)]
  const text = matches.length
    ? matches
        .map((m) => m[2].replace(/\\(['"\\])/g, "$1").replace(/\\n/g, " ").trim())
        .filter(Boolean)
        .join("; ")
    : raw
  return cleanProviderMessage(text)
}

// Failed state shared by image and video cards. Content-moderation/NSFW
// rejections show the provider message with no retry; transient errors offer
// the caller-supplied retry.
function FailedCard({
  item,
  aspect,
  onRetry,
}: {
  item: GenerationItem
  aspect: CSSProperties
  onRetry?: () => void
}) {
  const { t } = useT()
  const reason = item.error ?? item.error_message
  const kind = classifyFailure(reason)
  const isBlocked = kind === "moderation" || kind === "nsfw"
  const label =
    kind === "nsfw"
      ? t("generation.failedNsfw")
      : kind === "moderation"
        ? t("generation.failedModeration")
        : t("generation.failedToGenerate")
  return (
    <div
      className="bg-secondary/40 border border-border40 flex flex-col items-center justify-center gap-2 p-3 text-center overflow-y-auto"
      style={aspect}
    >
      <IconAlertTriangle
        className={cn("size-6 shrink-0", isBlocked ? "text-muted-foreground" : "text-destructive")}
        strokeWidth={1.5}
      />
      <span className="text-xs text-destructive/80 uppercase tracking-widest">{label}</span>
      {isBlocked && reason && (
        <span
          className="text-[10px] text-muted-foreground/70 px-1"
          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          {extractFailureMessage(reason)}
        </span>
      )}
      {!isBlocked && onRetry && (
        <Button
          variant="default"
          size="xs"
          onClick={(e) => {
            e.stopPropagation()
            onRetry()
          }}
        >
          {t("generation.retry")}
        </Button>
      )}
    </div>
  )
}

// Started / in-progress skeleton shared by image and video cards.
function PendingCard({ item, aspect }: { item: GenerationItem; aspect: CSSProperties }) {
  const { t } = useT()
  const isPending = item.status === "started" || item.status === "in_progress"
  const lastLog = item.logs?.[item.logs.length - 1]
  return (
    <div
      className="relative bg-secondary/30 border border-border40 overflow-hidden flex flex-col items-center justify-center gap-3 text-muted-foreground"
      style={{
        ...aspect,
        backgroundImage:
          "repeating-linear-gradient(45deg, transparent 0, transparent 10px, rgba(255,255,255,0.04) 10px, rgba(255,255,255,0.04) 11px)",
      }}
    >
      <span className="text-xs uppercase tracking-widest font-semibold">
        {isPending && item.position != null ? t("generation.queue", { n: item.position }) : t("generation.generating")}
      </span>
      <div className="w-2/3 h-0.5 bg-muted-foreground/20 overflow-hidden">
        <div className="h-full bg-foreground animate-bar-loader" />
      </div>
      {lastLog && (
        <span className="absolute bottom-2 inset-x-2 text-[10px] text-muted-foreground/70 line-clamp-1 text-center font-mono">
          {lastLog}
        </span>
      )}
    </div>
  )
}

function VideoCard({
  item,
  ratio,
  onOpenDetail,
}: {
  item: GenerationItem
  ratio?: string
  onOpenDetail?: () => void
}) {
  const { t } = useT()
  const aspect = aspectStyle(ratio ?? item.aspect_ratio)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [hovered, setHovered] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const composer = usePromptComposer()

  // Hover audio toggle. `hasAudio` is best-effort detection from the decoded
  // media (null = unknown → treat as having audio); a track-less video shows
  // the volume control disabled.
  const [muted, setMuted] = React.useState(true)
  const [hasAudio, setHasAudio] = React.useState<boolean | null>(null)
  const audioAvailable = hasAudio !== false

  const updateHasAudio = React.useCallback(() => {
    const v = videoRef.current as (HTMLVideoElement & {
      mozHasAudio?: boolean
      webkitAudioDecodedByteCount?: number
      audioTracks?: { length: number }
    }) | null
    if (!v) return
    let detected: boolean | null = null
    if (typeof v.mozHasAudio === "boolean") detected = v.mozHasAudio
    else if (v.audioTracks && typeof v.audioTracks.length === "number") detected = v.audioTracks.length > 0
    else if (typeof v.webkitAudioDecodedByteCount === "number") detected = v.webkitAudioDecodedByteCount > 0
    if (detected !== null) setHasAudio(detected)
  }, [])

  // React doesn't reliably re-apply the `muted` attribute on re-render — set
  // the DOM property directly.
  React.useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  // Re-run the SAME failed record in place. Mirrors the image retry contract;
  // the backend resets this item to "in_progress" and the card transitions
  // back via SSE.
  const handleRetry = async () => {
    try {
      await apiRequest("/generate/video/retry", {
        method: "POST",
        body: JSON.stringify({ doc_id: item.id }),
      })
    } catch (e) {
      console.error("Video retry failed:", e)
    }
  }

  if (item.status === "completed" && item.url) {
    return (
      <div
        className="group relative bg-secondary/40 border border-border40 overflow-hidden cursor-pointer"
        style={aspect}
        onClick={onOpenDetail}
        onMouseEnter={() => {
          setHovered(true)
          videoRef.current?.play().catch(() => {})
        }}
        onMouseLeave={() => {
          setHovered(false)
          const v = videoRef.current
          if (v) {
            v.pause()
            v.currentTime = 0
          }
        }}
      >
        <video
          ref={videoRef}
          src={`${item.url}#t=0.1`}
          poster={item.thumbnail_url ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => {
            setLoaded(true)
            updateHasAudio()
          }}
          // Some engines (webkit) only report decoded audio bytes once
          // playback runs — re-check as the hover preview plays.
          onTimeUpdate={updateHasAudio}
          className="size-full object-cover"
        />

        {/* Audio on/off — top-right, shown on hover. Disabled (slashed, dim)
            when the video has no audio track. */}
        <button
          type="button"
          disabled={!audioAvailable}
          onClick={(e) => {
            e.stopPropagation()
            if (audioAvailable) setMuted((m) => !m)
          }}
          title={!audioAvailable ? t("video.noAudio") : muted ? t("video.unmute") : t("video.mute")}
          aria-label={!audioAvailable ? t("video.noAudio") : muted ? t("video.unmute") : t("video.mute")}
          className={cn(
            // Keep the normal pointer even when disabled — the "No audio"
            // tooltip alone signals the state.
            "absolute top-1 right-1 z-10 size-6 rounded-full bg-black/60 text-white flex items-center justify-center transition-opacity opacity-0 cursor-pointer",
            audioAvailable ? "group-hover:opacity-100 hover:bg-black/80" : "group-hover:opacity-50",
          )}
        >
          {!audioAvailable || muted ? (
            <IconVolumeOff className="size-3.5" />
          ) : (
            <IconVolume className="size-3.5" />
          )}
        </button>

        {/* Thumbnail skeleton until the first frame is decoded — only needed
            as a fallback when there's no server-extracted poster. */}
        {!loaded && !item.thumbnail_url && (
          <div className="absolute inset-0 bg-secondary/60 animate-pulse pointer-events-none" />
        )}

        {/* Loading spinner over the poster/skeleton until the clip itself has
            actually decoded a frame. */}
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="size-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white/90">
              <IconLoader2 className="size-5 pltt-animate-spin" />
            </div>
          </div>
        )}

        {/* Play affordance while idle */}
        {loaded && !hovered && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="size-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white/90">
              <IconPlayerPlayFilled className="size-5" />
            </div>
          </div>
        )}

        {/* Hover action: pull this video's prompt back into the composer so the
            user can tweak settings and regenerate ("Remix"). */}
        {item.prompt && composer && (
          <div className="absolute bottom-0 inset-x-0 p-1 flex items-center justify-end gap-1 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="default"
              size="xs"
              onClick={(e) => { e.stopPropagation(); composer.reuse(item.prompt!, remixSettingsFromItem(item)) }}
              className="min-w-0"
            >
              <IconSparkles className="size-3" />
              <span className="truncate">{t("video.remix")}</span>
            </Button>
          </div>
        )}
        {item.group && (
          // Fades out on hover — the audio toggle takes this corner.
          <div
            className="absolute top-2 right-2 size-2.5 ring-2 ring-background/60 transition-opacity group-hover:opacity-0"
            style={{ backgroundColor: item.group, borderRadius: "50%" }}
          />
        )}
      </div>
    )
  }

  if (item.status === "failed") {
    return <FailedCard item={item} aspect={aspect} onRetry={handleRetry} />
  }

  // Pending: started / in_progress
  return <PendingCard item={item} aspect={aspect} />
}

function BatchSection({
  batch,
  onOpenDetail,
  containerWidth,
}: {
  batch: Batch
  onOpenDetail: (item: GenerationItem) => void
  containerWidth: number | null
}) {
  const { t } = useT()
  const timeAgo = useTimeAgo()
  const meta = getModelMeta(batch.model_name)
  const aspectLabel = batch.aspect_ratio || "—"
  const resolutionLabel = (batch.resolution || "").toUpperCase()
  const gridColsClass = gridColsFor(batch.aspect_ratio)
  const cols = columnsForWidth(batch.aspect_ratio, containerWidth)

  return (
    <div className="flex flex-col gap-3 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-6 border-b border-border40 pb-2">
        <div className="flex items-center gap-3 text-xs uppercase tracking-widest shrink-0">
          <span className="flex items-center gap-2 border border-border60 px-2 py-1">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: meta.color }}
              aria-hidden
            />
            <span className=" text-muted-foreground text-xs">{meta.label}</span>
          </span>
          <span className="text-foreground/90 font-semibold">{aspectLabel}</span>
          <span className="text-muted-foreground/40">·</span>
          {resolutionLabel && (
            <>
              <span className="text-foreground/90 font-semibold">{resolutionLabel}</span>
              <span className="text-muted-foreground/40">·</span>
            </>
          )}
          {batch.duration && (
            <>
              {/* normal-case: the row is CSS-uppercased, but "5s" keeps its small s. */}
              <span className="text-foreground/90 font-semibold normal-case">{formatDuration(batch.duration)}</span>
              <span className="text-muted-foreground/40">·</span>
            </>
          )}
          <span className="text-muted-foreground">{timeAgo(batch.created_at)}</span>
        </div>
        {batch.prompt && (
          <div className="flex items-start gap-1 min-w-0 flex-1 justify-end">
            <p className="text-sm text-muted-foreground truncate min-w-0">
              &ldquo;{batch.prompt}&rdquo;
            </p>
            <span className="inline-flex shrink-0" style={{ marginTop: -6 }}>
              <CopyPromptButton text={batch.prompt} showLabel={false} title={t("common.copyPrompt")} />
            </span>
          </div>
        )}
      </div>

      {/* Video strip — columns track the measured workspace width; the Tailwind
          class is only a fallback until the width is known. */}
      <div
        className={cn("grid gap-3", !cols && gridColsClass)}
        style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {batch.items.map((item) => (
          <VideoCard
            key={item.id}
            item={item}
            ratio={batch.aspect_ratio}
            onOpenDetail={
              item.status === "completed" && item.url ? () => onOpenDetail(item) : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

/** Map a workspace item to the shared detail-modal's Favourite shape. */
function itemToFavourite(it: GenerationItem): Favourite {
  return {
    id: it.id,
    type: "video",
    url: it.url!,
    thumbnail_url: it.thumbnail_url,
    prompt: it.prompt,
    model_name: it.model_name,
    project_id: it.project_id,
    key_frame_id: it.key_frame_id,
    aspect_ratio: it.aspect_ratio,
    resolution: it.resolution,
    duration: it.duration,
    gen_params: it.gen_params ?? null,
    image_references: it.image_references,
    created_at: it.created_at,
    group: it.group,
  }
}

// Higher wins when the same item arrives on both SSE subscriptions (each
// EventSource competes for events off the shared per-project queue, so either
// side can hold the freshest state for any given item).
const STATUS_RANK: Record<string, number> = {
  completed: 3,
  failed: 3,
  in_progress: 2,
  started: 1,
  connected: 0,
}

export function VideoWorkspace({ projectId }: { projectId?: string | null }) {
  const { t } = useT()
  const { currentProject, activeKeyFrameId, activeSceneId } = useProjectContext()
  const { items: videoChannelItems } = useGenerationEvents(
    "video",
    projectId,
    activeKeyFrameId,
  )
  // Image generations (the Image→Video flow's first step) ride the shared
  // image subscription hosted by GenerationEventsProvider — opening a second
  // EventSource here would steal events from it. Empty outside the provider.
  const { items: imageChannelItems } = useSharedGenerationEvents()

  const items = React.useMemo(() => {
    const map = new Map<string, GenerationItem>()
    for (const it of [...videoChannelItems, ...imageChannelItems]) {
      const prev = map.get(it.id)
      if (!prev) {
        map.set(it.id, it)
      } else if ((STATUS_RANK[it.status] ?? 0) >= (STATUS_RANK[prev.status] ?? 0)) {
        map.set(it.id, { ...prev, ...it })
      }
    }
    const merged = Array.from(map.values())
    // Scene selected → only that scene's clips. Key-frame view → every clip
    // generated in this keyframe, across all its scenes plus any legacy
    // sceneless items — grouped into per-scene sections below.
    if (activeSceneId) return merged.filter((it) => it.scene_id === activeSceneId)
    return merged
  }, [videoChannelItems, imageChannelItems, activeSceneId])

  // Detail uses the SAME ImageDetailModal as the Archive/Explore tabs and the
  // image workspace, so opening a video from a keyframe matches everywhere.
  const [detail, setDetail] = React.useState<Favourite | null>(null)

  const openDetail = React.useCallback(
    (it: GenerationItem) => {
      const kf = currentProject?.key_frames?.find((k) => k.id === it.key_frame_id)
      setDetail({
        ...itemToFavourite(it),
        project_name: currentProject?.name,
        key_frame_name: kf?.key_frame_name,
      })
    },
    [currentProject],
  )

  const handleGroupChange = (id: string, group: string | null) => {
    setDetail((prev) => (prev && prev.id === id ? { ...prev, group } : prev))
  }

  // Selecting a scene in the sidebar also opens its video in the preview
  // right away (the first completed clip of that run). Seeded with the
  // restored selection so a page load doesn't pop the modal uninvited.
  const prevSceneRef = React.useRef<string | null>(activeSceneId)
  React.useEffect(() => {
    if (prevSceneRef.current === activeSceneId) return
    prevSceneRef.current = activeSceneId
    if (!activeSceneId) return
    const first = items.find(
      (it) => it.scene_id === activeSceneId && it.status === "completed" && it.url,
    )
    if (first) openDetail(first)
  }, [activeSceneId, items, openDetail])

  // Scroll back to the newest generation when a fresh batch arrives — to
  // that item's OWN scene section specifically, not just the page top: with
  // every scene now stacked in one view, the newest clip can land well below
  // the fold (e.g. a generation in "Scene 3" while "Scene 1" sits at top).
  const { newestGenId, newestSectionKey } = React.useMemo(() => {
    let best: string | null = null
    let bestT = -Infinity
    let bestItem: GenerationItem | null = null
    for (const it of items) {
      const t = it.created_at ? new Date(it.created_at).getTime() : 0
      if (t >= bestT) {
        bestT = t
        best = it.generation_id ?? it.id
        bestItem = it
      }
    }
    const key = !best
      ? null
      : activeSceneId
        ? "scene"
        : bestItem?.scene_id || "sceneless"
    return { newestGenId: best, newestSectionKey: key }
  }, [items, activeSceneId])
  const sectionRefs = React.useRef<Map<string, HTMLDivElement>>(new Map())

  // Measure the scroll container's inner width (clientWidth minus p-4) so the
  // batch grids size to the app window, not the viewport — essential in the
  // published OS where the window is narrower than the viewport.
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null)
  const roRef = React.useRef<ResizeObserver | null>(null)
  const scrollNodeRef = React.useRef<HTMLDivElement | null>(null)
  const scrollRef = React.useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    scrollNodeRef.current = node
    if (!node) return
    const measure = () => setContainerWidth(node.clientWidth - 32) // p-4 left+right
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    roRef.current = ro
  }, [])
  React.useEffect(() => () => roRef.current?.disconnect(), [])

  const prevGenRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!newestGenId) return
    if (prevGenRef.current !== null && prevGenRef.current !== newestGenId) {
      const target = newestSectionKey ? sectionRefs.current.get(newestSectionKey) : null
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" })
      } else {
        scrollNodeRef.current?.scrollTo({ top: 0, behavior: "smooth" })
      }
    }
    prevGenRef.current = newestGenId
  }, [newestGenId, newestSectionKey])

  if (items.length === 0) {
    return (
      <div className="flex-1 min-w-0 h-full flex flex-col items-center justify-center p-8 gap-2 text-muted-foreground bg-accent/5 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]">
        <IconVideo className="size-10 opacity-30" strokeWidth={1} />
        <p className="text-xs uppercase tracking-widest">{t("video.noVideos")}</p>
        <p className="text-xs text-muted-foreground/60">{t("video.noVideosHint")}</p>
      </div>
    )
  }

  // Scene view: a single untitled section. Key-frame view: one section per
  // scene (in scene order) that actually has items, plus one for legacy
  // sceneless items — same BatchSection rendering as today, just bucketed
  // under a "Scene N" heading so every scene's clips stay visible at once.
  let sections: WorkspaceSection[]
  if (activeSceneId) {
    sections = [{ key: "scene", title: null, count: items.length, batches: groupIntoBatches(items) }]
  } else {
    const activeKeyFrame = currentProject?.key_frames?.find((k) => k.id === activeKeyFrameId)
    const scenesSorted = [...(activeKeyFrame?.scenes ?? [])].sort((a, b) => a.scene_number - b.scene_number)
    sections = []
    const sceneless = items.filter((it) => !it.scene_id)
    if (sceneless.length) {
      sections.push({ key: "sceneless", title: null, count: sceneless.length, batches: groupIntoBatches(sceneless) })
    }
    for (const scene of scenesSorted) {
      const sceneItems = items.filter((it) => it.scene_id === scene.id)
      if (sceneItems.length === 0) continue
      sections.push({
        key: scene.id,
        title: scene.scene_name || `Scene ${scene.scene_number}`,
        count: sceneItems.length,
        batches: groupIntoBatches(sceneItems),
      })
    }
  }

  // Flat, display-ordered list of openable items (images and videos — the
  // detail modal is type-aware) for the modal's prev/next.
  const navFavs: Favourite[] = sections.flatMap((s) =>
    s.batches.flatMap((b) =>
      b.items.filter((it) => it.status === "completed" && it.url).map(itemToFavourite),
    ),
  )
  const navIndex = detail ? navFavs.findIndex((f) => f.id === detail.id) : -1
  const goPrev = navIndex > 0 ? () => setDetail(navFavs[navIndex - 1]) : undefined
  const goNext =
    navIndex >= 0 && navIndex < navFavs.length - 1 ? () => setDetail(navFavs[navIndex + 1]) : undefined

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-accent/5 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]">
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-auto p-4 flex flex-col gap-6">
        {sections.map((section) => (
          <div
            key={section.key}
            ref={(el) => {
              if (el) sectionRefs.current.set(section.key, el)
              else sectionRefs.current.delete(section.key)
            }}
            className="flex flex-col gap-6"
          >
            {section.title && (
              <div className="flex items-baseline gap-3 border-b border-border40 pb-2">
                <span className="text-lg font-bold uppercase tracking-wide">{section.title}</span>
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  <span className="text-foreground font-semibold">{section.count}</span> VID
                </span>
              </div>
            )}
            {section.batches.map((b) => (
              <BatchSection key={b.id} batch={b} onOpenDetail={openDetail} containerWidth={containerWidth} />
            ))}
          </div>
        ))}
      </div>
      {detail && (
        <ImageDetailModal
          fav={detail}
          onClose={() => setDetail(null)}
          onGroupChange={handleGroupChange}
          onPrev={goPrev}
          onNext={goNext}
        />
      )}
    </div>
  )
}
