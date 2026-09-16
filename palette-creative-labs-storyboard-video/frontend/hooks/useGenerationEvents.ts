"use client"

import * as React from "react"
import { useAuth } from "@/components/providers/auth-provider"
import { useProjectContext } from "@/components/providers/project-context"
import { sseUrl, apiRequest } from "@/lib/api-helper"

export interface GenerationItem {
  id: string
  generation_id?: string
  // Item kind from the DB row ("image" | "video"); the workspace splits its
  // sections on this. May be absent on partial SSE payloads.
  type?: string
  status: "started" | "in_progress" | "completed" | "failed" | "connected"
  url?: string
  // First-frame still of a completed video, extracted server-side — shown as
  // the <video poster> so a preview never flashes black while the clip loads.
  thumbnail_url?: string | null
  prompt?: string
  model_name?: string
  project_id?: string
  key_frame_id?: string
  aspect_ratio?: string
  resolution?: string
  duration?: string
  logs?: string[]
  position?: number
  // Failure detail: `error` arrives over SSE, `error_message` from the
  // /projects + /generations REST payloads. Same value, two source names.
  error?: string
  error_message?: string
  image_references?: Array<string | { id?: string; url: string }>
  gen_params?: Record<string, unknown>
  num_images?: number
  created_at?: string
  group?: string | null
  is_sample?: boolean
  is_upscale_image?: boolean
  // Set on the *base* image once it has been upscaled — drives the disabled
  // "Upscaled" state on its own Upscale button.
  is_upscaled?: boolean
  upscaled_doc_id?: string | null
  url_before_upscale?: string | null
}

/**
 * Subscribes to the user-level SSE stream for generations. Initial state is
 * seeded from `currentProject.key_frames[].items` in context — the project page
 * already fetches `/projects/{id}` on mount, so we don't refetch here.
 *
 * When `keyFrameId` is provided, only items belonging to that key frame are kept
 * (both for the initial seed and live SSE updates).
 */
