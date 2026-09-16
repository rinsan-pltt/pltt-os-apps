"use client"

import React, { type CSSProperties } from "react"
import { IconAlertTriangle, IconPhoto } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { type GenerationItem } from "@/hooks/useGenerationEvents"
import { useSharedGenerationEvents } from "@/components/providers/generation-events-context"
import { useProjectContext, type OptimisticGenerationItem } from "@/components/providers/project-context"
import { ImageDetailModal } from "@/app/explore/image-detail-modal"
import type { Favourite } from "@/app/explore/types"
import { imageModelOptions } from "./video-helper"
import { apiRequest } from "@/lib/api-helper"
import { setItemDragPayload } from "@/lib/drag-types"
import { Button } from "@/components/ui/button"
import { CopyPromptButton } from "@/components/ui/copy-prompt-button"
import { useT, useTimeAgo } from "@/lib/i18n"

interface ModelMeta {
  label: string
  color: string
}

function getModelMeta(modelName?: string): ModelMeta {
  if (!modelName) return { label: "Auto", color: "#94a3b8" }
  const match = imageModelOptions.find((m) => m.value === modelName)
  if (match) return { label: match.label, color: match.color }
  return { label: modelName, color: "#94a3b8" }
}

interface Batch {
  id: string
  model_name?: string
  prompt?: string
  key_frame_id?: string
  aspect_ratio?: string
  resolution?: string
  created_at?: string
  items: GenerationItem[]
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

function aspectStyle(ratio?: string): CSSProperties {
  if (!ratio) return { aspectRatio: "1 / 1" }
  const [w, h] = ratio.split(":")
  if (!w || !h) return { aspectRatio: "1 / 1" }
  return { aspectRatio: `${w} / ${h}` }
}

const QUADRANT_POS: React.CSSProperties[] = [
  { top: 8, left: 8 },
  { top: 8, left: "calc(50% + 8px)" },
  { top: "calc(50% + 8px)", left: 8 },
  { top: "calc(50% + 8px)", left: "calc(50% + 8px)" },
]

function SampleCard({ item, onOpenDetail }: { item: GenerationItem; onOpenDetail?: () => void }) {
  const { t } = useT()
  const { addOptimisticItems } = useProjectContext()
  const [selected, setSelected] = React.useState<number[]>([])
  const [actionLoading, setActionLoading] = React.useState<string | null>(null)

  const toggle = (n: number) =>
    setSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]))

  const runAction = async (actions: string[]) => {
    if (actionLoading) return
    const type = actions[0]?.startsWith("U") ? "upscale" : "variation"
    setActionLoading(type)
    try {
      const res = (await apiRequest("/generate/midjourney/action", {
        method: "POST",
        body: JSON.stringify({ doc_id: item.id, action: actions }),
      })) as { generation_id?: string } | undefined
      // Show a generating skeleton per requested action immediately.
      addOptimisticItems(
        makeActionPlaceholders(actions.length, {
          generation_id: res?.generation_id,
          model_name: "midjourney",
          prompt: item.prompt,
          project_id: item.project_id,
          key_frame_id: item.key_frame_id,
          aspect_ratio: item.aspect_ratio,
          resolution: item.resolution,
        }),
      )
    } catch (e) {
      console.error("Midjourney action failed:", e)
    } finally {
      setActionLoading(null)
    }
  }

  const sorted = [...selected].sort()

  return (
    <div
      className="relative border border-border40 overflow-hidden bg-secondary/40 self-start"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/uri-list", item.url!)
        e.dataTransfer.setData("text/plain", item.url!)
        // Full item identity so a drop on the chat panel can open this
        // image's edit thread, like the Edit button does. Card-level so a
        // drag started over the overlays (dividers, quadrant buttons) works.
        setItemDragPayload(e.dataTransfer, {
          id: item.id,
          url: item.url ?? undefined,
          prompt: item.prompt,
          model_name: item.model_name,
          key_frame_id: item.key_frame_id,
          project_id: item.project_id,
        })
        e.dataTransfer.effectAllowed = "copy"
      }}
    >
      <img
        src={item.url!}
        alt={item.prompt || ""}
        draggable={false}
        className={cn("w-full h-auto block", onOpenDetail && "cursor-pointer")}
        onClick={onOpenDetail}
      />

      {/* Grid dividers */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 bottom-0 left-1/2 border-l border-white/30" />
        <div className="absolute left-0 right-0 top-1/2 border-t border-white/30" />
      </div>

      {/* Quadrant circle selectors */}
      {[1, 2, 3, 4].map((n, i) => {
        const isSel = selected.includes(n)
        return (
          <button
            key={n}
            onClick={() => toggle(n)}
            className={cn(
              "absolute size-6 rounded-full flex items-center justify-center text-[10px] font-bold z-10 transition-colors",
              isSel
                ? "bg-foreground text-background"
                : "border-2 border-dashed border-white/70 bg-black/30 text-transparent hover:text-white/60"
            )}
            style={QUADRANT_POS[i]}
          >
            {n}
          </button>
        )
      })}

      {item.group && (
        <div
          className="absolute top-2 right-2 size-2.5 ring-2 ring-background/60"
          style={{ backgroundColor: item.group, borderRadius: "50%" }}
        />
      )}

      {/* Floating action overlay — only visible when a quadrant is selected */}
      {sorted.length > 0 && (
        <div className="absolute bottom-0 inset-x-0 p-1 bg-transparent flex items-center justify-end gap-1">
          <Button
            variant="default"
            size="xs"
            disabled={!!actionLoading}
            onClick={() => runAction(sorted.map((n) => `U${n}`))}
            className={cn(actionLoading === "upscale" && "opacity-50")}
          >
            {t("generation.upscale")}
          </Button>
          <Button
            variant="default"
            size="xs"
            disabled={!!actionLoading}
            onClick={() => runAction(sorted.map((n) => `V${n}`))}
            className={cn(actionLoading === "variation" && "opacity-50")}
          >
            {t("generation.variation")}
          </Button>
        </div>
      )}
    </div>
  )
}

