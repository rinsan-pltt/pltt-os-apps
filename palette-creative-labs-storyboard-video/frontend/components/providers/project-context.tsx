"use client"

import * as React from "react"
import { apiRequest } from "@/lib/api-helper"

export interface KeyFrameItem {
  id: string
  url?: string
  // First-frame still of a completed video, extracted server-side — shown as
  // the <video poster> so a preview never flashes black while the clip loads.
  thumbnail_url?: string | null
  prompt?: string
  model_name?: string
  status?: string
  key_frame_id?: string
  project_id?: string
  aspect_ratio?: string
  resolution?: string
  created_at?: string
  group?: string | null
}

export interface KeyFrameAsset {
  id: string
  url: string
  created_at: string
}

// The video panel's saved inputs for a keyframe — start/end frames, reference
// images and Kling elements. Persisted server-side until the user removes them.
export interface KeyFrameVideoRefs {
  start_image?: string | null
  end_image?: string | null
  reference_images?: string[]
  elements?: {
    name?: string | null
    frontal_image?: string | null
    reference_images?: string[]
  }[]
}

export interface KeyFrame {
  id: string
  key_frame_name: string
  key_frame_number: number
  created_at: string
  items?: KeyFrameItem[]
  assets?: KeyFrameAsset[]
  video_refs?: KeyFrameVideoRefs | null
}

export interface ProjectInfo {
  id: string
  name: string
  client?: string | null
  type: "image" | "video"
  key_frames?: KeyFrame[]
  created_at?: string
  updated_at?: string
}

export interface OptimisticGenerationItem {
  id: string
  status: "started"
  // "image" | "video" — lets the workspace file the placeholder in the right
  // section before the real (typed) row arrives.
  type?: string
  model_name?: string
  prompt?: string
  project_id?: string
  key_frame_id?: string
  aspect_ratio?: string
  resolution?: string
  created_at: string
  generation_id?: string
  // Carries `{ source }` (e.g. "chat") so consumers can attribute the
  // placeholder the same way they do real generation rows.
  gen_params?: Record<string, unknown>
  _optimistic: true
  _clientBatchId: string
}

// Image an "Edit" click targets: the chat panel anchors its thread to this
// image (one agent thread per image id, with its own persisted history).
export interface ChatTargetItem {
  id: string
  url?: string
  prompt?: string
  model_name?: string
  key_frame_id?: string
  project_id?: string
}

interface ProjectContextValue {
  currentProject: ProjectInfo | null
  setCurrentProject: (project: ProjectInfo | null) => void
  projects: ProjectInfo[]
  setProjects: React.Dispatch<React.SetStateAction<ProjectInfo[]>>
  addProject: (project: ProjectInfo) => void
  activeKeyFrameId: string | null
  setActiveKeyFrameId: (id: string | null) => void
  optimisticItems: OptimisticGenerationItem[]
  addOptimisticItems: (items: OptimisticGenerationItem[]) => void
  clearOptimisticBatch: (clientBatchId: string) => void
  // In-place retry: ids of failed items the user just retried. The workspace
  // flips these to a "generating" state in their OWN card immediately, so a
  // retry never appears to spawn a second skeleton during the backend reset +
  // SSE/refetch round-trip. Cleared once real state leaves "failed".
  retryingItemIds: Record<string, true>
  markItemRetrying: (id: string) => void
  clearItemRetrying: (id: string) => void
  refreshCurrentProject: (id: string) => Promise<void>
  // The `token` increments on every Edit click so consumers can react even
  // when the same image is targeted twice in a row. `restored` marks a target
  // re-applied because its keyframe became active again (not a fresh Edit
  // click) — consumers must not bring the CHAT tab forward for those.
  chatTarget: { item: ChatTargetItem; token: number; restored?: boolean } | null
  // `forget` additionally drops the per-keyframe memory of the target, so it
  // won't be restored when that keyframe is revisited (the user dismissed it).
  clearChatTarget: (forget?: boolean) => void
  openChatForItem: (item: ChatTargetItem) => void
}

const ProjectContext = React.createContext<ProjectContextValue | null>(null)