export function useGenerationEvents(
  generationType: "image" | "video" = "image",
  projectId?: string | null,
  keyFrameId?: string | null
) {
  // Identity comes from the platform context via the AuthProvider shim, which
  // wraps `usePlatform()` from @palettelab/sdk. No bearer token is exchanged
  // at the app layer — the SDK's `apiFetch` / `EventSource` (same-origin in
  // production, simulator-proxied in `pltt dev`) carry the session cookie
  // managed by Palette OS.
  const { user } = useAuth()
  const {
    currentProject,
    optimisticItems,
    clearOptimisticBatch,
    retryingItemIds,
    clearItemRetrying,
  } = useProjectContext()
  // Keyed by item id, accumulates ALL live updates for the current project
  // (across every key frame). Filtering happens at render time so switching
  // keyframes doesn't lose work received while away.
  const [liveUpdates, setLiveUpdates] = React.useState<Record<string, GenerationItem>>({})

  // Only reset when the project itself changes
  React.useEffect(() => {
    setLiveUpdates({})
  }, [projectId])

  // Seed: all items embedded in the project's key_frames
  const seeded = React.useMemo(() => {
    const out: Record<string, GenerationItem> = {}
    if (!currentProject || currentProject.id !== projectId) return out
    for (const kf of currentProject.key_frames ?? []) {
      for (const row of kf.items ?? []) {
        if (!row?.id) continue
        const status = (row.status as GenerationItem["status"]) || "completed"
        out[row.id] = { ...row, status, key_frame_id: row.key_frame_id ?? kf.id } as GenerationItem
      }
    }
    return out
  }, [currentProject, projectId])

  // Live updates — accept everything for this project, regardless of keyframe
  React.useEffect(() => {
    if (!user?.id) return

    // Channels are (org, identifier) keyed; we use project_id when present and
    // fall back to user_id for the global stream. Resolving the absolute URL
    // via `sseUrl` is required because under `pltt dev` the backend lives on
    // a different port than the frontend — a relative path would 404 against
    // the simulator.
    const channel = projectId ?? user.id
    const eventName = generationType === "image" ? "image_generation" : "video_generation"
    let es: EventSource | null = null
    let cancelled = false

    const onMessage = (e: MessageEvent) => {
      try {
        const data: GenerationItem = JSON.parse(e.data)
        if (!data.id || data.status === "connected") return
        if (projectId && data.project_id && data.project_id !== projectId) return
        setLiveUpdates((prev) => {
          const existing = prev[data.id]
          const next: GenerationItem = { ...existing, ...data }
          if (!next.project_id && existing?.project_id) next.project_id = existing.project_id
          if (!next.key_frame_id && existing?.key_frame_id) next.key_frame_id = existing.key_frame_id
          return { ...prev, [data.id]: next }
        })
      } catch {
        // ignore malformed
      }
    }

    sseUrl(channel, generationType).then(({ url, withCredentials }) => {
      if (cancelled) return
      es = new EventSource(url, { withCredentials })
      es.addEventListener(eventName, onMessage)
      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do
      }
    })

    return () => {
      cancelled = true
      if (es) {
        es.removeEventListener(eventName, onMessage)
        es.close()
      }
    }
  }, [user?.id, generationType, projectId])

  // Polling fallback for live updates. The backend SSE manager uses an
  // in-process per-worker queue, so in a multi-worker hosted deployment the
  // generation request and the EventSource can land on different workers and
  // the "completed" event is never delivered to the browser (the image only
  // appears after a manual refresh re-fetches the project). While a generation
  // is pending for this project, poll `/generations/{projectId}` and merge the
  // rows into liveUpdates — completed items (with their `url`) then render
  // without a refresh. Stops automatically once nothing is pending. SSE still
  // provides instant updates whenever it does reach the right worker.
  const shouldPoll = React.useMemo(() => {
    if (!projectId) return false
    const isPending = (s?: string) => s === "started" || s === "in_progress"
    const optPending = optimisticItems.some((o) => o.project_id === projectId)
    const livePending = Object.values(liveUpdates).some(
      (it) => it.project_id === projectId && isPending(it.status),
    )
    // Also resume polling for an item that was STILL generating when the page
    // loaded (seeded from the project). Without this, refreshing while a slow
    // Midjourney job runs would strand it — `liveUpdates` resets on reload and
    // the optimistic item is gone, so neither check above would fire and the
    // image would never appear until another refresh.
    const seedPending = Object.values(seeded).some((it) => isPending(it.status))
    return optPending || livePending || seedPending
  }, [optimisticItems, liveUpdates, seeded, projectId])

  React.useEffect(() => {
    if (!shouldPoll || !projectId) return
    let stopped = false
    let attempts = 0

    const poll = async () => {
      attempts += 1
      try {
        const res = await apiRequest(`/generations/${projectId}`)
        const rows: GenerationItem[] = Array.isArray(res)
          ? res
          : (res?.items ?? res?.generations ?? [])
        if (stopped || rows.length === 0) return
        setLiveUpdates((prev) => {
          const next = { ...prev }
          for (const row of rows) {
            if (!row?.id) continue
            const status = (row.status as GenerationItem["status"]) || "completed"
            next[row.id] = { ...next[row.id], ...row, status }
          }
          return next
        })
      } catch {
        // ignore — SSE may still deliver, and the next tick will retry
      }
    }

    poll()
    const interval = setInterval(() => {
      // Safety cap (~3 min) so a stuck/failed job can't poll forever.
      if (stopped || attempts >= 60) {
        clearInterval(interval)
        return
      }
      poll()
    }, 3000)

    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [shouldPoll, projectId])

  // Retire optimistic batches once the corresponding real items show up
  // (via SSE → liveUpdates, or via a project refetch → seeded).
  React.useEffect(() => {
    if (optimisticItems.length === 0) return
    const realGenIds = new Set<string>()
    for (const it of Object.values(liveUpdates)) {
      if (it.generation_id) realGenIds.add(it.generation_id)
    }
    for (const it of Object.values(seeded)) {
      if (it.generation_id) realGenIds.add(it.generation_id)
    }
    const toClear = new Set<string>()
    for (const opt of optimisticItems) {
      if (opt.generation_id && realGenIds.has(opt.generation_id)) {
        toClear.add(opt._clientBatchId)
      }
    }
    toClear.forEach((id) => clearOptimisticBatch(id))
  }, [optimisticItems, liveUpdates, seeded, clearOptimisticBatch])

  // Drop an in-place retry bridge once the server reflects the item leaving the
  // failed state — either the backend reset it to in_progress, or it has since
  // re-completed/re-failed. Real state then drives the card again (so a second
  // failure still shows the failed card with a fresh Retry).
  React.useEffect(() => {
    const ids = Object.keys(retryingItemIds)
    if (ids.length === 0) return
    for (const id of ids) {
      const status = liveUpdates[id]?.status ?? seeded[id]?.status
      if (status !== "failed") clearItemRetrying(id)
    }
  }, [retryingItemIds, liveUpdates, seeded, clearItemRetrying])

  // Merge seed + live + still-pending optimistic. `allItems` is the full
  // project-wide set (every keyframe); `items` filters it to the active keyframe
  // at read time. The chat's "Generating…" indicator reads `allItems` so it
  // catches a chat-started generation regardless of which keyframe it lands on.
  const byTime = (a: GenerationItem, b: GenerationItem) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  }
  const allItems = React.useMemo(() => {
    const merged: Record<string, GenerationItem> = { ...seeded }
    for (const [id, update] of Object.entries(liveUpdates)) {
      merged[id] = { ...merged[id], ...update }
    }
    const realGenIds = new Set<string>()
    for (const item of Object.values(merged)) {
      if (item.generation_id) realGenIds.add(item.generation_id)
    }
    for (const opt of optimisticItems) {
      if (projectId && opt.project_id && opt.project_id !== projectId) continue
      if (opt.generation_id && realGenIds.has(opt.generation_id)) continue
      merged[opt.id] = { ...opt } as unknown as GenerationItem
    }
    // In-place retry: a just-retried failed item flips to "generating" in its
    // OWN card right away, so retry regenerates the same skeleton instead of
    // appearing to add a new one. This only bridges the gap until the backend
    // reset and its SSE/refetch update land (which then clear the flag).
    for (const id of Object.keys(retryingItemIds)) {
      const it = merged[id]
      if (it && it.status === "failed") {
        merged[id] = { ...it, status: "in_progress", error: undefined, error_message: undefined }
      }
    }
    return Object.values(merged).sort(byTime)
  }, [seeded, liveUpdates, optimisticItems, projectId, retryingItemIds])

  const list = React.useMemo(
    () => (keyFrameId ? allItems.filter((item) => item.key_frame_id === keyFrameId) : allItems),
    [allItems, keyFrameId],
  )

  const clear = React.useCallback(() => setLiveUpdates({}), [])

  return { items: list, allItems, clear }
}