// Build "generating" placeholders for an upscale/variation action so the
// skeleton appears instantly — these actions only emit an SSE "started" event,
// which can be missed under a multi-worker backend, leaving nothing visible
// until a manual refresh. The optimistic item also triggers the polling
// fallback, and is retired once the real item arrives (matched by generation_id).
function makeActionPlaceholders(
  count: number,
  src: {
    generation_id?: string
    model_name?: string
    prompt?: string
    project_id?: string
    key_frame_id?: string
    aspect_ratio?: string
    resolution?: string
  },
): OptimisticGenerationItem[] {
  const batch = `act_${src.generation_id ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
  const nowIso = new Date().toISOString()
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    id: `__opt_${batch}_${i}`,
    status: "started" as const,
    model_name: src.model_name,
    prompt: src.prompt,
    project_id: src.project_id,
    key_frame_id: src.key_frame_id,
    aspect_ratio: src.aspect_ratio,
    resolution: src.resolution,
    created_at: nowIso,
    generation_id: src.generation_id,
    _optimistic: true as const,
    _clientBatchId: batch,
  }))
}

type FailureKind = "moderation" | "nsfw" | "error"

// Classify a failure ONLY from the stored error text (fal / runware /
// midjourney all surface the reason as a string). Content-moderation and NSFW
// rejections are shown as-is with no retry (re-running the same prompt would
// fail again); everything else is treated as a transient error and offered a
// retry. Only ever called for items that actually failed.
function classifyFailure(error?: string | null): FailureKind {
  const e = (error || "").toLowerCase()
  if (/\bnsfw\b|explicit|sexual|pornograph|adult content/.test(e)) return "nsfw"
  if (/moderation|safety|content[ _-]?policy|flagged|prohibited|sensitive|blocked|violat|not allowed|disallowed|banned/.test(e)) {
    return "moderation"
  }
  return "error"
}

// Providers (and FastAPI validation) often surface failures as a serialized
// structure like `[{'loc': ['body', 'prompt'], 'msg': '…'}]` or
// `{'code': 'inputError', 'message': 'Bad request returned by OpenAI…'}`. Pull
// out the human-readable `msg`/`message` value(s), strip provider noise, then
// fall back to the raw text when there's no recognizable field.
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

// Trim provider-specific wrappers and support boilerplate so the user sees the
// actual reason, e.g.
//   "Bad request returned by OpenAI. Additional information: Your request was
//    rejected by the safety system. If you believe this is an error, contact us
//    at help.openai.com and include the request ID req_abc123."
// becomes
//   "Your request was rejected by the safety system. If you believe this is an
//    error, please contact us"
function cleanProviderMessage(text: string): string {
  let t = text.trim()
  // Drop wrapper prefixes like "… Additional information: ".
  t = t.replace(/^.*?\bAdditional information:\s*/i, "")
  // Replace the provider's "contact us at <url> and include the request ID …"
  // with a clean call to action.
  t = t.replace(/contact us at\s+\S+\s+and include the request ID\s+\S+/i, "please contact us")
  // Strip any leftover request-ID references.
  t = t.replace(/\s*(?:and include the )?request ID\s+\S+/i, "")
  return t.trim()
}

function ItemCard({
  item,
  ratio,
  onClick,
  onOpenDetail,
}: {
  item: GenerationItem
  ratio?: string
  onClick?: () => void
  onOpenDetail?: (fav: Favourite) => void
}) {
  const { t } = useT()
  const { addOptimisticItems, openChatForItem, refreshCurrentProject, markItemRetrying, clearItemRetrying } = useProjectContext()
  const isPending = item.status === "started" || item.status === "in_progress"
  const aspect = aspectStyle(ratio ?? item.aspect_ratio)
  const [actionLoading, setActionLoading] = React.useState<"upscale" | "variation" | null>(null)
  // Three Upscale button states, driven by the base image's own flags (which
  // the backend streams over SSE): "Upscale" → "Upscaling…" → "Upscaled".
  //  - upscaling: a result is pending (upscaled_doc_id set, not yet done)
  //  - upscaled:  the upscale landed (is_upscaled), or this item *is* an upscale
  // The optimistic flag shows "Upscaling…" the instant the click succeeds,
  // before the SSE round-trip; the effect hands control back to the server
  // state once it arrives (on success, failure-revert, or completion).
  const [optimisticUpscaling, setOptimisticUpscaling] = React.useState(false)
  const [retrying, setRetrying] = React.useState(false)
  const upscaled = !!item.is_upscale_image || !!item.is_upscaled
  const upscaling = !upscaled && (optimisticUpscaling || !!item.upscaled_doc_id)

  // Editing happens in the CHAT tab: clicking Edit anchors the chat to THIS
  // image's own agent thread (one thread per image id), loading its full chat
  // history so the conversation continues where it left off. The agent picks a
  // reference-capable edit model automatically, so any completed image can be
  // edited regardless of the model that produced it.
  const handleEditInChat = () => {
    openChatForItem({
      id: item.id,
      url: item.url,
      prompt: item.prompt,
      model_name: item.model_name,
      key_frame_id: item.key_frame_id,
      project_id: item.project_id,
    })
  }

  // Re-submit the failed generation IN PLACE: regenerate into the same item
  // (retry_doc_id + its own generation_id) so the result lands in the SAME card
  // instead of spawning a second one. The card flips to "generating" instantly
  // via markItemRetrying; the backend reset + SSE/refetch then carry it to
  // completion. Reuses the stored reference images when present.
  const handleRetry = async () => {
    if (retrying) return
    setRetrying(true)
    // Flip THIS card to a generating skeleton immediately, so the retry never
    // looks like it added a new card during the request round-trip.
    markItemRetrying(item.id)
    try {
      const refs = Array.isArray(item.image_references)
        ? item.image_references
            .map((r) => (typeof r === "string" ? { url: r } : { id: r.id, url: r.url }))
            .filter((r) => r.url)
        : undefined
      await apiRequest("/generate/image", {
        method: "POST",
        body: JSON.stringify({
          prompt: item.prompt,
          models: item.model_name ? [item.model_name] : [],
          params: {
            aspect_ratio: item.aspect_ratio,
            resolution: item.resolution,
            num_images: 1,
          },
          image_references: refs && refs.length ? refs : undefined,
          project_id: item.project_id,
          key_frame_id: item.key_frame_id,
          // Regenerate THIS item in place (no new card); keep its generation_id.
          generation_id: item.generation_id,
          retry_doc_id: item.id,
        }),
      })
      // The backend reset this item to in_progress synchronously — refresh so
      // the SAME card immediately shows the regeneration (the poll fallback then
      // carries it to completion). Leave `retrying` set until then.
      if (item.project_id) await refreshCurrentProject(item.project_id)
    } catch (e) {
      console.error("Retry failed:", e)
      setRetrying(false)
      // The request never started the regeneration, so drop the in-place
      // bridge and let the failed card (with its Retry button) come back.
      clearItemRetrying(item.id)
    }
  }

  React.useEffect(() => {
    setOptimisticUpscaling(false)
  }, [item.is_upscale_image, item.is_upscaled, item.upscaled_doc_id])

  const runAction = async (action: string) => {
    if (actionLoading) return
    const type = action.startsWith("U") ? "upscale" : "variation"
    setActionLoading(type)
    try {
      const payload = type === "upscale"
        ? { doc_id: item.id, action }
        : { doc_id: item.id, action, model_name: item.model_name }
      const res = (await apiRequest("/generate/others/action", {
        method: "POST",
        body: JSON.stringify(payload),
      })) as { generation_id?: string } | undefined
      if (type === "upscale") setOptimisticUpscaling(true)
      // A variation creates a NEW image; show a generating skeleton instantly
      // (the action only emits an SSE "started" event, which may be missed).
      if (type === "variation") {
        addOptimisticItems(
          makeActionPlaceholders(1, {
            generation_id: res?.generation_id,
            model_name: item.model_name,
            prompt: item.prompt,
            project_id: item.project_id,
            key_frame_id: item.key_frame_id,
            aspect_ratio: item.aspect_ratio,
            resolution: item.resolution,
          }),
        )
      }
    } catch (e) {
      console.error("Action failed:", e)
    } finally {
      setActionLoading(null)
    }
  }

  if (item.is_sample && item.status === "completed" && item.url) {
    return (
      <SampleCard
        item={item}
        onOpenDetail={
          onOpenDetail
            ? () =>
                onOpenDetail({
                  id: item.id,
                  url: item.url!,
                  prompt: item.prompt,
                  model_name: item.model_name,
                  project_id: item.project_id,
                  key_frame_id: item.key_frame_id,
                  aspect_ratio: item.aspect_ratio,
                  created_at: item.created_at,
                  group: item.group,
                  url_before_upscale: item.url_before_upscale,
                })
            : undefined
        }
      />
    )
  }

  if (item.status === "completed" && item.url) {
    return (
      <div
        className="group relative bg-secondary/40 border border-border40 overflow-hidden cursor-pointer"
        style={aspect}
        onClick={onClick}
        draggable
        onDragStart={(e) => {
          // Carry the image URL so it can be dropped onto the prompt box or
          // the references strip in the control panel, plus the full item
          // identity so a drop on the chat panel opens this image's edit
          // thread, like the Edit button does. The handler lives on the CARD,
          // not the <img>, so a drag started anywhere on it works — including
          // the bottom action bar. On upscaled (e.g. seedvr) results the
          // disabled "Upscaled" button has pointer-events: none, so grabs in
          // that strip used to land on the non-draggable gradient bar and the
          // drag never started. Drags from the <img> bubble up here too.
          e.dataTransfer.setData("text/uri-list", item.url!)
          e.dataTransfer.setData("text/plain", item.url!)
          setItemDragPayload(e.dataTransfer, {
            id: item.id,
            url: item.url ?? undefined,
            prompt: item.prompt,
            model_name: item.model_name,
            key_frame_id: item.key_frame_id,
            project_id: item.project_id,
          })
          e.dataTransfer.effectAllowed = "copy"
        }}
      >
        {/* draggable={false}: a draggable <img> starts a NATIVE image drag,
            whose preview Chrome builds from the full-resolution bitmap —
            with the multi-MB PNGs that upscales (seedvr) produce, that can
            fail and the drag never starts. With the img inert, every grab
            walks up to the draggable card div above, which drags a cheap
            rendered-size snapshot and always carries our payload. */}
        <img
          src={item.url}
          alt={item.prompt || ""}
          draggable={false}
          className="size-full object-cover"
        />
        {item.group && (
          <div
            className="absolute top-2 right-2 size-2.5 ring-2 ring-background/60"
            style={{ backgroundColor: item.group, borderRadius: "50%" }}
          />
        )}
        {/* Action buttons — always visible, wrap to fit the card width, and
            truncate their label when a button is squeezed narrower than its text. */}
        <div className="absolute bottom-0 inset-x-0 p-1 flex flex-wrap items-center justify-end gap-1 bg-gradient-to-t from-black/40 to-transparent">
          <Button
            variant="default"
            size="xs"
            disabled={!!actionLoading}
            onClick={(e) => { e.stopPropagation(); handleEditInChat() }}
            className="min-w-0"
          >
            <span className="truncate">Edit</span>
          </Button>
          <Button
            variant="default"
            size="xs"
            disabled={!!actionLoading || upscaling || upscaled}
            onClick={(e) => { e.stopPropagation(); runAction("U1") }}
            className={cn("min-w-0", (actionLoading === "upscale" || upscaling) && "opacity-50")}
          >
            <span className="truncate">
              {actionLoading === "upscale" || upscaling ? t("generation.upscaling") : upscaled ? t("generation.upscaled") : t("generation.upscale")}
            </span>
          </Button>
          <Button
            variant="default"
            size="xs"
            disabled={!!actionLoading}
            onClick={(e) => { e.stopPropagation(); runAction("V1") }}
            className={cn("min-w-0", actionLoading === "variation" && "opacity-50")}
          >
            <span className="truncate">
              {actionLoading === "variation" ? "..." : t("generation.variation")}
            </span>
          </Button>
        </div>

      </div>
    )
  }
  if (item.status === "failed") {
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
        {!isBlocked && (
          <Button
            variant="default"
            size="xs"
            disabled={retrying}
            onClick={(e) => {
              e.stopPropagation()
              handleRetry()
            }}
            className={cn(retrying && "opacity-50")}
          >
            {retrying ? t("generation.retrying") : t("generation.retry")}
          </Button>
        )}
      </div>
    )
  }
  // Pending: started / in_progress
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
      {/* Bar loader */}
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

// Viewport-breakpoint fallback used only until the container width is measured.
function gridColsFor(ratio?: string): string {
  if (!ratio) return "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
  const [w, h] = ratio.split(":").map((n) => parseFloat(n))
  if (!w || !h) return "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
  const aspect = w / h
  // Landscape (16:9, 4:3, 21:9, etc.) → 1 col below xl, 2 from xl, 3 from 2xl
  if (aspect > 1.2) return "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3"
  // Square or portrait → 1 col below lg, 2 from lg, 3 from xl, 4 from 2xl
  return "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
}

// Column count from the measured workspace width (the app window's content area
// minus the control panel), not the viewport. Landscape images get a wider
// target card so fewer fit per row.
const GEN_GRID_GAP = 12 // gap-3
function columnsForWidth(ratio: string | undefined, width: number | null): number | null {
  if (width == null) return null
  let target = 240 // square / portrait
  if (ratio) {
    const [w, h] = ratio.split(":").map((n) => parseFloat(n))
    if (w && h && w / h > 1.2) target = 360 // landscape → wider cards
  }
  const cols = Math.floor((width + GEN_GRID_GAP) / (target + GEN_GRID_GAP))
  return Math.max(1, Math.min(4, cols))
}

function BatchSection({
  batch,
  onOpenDetail,
  containerWidth,
}: {
  batch: Batch
  onOpenDetail: (fav: Favourite) => void
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
          <span className="text-muted-foreground">{timeAgo(batch.created_at)}</span>
        </div>
        {batch.prompt && (
          <div className="flex items-start gap-1 min-w-0">
            <p className="text-sm text-muted-foreground truncate min-w-0">
              &ldquo;{batch.prompt}&rdquo;
            </p>
            {/* Raised half a line, like an exponent, at the end of the prompt. */}
            <span className="inline-flex shrink-0" style={{ marginTop: -6 }}>
              <CopyPromptButton text={batch.prompt} showLabel={false} title={t("common.copyPrompt")} />
            </span>
          </div>
        )}
      </div>

      {/* Image strip — columns track the measured workspace width; the Tailwind
          classes are the pre-measurement fallback. */}
      <div
        className={cn("grid gap-3", !cols && gridColsClass)}
        style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {batch.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            ratio={batch.aspect_ratio}
            onOpenDetail={onOpenDetail}
            onClick={
              item.status === "completed" && item.url && !item.is_sample
                ? () =>
                    onOpenDetail({
                      id: item.id,
                      url: item.url!,
                      prompt: item.prompt,
                      model_name: item.model_name,
                      project_id: item.project_id,
                      key_frame_id: item.key_frame_id,
                      aspect_ratio: item.aspect_ratio,
                      resolution: item.resolution,
                      created_at: item.created_at,
                      group: item.group,
                      url_before_upscale: item.url_before_upscale,
                    })
                : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

export function GenerationWorkspace() {
  const { currentProject } = useProjectContext()
  // The project-scoped SSE subscription lives in GenerationEventsProvider (one
  // shared connection for the whole project page); read the live items from it.
  const { items } = useSharedGenerationEvents()
  const { t } = useT()
  const [detail, setDetail] = React.useState<Favourite | null>(null)
  const [groupOverrides, setGroupOverrides] = React.useState<Record<string, string | null>>({})

  // Measure the scroll container's inner width (clientWidth excludes the
  // scrollbar; minus p-4 padding) so the batch grids size to the app window's
  // available width rather than the browser viewport.
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

  const openDetail = React.useCallback(
    (fav: Favourite) => {
      const kf = currentProject?.key_frames?.find((k) => k.id === fav.key_frame_id)
      setDetail({
        ...fav,
        project_name: fav.project_name ?? currentProject?.name,
        key_frame_name: fav.key_frame_name ?? kf?.key_frame_name,
      })
    },
    [currentProject]
  )

  const handleGroupChange = (id: string, group: string | null) => {
    setGroupOverrides((prev) => ({ ...prev, [id]: group }))
    setDetail((prev) => (prev && prev.id === id ? { ...prev, group } : prev))
  }

  const patchedItems = React.useMemo(
    () => items.map((item) => (item.id in groupOverrides ? { ...item, group: groupOverrides[item.id] } : item)),
    [items, groupOverrides]
  )

  // Newest generation currently in the workspace. When it changes a new
  // generation has started, so we scroll the (newest-first) list back to the
  // top to bring the latest generating batch into view.
  const newestGenId = React.useMemo(() => {
    let best: string | null = null
    let bestT = -Infinity
    for (const it of patchedItems) {
      const t = it.created_at ? new Date(it.created_at).getTime() : 0
      if (t >= bestT) {
        bestT = t
        best = it.generation_id ?? it.id
      }
    }
    return best
  }, [patchedItems])

  const prevGenRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!newestGenId) return
    if (prevGenRef.current !== null && prevGenRef.current !== newestGenId) {
      scrollNodeRef.current?.scrollTo({ top: 0, behavior: "smooth" })
    }
    prevGenRef.current = newestGenId
  }, [newestGenId])

  if (patchedItems.length === 0) {
    return (
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-8 gap-2 text-muted-foreground">
        <IconPhoto className="size-10 opacity-30" strokeWidth={1} />
        <p className="text-xs uppercase tracking-widest">{t("generation.noActive")}</p>
        <p className="text-xs text-muted-foreground/60">
          {t("generation.noActiveHint")}
        </p>
      </div>
    )
  }

  const batches = groupIntoBatches(patchedItems)

  // Flat, display-ordered list of openable images in this keyframe, for the
  // detail modal's prev/next navigation.
  const navFavs: Favourite[] = batches.flatMap((b) =>
    b.items
      .filter((it) => it.status === "completed" && it.url)
      .map((it) => ({
        id: it.id,
        url: it.url!,
        prompt: it.prompt,
        model_name: it.model_name,
        project_id: it.project_id,
        key_frame_id: it.key_frame_id,
        aspect_ratio: it.aspect_ratio,
        resolution: it.resolution,
        created_at: it.created_at,
        group: it.group,
        url_before_upscale: it.url_before_upscale,
      }))
  )
  const navIndex = detail ? navFavs.findIndex((f) => f.id === detail.id) : -1
  const goPrev = navIndex > 0 ? () => openDetail(navFavs[navIndex - 1]) : undefined
  const goNext =
    navIndex >= 0 && navIndex < navFavs.length - 1 ? () => openDetail(navFavs[navIndex + 1]) : undefined

  return (
    <>
      <div
        ref={scrollRef}
        data-generation-scroll
        className="flex-1 min-w-0 overflow-auto p-4 flex flex-col gap-6"
      >
        {batches.map((b) => (
          <BatchSection key={b.id} batch={b} onOpenDetail={openDetail} containerWidth={containerWidth} />
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
    </>
  )
}