const ACTIVE_KEYFRAME_STORAGE_KEY = "palette:activeKeyFrameId"

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [currentProject, setCurrentProject] = React.useState<ProjectInfo | null>(null)
  const [projects, setProjects] = React.useState<ProjectInfo[]>([])
  // Restore the previously-selected keyframe from sessionStorage so a page
  // refresh stays on the same keyframe instead of bouncing back to the first
  // one.
  const [activeKeyFrameId, setActiveKeyFrameIdState] = React.useState<string | null>(() => {
    if (typeof window === "undefined") return null
    try {
      return window.sessionStorage.getItem(ACTIVE_KEYFRAME_STORAGE_KEY)
    } catch {
      return null
    }
  })

  const setActiveKeyFrameId = React.useCallback((id: string | null) => {
    setActiveKeyFrameIdState(id)
    if (typeof window === "undefined") return
    try {
      if (id) window.sessionStorage.setItem(ACTIVE_KEYFRAME_STORAGE_KEY, id)
      else window.sessionStorage.removeItem(ACTIVE_KEYFRAME_STORAGE_KEY)
    } catch {
      // ignore storage errors (private mode / quota)
    }
  }, [])

  const addProject = React.useCallback((project: ProjectInfo) => {
    setProjects((prev) => [project, ...prev])
  }, [])

  const [optimisticItems, setOptimisticItems] = React.useState<OptimisticGenerationItem[]>([])

  const addOptimisticItems = React.useCallback((items: OptimisticGenerationItem[]) => {
    if (items.length === 0) return
    setOptimisticItems((prev) => [...prev, ...items])
  }, [])

  const clearOptimisticBatch = React.useCallback((clientBatchId: string) => {
    setOptimisticItems((prev) => prev.filter((it) => it._clientBatchId !== clientBatchId))
  }, [])

  const [retryingItemIds, setRetryingItemIds] = React.useState<Record<string, true>>({})
  const markItemRetrying = React.useCallback((id: string) => {
    if (!id) return
    setRetryingItemIds((prev) => (prev[id] ? prev : { ...prev, [id]: true }))
  }, [])
  const clearItemRetrying = React.useCallback((id: string) => {
    setRetryingItemIds((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const chatTokenRef = React.useRef(0)
  const [chatTarget, setChatTarget] = React.useState<{
    item: ChatTargetItem
    token: number
    restored?: boolean
  } | null>(null)

  // Live views for callbacks/effects that must read the current selection
  // without re-binding.
  const currentProjectIdRef = React.useRef<string | null>(null)
  currentProjectIdRef.current = currentProject?.id ?? null
  const activeKfRef = React.useRef<string | null>(null)
  activeKfRef.current = activeKeyFrameId

  // Each keyframe remembers its own Edit target, so switching keyframes and
  // coming back restores the edit chat exactly as it was (until the page
  // reloads or the user dismisses the edit). Keyed `${projectId}:${kfId}`.
  const chatTargetByKfRef = React.useRef<Record<string, ChatTargetItem>>({})
  const kfKeyOf = (item?: ChatTargetItem | null) =>
    `${item?.project_id ?? currentProjectIdRef.current ?? ""}:${
      item?.key_frame_id ?? activeKfRef.current ?? ""
    }`

  const openChatForItem = React.useCallback((item: ChatTargetItem) => {
    // Stamp the target with its project/keyframe (when the caller didn't) so
    // per-keyframe memory and cross-project guards always have them.
    const enriched: ChatTargetItem = {
      ...item,
      project_id: item.project_id ?? currentProjectIdRef.current ?? undefined,
      key_frame_id: item.key_frame_id ?? activeKfRef.current ?? undefined,
    }
    chatTargetByKfRef.current[kfKeyOf(enriched)] = enriched
    chatTokenRef.current += 1
    setChatTarget({ item: enriched, token: chatTokenRef.current })
  }, [])

  const clearChatTarget = React.useCallback((forget = false) => {
    setChatTarget((prev) => {
      if (forget && prev) delete chatTargetByKfRef.current[kfKeyOf(prev.item)]
      return null
    })
  }, [])

  // Switching keyframe (or project) swaps in that keyframe's remembered Edit
  // target — or clears the anchor when it has none. Marked `restored` so the
  // control panel doesn't force the CHAT tab forward for it.
  const kfKey = `${currentProject?.id ?? ""}:${activeKeyFrameId ?? ""}`
  const prevKfKeyRef = React.useRef(kfKey)
  React.useEffect(() => {
    if (prevKfKeyRef.current === kfKey) return
    prevKfKeyRef.current = kfKey
    const remembered = chatTargetByKfRef.current[kfKey]
    if (remembered) {
      chatTokenRef.current += 1
      setChatTarget({ item: remembered, token: chatTokenRef.current, restored: true })
    } else {
      setChatTarget(null)
    }
  }, [kfKey])

  // Refetches a project's full payload so completed items land in
  // `currentProject.key_frames[].items` and flow into `seeded` inside
  // `useGenerationEvents`. Used as a fallback when SSE events don't arrive.
  const refreshCurrentProject = React.useCallback(async (id: string) => {
    if (!id) return
    try {
      const data = await apiRequest(`/projects/${id}`)
      setCurrentProject({
        id: data.id || id,
        name: data.name,
        client: data.client,
        type: data.type || "image",
        key_frames: data.key_frames || [],
        created_at: data.created_at,
        updated_at: data.updated_at,
      })
    } catch {
      // ignore refresh failures, next tick will retry
    }
  }, [])

  return (
    <ProjectContext.Provider
      value={{
        currentProject,
        setCurrentProject,
        projects,
        setProjects,
        addProject,
        activeKeyFrameId,
        setActiveKeyFrameId,
        optimisticItems,
        addOptimisticItems,
        clearOptimisticBatch,
        retryingItemIds,
        markItemRetrying,
        clearItemRetrying,
        refreshCurrentProject,
        chatTarget,
        openChatForItem,
        clearChatTarget,
      }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjectContext() {
  const ctx = React.useContext(ProjectContext)
  if (!ctx) throw new Error("useProjectContext must be used within ProjectProvider")
  return ctx
}
