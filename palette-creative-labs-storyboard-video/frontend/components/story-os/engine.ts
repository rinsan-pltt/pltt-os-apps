"use client"

// The story pipeline engine: everything that used to live inside the old
// StoryBoard component (per-scene image generation → motion prompts →
// per-scene clips → ffmpeg merge, with SSE-item syncing and auto-advance),
// lifted to an app-level hook that runs over ALL sessions at once. Screens
// stay purely presentational and call `actions` for the active session.
//
// Backend endpoints used (the complete long-video surface):
//   POST /generate/image      — scene images / style-anchor images
//   POST /story/video-prompts — per-scene motion prompts
//   POST /generate/video      — per-scene clips (source: "story_scene")
//   POST /story/merge         — ffmpeg concat into the final video

import * as React from "react"
import { apiRequest, resolveMediaUrl } from "@/lib/api-helper"
import { uploadReferenceImage } from "@/lib/gcs-upload-helper"
import type { GenerationItem } from "@/hooks/useGenerationEvents"
import {
  useStoryVideo,
  type SceneJobStatus,
  type StoryBible,
  type StoryContinuity,
  type StoryLlm,
  type StoryScene,
  type StorySession,
} from "@/components/providers/story-video-context"
import { imageModelOptions, videoModelOptions, getResolutionOptions } from "@/components/layout/video-helper"

export const makeGenerationId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// Freshest-state ranking when the same item arrives on both SSE channels.
export const STATUS_RANK: Record<string, number> = {
  completed: 3,
  failed: 3,
  in_progress: 2,
  started: 1,
  connected: 0,
}

const isDevHost =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(window.location.hostname)
export const storyVideoModels = videoModelOptions.filter((m) => isDevHost || m.value !== "ltx_video")
export const storyImageModels = imageModelOptions

// The LLM that writes the story/scenes (/story/plan) and motion prompts
// (/story/video-prompts). "Latest" per family as of this build: Opus 4.8,
// Sonnet 5.
export const storyLlmModels: { value: StoryLlm; label: string; version: string }[] = [
  { value: "claude_opus", label: "Claude Opus", version: "4.8" },
  { value: "claude_sonnet", label: "Claude Sonnet", version: "5" },
  { value: "claude_haiku", label: "Claude Haiku", version: "4.5" },
  { value: "gpt", label: "GPT", version: "5.5" },
  { value: "gemini", label: "Gemini", version: "3.1 Pro" },
]
export const DEFAULT_LLM: StoryLlm = "claude_sonnet"
export function llmLabel(llm: StoryLlm): string {
  const m = storyLlmModels.find((x) => x.value === llm)
  return m ? `${m.label} ${m.version}`.trim() : llm
}

// The image model accepts at most 8 reference images per generation. One slot
// is reserved for the previous scene's generated image (sequential
// consistency), so the run's own references/style-anchor are capped at 7.
export const MAX_INPUT_REFS = 7

export const DEFAULT_IMAGE_MODEL = imageModelOptions[0]?.value ?? "nano_banana_pro"
export const REF_IMAGE_MODEL = imageModelOptions.find((m) => m.reference)?.value ?? DEFAULT_IMAGE_MODEL
export const DEFAULT_VIDEO_MODEL = "kling_3_0_pro"

/** Resolution the scene clips (and the merge) run at: the user's quality
 * pick when the video model supports it, otherwise the best available. */
export function pickResolution(videoModel: string, quality?: string): string {
  const options = getResolutionOptions([videoModel])
  if (quality && options.includes(quality)) return quality
  if (options.includes("1080p")) return "1080p"
  if (options.includes("720p")) return "720p"
  return options[0] ?? "1080p"
}

// Providers reject durations outside their clip range (Seedance starts at 4s).
function clampSceneDuration(duration: number, videoModel: string): number {
  const min = videoModel === "seedance_2_0" ? 4 : 3
  return Math.min(Math.max(duration, min), 15)
}

// Keyframe bridging needs start+end frame support.
export function supportsEndFrame(videoModel: string): boolean {
  return videoModel.startsWith("kling") || videoModel === "seedance_2_0"
}

// Bridge ("seamless cuts") also needs the scene images themselves to stay
// visually consistent across the cut — Midjourney can't take image
// references (reference: false in its model entry), so consecutive scene
// images aren't conditioned on each other and a seamless bridge would just
// look like a jump cut anyway.
export function supportsBridge(session: Pick<StorySession, "videoModel" | "imageModel">): boolean {
  return supportsEndFrame(session.videoModel) && session.imageModel !== "midjourney"
}

export function effectiveContinuity(session: StorySession): StoryContinuity {
  const wanted = session.continuity ?? "bridge"
  if (wanted === "cinematic") return "cinematic"
  return wanted === "bridge" && supportsBridge(session) ? "bridge" : "independent"
}

export function masterImageUrls(session: StorySession): string[] {
  return (session.masterImages ?? [])
    .filter((m) => m.status === "completed" && m.url)
    .map((m) => m.url!)
}

function bibleImageBlock(bible?: StoryBible): string {
  if (!bible) return ""
  const parts = [
    bible.characters && `Characters: ${bible.characters}`,
    bible.environment && `Environment: ${bible.environment}`,
    bible.lighting && `Lighting: ${bible.lighting}`,
    bible.camera && `Camera: ${bible.camera}`,
    bible.grading && `Grade: ${bible.grading}`,
  ].filter(Boolean)
  return parts.length ? `\n\nGLOBAL STYLE — identical in every scene: ${parts.join(". ")}.` : ""
}

function bibleMotionLock(bible?: StoryBible): string {
  if (!bible) return ""
  const parts = [
    bible.camera && `Camera (locked): ${bible.camera}`,
    bible.lighting && `Lighting (locked): ${bible.lighting}`,
    bible.grading && `Grade (locked): ${bible.grading}`,
  ].filter(Boolean)
  return parts.length ? ` ${parts.join(". ")}.` : ""
}

// Explicit anti-drift guard: reference images alone don't reliably stop a
// model from quietly changing a fine visual detail (a shoe, a prop, an
// accessory) scene to scene — spelling it out targets exactly that failure
// mode on top of whatever reference images are actually attached.
const CHARACTER_CONSISTENCY_IMAGE =
  " CRITICAL CONSISTENCY: every character must look EXACTLY like their reference image(s) in this and every other scene — identical face, hairstyle, clothing, shoes/footwear and accessories. Do not alter, restyle or reinterpret any detail of a character's appearance unless the scene description explicitly calls for a change."

// Hard no-text guard appended to every generation prompt: AI models render
// written text misspelled and blurry, so none is ever requested.
const NO_TEXT_IMAGE =
  " STRICTLY NO TEXT in the image: no words, letters, numbers, captions, subtitles, watermarks, logos or readable signage of any kind."
const NO_TEXT_VIDEO =
  " Strictly no on-screen text: no titles, captions, subtitles, words, letters, watermarks or logos may appear at any point."

function jobStatusFromItem(it: GenerationItem): SceneJobStatus {
  if (it.status === "completed" && it.url) return "completed"
  if (it.status === "failed") return "failed"
  return "generating"
}

// The raw JSON /story/plan's background job produces (see plan_story in
// backend/api/routes/story_video.py) — identical whether it's read live from
// the job's own completion or recovered later from the stashed Item.
export interface RawPlanResult {
  status?: string
  title?: string
  story?: string
  master_prompt?: string
  bible?: StoryBible
  total_duration?: number
  scenes?: {
    index?: number
    title?: string
    duration: number
    image_prompt: string
    reference_urls?: string[]
  }[]
  references?: {
    index: number
    url: string
    analysis?: { kind?: string; name?: string; description?: string }
  }[]
}

/** Pure: applies a finished plan onto a session — shared by the initial
 * "Generate" flow and the Brief's "Regenerate" so a plan picked up live and
 * one recovered later (after a refresh, from the background job's stashed
 * result) land identically. Safe to apply unconditionally even for a
 * brand-new session: the merge/step/targetSceneCount resets below are no-ops
 * there since those fields are already blank. */
function applyPlanResult(prev: StorySession, res: RawPlanResult): StorySession {
  const planRefs = res.references ?? []
  const prevRefsByIndex = new Map((prev.references ?? []).map((r) => [r.index, r]))
  const scenes: StoryScene[] = (res.scenes ?? []).map((s, i) => ({
    index: s.index ?? i,
    title: s.title ?? `Scene ${i + 1}`,
    duration: s.duration,
    imagePrompt: s.image_prompt,
    videoPrompt: "",
    referenceUrls: s.reference_urls ?? [],
    imageStatus: "idle" as const,
    videoStatus: "idle" as const,
  }))
  const story = res.story ?? ""
  const totalDuration = res.total_duration ?? prev.totalDuration
  return {
    ...prev,
    title: (res.title as string | undefined)?.trim() || prev.title,
    story,
    bible:
      res.bible && typeof res.bible === "object" && Object.keys(res.bible).length
        ? res.bible
        : prev.bible,
    masterPrompt: (res.master_prompt as string | undefined) || prev.masterPrompt,
    totalDuration,
    references: planRefs.map((r) => ({
      index: r.index,
      url: r.url,
      // file:// dev-storage urls can't render in <img>; keep the local
      // object-URL preview for display.
      previewUrl: prevRefsByIndex.get(r.index)?.previewUrl ?? r.url,
      kind: r.analysis?.kind,
      name: r.analysis?.name,
      description: r.analysis?.description,
    })),
    step: "plan",
    scenes,
    targetSceneCount: undefined,
    // Discard any stale merged video / motion prompts — a fresh plan means
    // the scenes themselves (and everything generated from them) are new.
    mergeGenId: undefined,
    mergeStatus: undefined,
    mergeError: undefined,
    finalUrl: undefined,
    finalThumbnailUrl: undefined,
    planBaseline: {
      prompt: prev.prompt,
      story,
      totalDuration,
      aspectRatio: prev.aspectRatio,
      sceneCount: scenes.length,
    },
    planningStatus: undefined,
    planGenId: undefined,
  }
}

/** Pure: fold the freshest generation items into a session (scene image /
 * clip statuses, style-anchor images, merge → done). Returns the SAME object
 * when nothing changed so callers can skip no-op updates. */
function syncSession(prev: StorySession, byGenId: Map<string, GenerationItem>): StorySession {
  let changed = false
  const scenes = prev.scenes.map((s) => {
    let next = s
    if (s.imageGenId) {
      const it = byGenId.get(s.imageGenId)
      if (it && it.type !== "video") {
        const status = jobStatusFromItem(it)
        const url = status === "completed" ? it.url : s.imageUrl
        const err = status === "failed" ? (it.error ?? it.error_message) : undefined
        if (status !== s.imageStatus || url !== s.imageUrl || err !== s.imageError) {
          next = { ...next, imageStatus: status, imageUrl: url, imageError: err }
        }
      }
    }
    if (s.videoGenId) {
      const it = byGenId.get(s.videoGenId)
      if (it) {
        const status = jobStatusFromItem(it)
        const url = status === "completed" ? it.url : s.videoUrl
        const err = status === "failed" ? (it.error ?? it.error_message) : undefined
        if (status !== s.videoStatus || url !== s.videoUrl || err !== s.videoError) {
          next = { ...next, videoStatus: status, videoUrl: url, videoError: err }
        }
      }
    }
    if (next !== s) changed = true
    return next
  })

  let { mergeStatus, mergeError, finalUrl, finalThumbnailUrl, step } = prev
  if (prev.mergeGenId) {
    const it = byGenId.get(prev.mergeGenId)
    if (it) {
      const status = jobStatusFromItem(it)
      if (status === "completed" && it.url && status !== prev.mergeStatus) {
        mergeStatus = "completed"
        finalUrl = it.url
        finalThumbnailUrl = it.thumbnail_url
        step = "done"
      } else if (status === "failed" && prev.mergeStatus !== "failed") {
        mergeStatus = "failed"
        mergeError = it.error ?? it.error_message
      }
    }
  }

  let masterChanged = false
  const masterImages = (prev.masterImages ?? []).map((m) => {
    if (!m.genId) return m
    const it = byGenId.get(m.genId)
    if (!it || it.type === "video") return m
    const status = jobStatusFromItem(it)
    const url = status === "completed" ? it.url : m.url
    if (status !== m.status || url !== m.url) {
      masterChanged = true
      return { ...m, status, url }
    }
    return m
  })

  // /story/plan runs as a background job (see backend/api/routes/
  // story_video.py's plan_story) precisely so this can recover a plan that
  // finished after the browser that requested it disconnected (refresh) —
  // the same generation-id lookup scene/merge completions already use here.
  let planned: StorySession | null = null
  if (prev.planGenId) {
    const it = byGenId.get(prev.planGenId)
    if (it) {
      const status = jobStatusFromItem(it)
      if (status === "completed" && it.gen_params && prev.planningStatus !== undefined) {
        planned = applyPlanResult(prev, it.gen_params as RawPlanResult)
      } else if (status === "failed" && prev.planningStatus !== "failed") {
        planned = {
          ...prev,
          planningStatus: "failed",
          planningError: it.error ?? it.error_message,
          planGenId: undefined,
        }
      }
    }
  }

  if (
    !changed &&
    !masterChanged &&
    !planned &&
    mergeStatus === prev.mergeStatus &&
    mergeError === prev.mergeError &&
    finalUrl === prev.finalUrl &&
    finalThumbnailUrl === prev.finalThumbnailUrl &&
    step === prev.step
  ) {
    return prev
  }
  const base = planned ?? prev
  return {
    ...base,
    scenes: planned ? base.scenes : scenes,
    mergeStatus: planned ? base.mergeStatus : mergeStatus,
    mergeError: planned ? base.mergeError : mergeError,
    finalUrl: planned ? base.finalUrl : finalUrl,
    finalThumbnailUrl: planned ? base.finalThumbnailUrl : finalThumbnailUrl,
    step: planned ? base.step : step,
    masterImages,
  }
}

const SCENE_STATUS_RANK: Record<SceneJobStatus, number> = {
  idle: 0,
  generating: 1,
  failed: 2,
  completed: 3,
}

/** Pure: pull forward any scene/merge progress the SERVER already has on
 * record that the live in-memory session hasn't picked up — the same gap a
 * manual page refresh closes (the initial load simply replaces local state
 * with whatever's persisted), but applied to a single already-open session
 * without discarding in-flight local edits (prompts/title/references, which
 * this never touches). Only ever moves state FORWARD (idle < generating <
 * failed < completed, and stage-wise storyboard < animate < publish), so a
 * resync can't regress a scene the client already knows finished. */
function reconcileFromServer(prev: StorySession, server: StorySession): StorySession {
  let changed = false
  const scenes = prev.scenes.map((s) => {
    const srv = server.scenes.find((x) => x.index === s.index)
    if (!srv) return s
    let next = s
    if ((SCENE_STATUS_RANK[srv.imageStatus] ?? 0) > (SCENE_STATUS_RANK[s.imageStatus] ?? 0)) {
      next = { ...next, imageStatus: srv.imageStatus, imageUrl: srv.imageUrl ?? next.imageUrl, imageError: srv.imageError }
    }
    if ((SCENE_STATUS_RANK[srv.videoStatus] ?? 0) > (SCENE_STATUS_RANK[s.videoStatus] ?? 0)) {
      next = { ...next, videoStatus: srv.videoStatus, videoUrl: srv.videoUrl ?? next.videoUrl, videoError: srv.videoError }
    }
    if (next !== s) changed = true
    return next
  })

  let { step, mergeStatus, mergeError, finalUrl, finalThumbnailUrl } = prev
  if (stageIndex(reachedStage(server)) > stageIndex(reachedStage(prev))) {
    ;({ step, mergeStatus, mergeError, finalUrl, finalThumbnailUrl } = server)
    changed = true
  }

  if (!changed) return prev
  return { ...prev, scenes, step, mergeStatus, mergeError, finalUrl, finalThumbnailUrl }
}

export interface SessionActions {
  updateScene: (index: number, patch: Partial<StoryScene>) => void
  patchSession: (patch: Partial<StorySession>) => void
  // Re-run /story/plan from the current (edited) idea/concept/duration/ratio/
  // scene count, rebuilding the whole run from the plan and resetting it to
  // the "plan" step. Used by the Brief's "Regenerate" CTA.
  regeneratePlan: () => Promise<void>
  generateImages: () => Promise<void>
  // Regenerates only the scenes whose prompt has been edited since their
  // image was made — the Storyboard footer's "Regenerate" button.
  regenerateStaleImages: () => Promise<void>
  // `promptOverride`, when given, replaces the STARTING scene's image prompt
  // before regenerating (used by the scene chat: "make the sky orange" edits
  // the prompt and regenerates in one step, atomically — no risk of the
  // regen firing before a separate prompt update has landed in state).
  regenerateImage: (scene: StoryScene, promptOverride?: string) => Promise<void>
  generateVideoPrompts: (force?: boolean) => Promise<void>
  generateVideos: () => Promise<void>
  retryVideo: (scene: StoryScene) => Promise<void>
  // Re-runs every scene whose clip currently failed, in parallel (each clip
  // is independent once its start/end images are fixed, unlike the
  // sequential image chain) — the footer's "Retry all clips" button.
  retryAllFailedVideos: () => Promise<void>
  runMerge: () => Promise<void>
  generateMaster: () => Promise<void>
  uploadMasterImage: (file: File) => Promise<void>
  removeMasterImage: (id: string) => void
  // Add a reference image to the run's cast (upload → analyse → attach to
  // every scene) / remove one (also detaches it from all scenes).
  addReference: (file: File) => Promise<void>
  removeReference: (index: number) => void
  // Permanently remove one scene (Storyboard's per-tile menu). Remaining
  // scenes are re-indexed to stay contiguous (0..N-1) since ordering/bridge
  // lookups assume that, and the run's totalDuration shrinks to match.
  // No-ops on the last remaining scene — a run can't have zero scenes.
  deleteScene: (index: number) => void
  // Adds a scene the user supplies directly (an uploaded image or video —
  // e.g. a closing "thank you" card) rather than one written/generated
  // through the AI pipeline. Appended at the end of the timeline; the user
  // can then moveScene() it wherever they actually want it. Ready to merge
  // immediately (image is looped into a short silent-track clip server-
  // side; video is used as-is) — no separate generate step needed.
  addUploadedScene: (file: File) => Promise<void>
  // Swaps a scene with its immediate left/right neighbor in play order —
  // Animate's scene-position control. Re-indexes both (and everything
  // else stays put) so ordering/bridge lookups keep working unchanged.
  moveScene: (index: number, direction: "left" | "right") => void
}

export interface StoryEngine {
  sessions: StorySession[]
  loaded: boolean
  addSession: (s: StorySession) => void
  updateSession: (
    id: string,
    updater: StorySession | ((prev: StorySession) => StorySession),
  ) => void
  resyncSession: (id: string) => Promise<void>
  removeSession: (id: string) => void
  byGenId: Map<string, GenerationItem>
  actionsFor: (id: string) => SessionActions
  writingPrompts: Set<string>
  promptsFailed: Set<string>
  onError: (title: string, err: unknown) => void
}

export function useStoryEngine(
  items: GenerationItem[],
  onError: (title: string, err: unknown) => void,
): StoryEngine {
  const { sessions, addSession, updateSession, removeSession, loaded } = useStoryVideo()

  const byGenId = React.useMemo(() => {
    const m = new Map<string, GenerationItem>()
    for (const it of items) {
      if (!it.generation_id) continue
      const prev = m.get(it.generation_id)
      if (!prev || (STATUS_RANK[it.status] ?? 0) >= (STATUS_RANK[prev.status] ?? 0)) {
        m.set(it.generation_id, it)
      }
    }
    return m
  }, [items])

  // ---- Sync live items into every session --------------------------------
  React.useEffect(() => {
    for (const s of sessions) {
      const next = syncSession(s, byGenId)
      if (next !== s) {
        // A plan (fresh or re-plan) just landed here — re-arm the prompts
        // auto-advance guard, since whatever it had already fired for
        // belonged to the previous (now-replaced) scenes.
        if (s.planningStatus === "generating" && next.planningStatus === undefined) {
          promptsRequestedRef.current.delete(s.id)
        }
        updateSession(s.id, next)
      }
    }
  }, [sessions, byGenId, updateSession])

  // Session lookup by id that async closures can trust to be fresh.
  const sessionsRef = React.useRef(sessions)
  sessionsRef.current = sessions

  // ---- Reliability net: poll pending generations --------------------------
  // The story flow is standalone (items have no project_id), so it relies on
  // the user-channel SSE stream. In a multi-worker backend the "completed"/
  // "failed" event can be delivered to a different worker than the browser's
  // EventSource and never reach it, leaving a run stuck on "rendering".
  // While anything is pending, poll each generation by id and merge terminal
  // results straight into the sessions (SSE still gives instant updates when
  // it does arrive; this only fills the gaps).
  React.useEffect(() => {
    let stopped = false
    const pendingGenIds = (): string[] => {
      const ids = new Set<string>()
      for (const s of sessionsRef.current) {
        for (const sc of s.scenes) {
          if (sc.imageStatus === "generating" && sc.imageGenId) ids.add(sc.imageGenId)
          if (sc.videoStatus === "generating" && sc.videoGenId) ids.add(sc.videoGenId)
        }
        for (const m of s.masterImages ?? []) {
          if (m.status === "generating" && m.genId) ids.add(m.genId)
        }
        if (s.mergeStatus === "generating" && s.mergeGenId) ids.add(s.mergeGenId)
        if (s.planningStatus === "generating" && s.planGenId) ids.add(s.planGenId)
      }
      return [...ids]
    }
    const tick = async () => {
      const ids = pendingGenIds()
      if (ids.length === 0) return
      const results = await Promise.all(
        ids.map((gid) =>
          apiRequest(`/story/generation/${gid}`)
            .then((r) => (r?.items ?? []) as GenerationItem[])
            .catch(() => [] as GenerationItem[]),
        ),
      )
      if (stopped) return
      const m = new Map<string, GenerationItem>()
      for (const it of results.flat()) {
        if (!it.generation_id) continue
        const prev = m.get(it.generation_id)
        if (!prev || (STATUS_RANK[it.status] ?? 0) >= (STATUS_RANK[prev.status] ?? 0)) {
          m.set(it.generation_id, it)
        }
      }
      if (m.size === 0) return
      for (const s of sessionsRef.current) {
        const next = syncSession(s, m)
        if (next !== s) updateSession(s.id, next)
      }
    }
    const interval = setInterval(tick, 3000)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [updateSession])

  // Continuity fallback: "bridge" needs end-frame support (and, for the
  // scene images to actually match at the cut, an image model that isn't
  // Midjourney — see supportsBridge).
  React.useEffect(() => {
    for (const s of sessions) {
      if ((s.continuity ?? "bridge") === "bridge" && !supportsBridge(s)) {
        updateSession(s.id, (prev) => ({ ...prev, continuity: "independent" }))
      }
    }
  }, [sessions, updateSession])

  // Anchored sessions (references or completed style anchors) must use a
  // reference-capable image model.
  React.useEffect(() => {
    for (const s of sessions) {
      const anchored = (s.references?.length ?? 0) > 0 || masterImageUrls(s).length > 0
      if (!anchored) continue
      const capable = imageModelOptions.filter((m) => m.reference)
      if (capable.some((m) => m.value === s.imageModel)) continue
      const fallback = capable[0]?.value
      if (fallback) updateSession(s.id, (prev) => ({ ...prev, imageModel: fallback }))
    }
  }, [sessions, updateSession])

  // ---- Async step trackers ------------------------------------------------
  const [writingPrompts, setWritingPrompts] = React.useState<Set<string>>(new Set())
  const [promptsFailed, setPromptsFailed] = React.useState<Set<string>>(new Set())
  const promptsRequestedRef = React.useRef<Set<string>>(new Set())

  const setInSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    setter((prev) => {
      const has = prev.has(id)
      if (has === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // Session lookup by id that async closures can trust to be fresh
  // (sessionsRef is declared with the polling effect above and kept current).
  const getSession = React.useCallback((id: string) => sessionsRef.current.find((s) => s.id === id), [])

  // Re-confirm one session against what's actually persisted — a lightweight
  // version of what a full page refresh already does (the initial load just
  // replaces local state with the server's copy). Called whenever the user
  // switches to view a run/stage, so a completion the live SSE/poll sync
  // missed (e.g. while the user was looking at a different stage) still shows
  // up without requiring a manual reload.
  const resyncSession = React.useCallback(
    async (id: string) => {
      try {
        const res = await apiRequest("/story/session")
        const rows: { data?: StorySession }[] = res?.sessions ?? []
        const server = rows.find((r) => r.data?.id === id)?.data
        if (!server) return
        updateSession(id, (prev) => reconcileFromServer(prev, server))
      } catch {
        // Best-effort — leave whatever's already on screen if this fails.
      }
    },
    [updateSession],
  )

  // Resolve once a scene's image finishes (completed → its url, failed/timeout
  // → null). Reads the live session, which the SSE-sync effect keeps current,
  // so the sequential chain can hand each image to the next scene.
  const waitForSceneImage = React.useCallback(
    (id: string, index: number, timeoutMs = 180000) =>
      new Promise<string | null>((resolve) => {
        const t0 = Date.now()
        const tick = () => {
          const s = getSession(id)?.scenes.find((x) => x.index === index)
          if (!s) return resolve(null)
          if (s.imageStatus === "completed" && s.imageUrl) return resolve(s.imageUrl)
          if (s.imageStatus === "failed") return resolve(null)
          if (Date.now() - t0 > timeoutMs) return resolve(null)
          setTimeout(tick, 500)
        }
        tick()
      }),
    [getSession],
  )

  // ---- Actions -------------------------------------------------------------

  const postSceneImage = React.useCallback(
    async (
      session: StorySession,
      scene: StoryScene,
      genId: string,
      prevImageUrl?: string,
      // The first scene's own image — a stable "ground truth" for the
      // cast's exact look, kept alongside (not instead of) the rolling
      // previous-scene reference below. Without this, any drift a single
      // hop introduces (an accidentally-restyled shoe, say) quietly becomes
      // the new baseline for every scene chained after it; anchoring back
      // to scene one on every generation stops that compounding.
      anchorImageUrl?: string,
    ) => {
      try {
        // Continuity refs: up to 2 (anchor + previous scene) reserved out of
        // the model's 8-reference limit, cast/style refs fill the rest.
        const continuityRefs = [
          ...(anchorImageUrl && anchorImageUrl !== prevImageUrl ? [anchorImageUrl] : []),
          ...(prevImageUrl ? [prevImageUrl] : []),
        ]
        const baseRefs = (scene.referenceUrls?.length ? scene.referenceUrls : masterImageUrls(session)).slice(
          0,
          Math.max(0, MAX_INPUT_REFS + 1 - continuityRefs.length),
        )
        const refs = [...baseRefs, ...continuityRefs]
        await apiRequest("/generate/image", {
          method: "POST",
          body: JSON.stringify({
            models: [session.imageModel],
            prompt:
              scene.imagePrompt + bibleImageBlock(session.bible) + CHARACTER_CONSISTENCY_IMAGE + NO_TEXT_IMAGE,
            generation_id: genId,
            params: { aspect_ratio: session.aspectRatio, resolution: "hd", num_images: 1 },
            ...(refs.length ? { image_references: refs.map((url) => ({ url })) } : {}),
          }),
        })
      } catch (err) {
        updateSession(session.id, (prev) => ({
          ...prev,
          scenes: prev.scenes.map((s) =>
            s.index === scene.index
              ? { ...s, imageStatus: "failed", imageError: err instanceof Error ? err.message : String(err) }
              : s,
          ),
        }))
      }
    },
    [updateSession],
  )

  const generateVideoPrompts = React.useCallback(
    async (id: string, force = false) => {
      const session = getSession(id)
      if (!session) return
      setInSet(setWritingPrompts, id, true)
      setInSet(setPromptsFailed, id, false)
      const forContinuity = effectiveContinuity(session)
      const forVideoModel = session.videoModel
      const forAudio = session.audio ?? "generated"
      try {
        const res = await apiRequest("/story/video-prompts", {
          method: "POST",
          body: JSON.stringify({
            prompt: session.prompt,
            story: session.story,
            continuity: forContinuity,
            video_model: forVideoModel,
            audio: forAudio,
            llm: session.llmModel ?? DEFAULT_LLM,
            ...(session.bible ? { bible: session.bible } : {}),
            scenes: session.scenes.map((s) => ({
              index: s.index,
              title: s.title,
              duration: s.duration,
              image_prompt: s.imagePrompt,
            })),
          }),
        })
        const byIdx = new Map<number, string>(
          (res?.scenes ?? []).map((s: { index: number; video_prompt: string }) => [s.index, s.video_prompt]),
        )
        updateSession(id, (prev) => ({
          ...prev,
          step: "video-prompts",
          promptsFor: { continuity: forContinuity, videoModel: forVideoModel, audio: forAudio },
          scenes: prev.scenes.map((s) => ({
            ...s,
            videoPrompt: force
              ? (byIdx.get(s.index) ?? s.videoPrompt)
              : s.videoPrompt || byIdx.get(s.index) || s.imagePrompt,
          })),
        }))
      } catch (err) {
        promptsRequestedRef.current.delete(id)
        setInSet(setPromptsFailed, id, true)
        onError("motion-prompts", err)
      } finally {
        setInSet(setWritingPrompts, id, false)
      }
    },
    [getSession, updateSession, onError],
  )

  const postSceneVideo = React.useCallback(
    async (session: StorySession, scene: StoryScene) => {
      try {
        const continuity = effectiveContinuity(session)
        const bridging = continuity === "bridge" || (continuity === "cinematic" && supportsBridge(session))
        const nextScene = bridging ? session.scenes.find((s) => s.index === scene.index + 1) : undefined
        const res = await apiRequest("/generate/video", {
          method: "POST",
          body: JSON.stringify({
            models: [session.videoModel],
            prompt: (scene.videoPrompt || scene.imagePrompt) + bibleMotionLock(session.bible) + NO_TEXT_VIDEO,
            aspect_ratio: session.aspectRatio,
            duration: `${clampSceneDuration(scene.duration, session.videoModel)}s`,
            start_image: scene.imageUrl,
            ...(nextScene?.imageUrl ? { end_image: nextScene.imageUrl } : {}),
            source: "story_scene",
            params: {
              resolution: pickResolution(session.videoModel, session.quality),
              // Model-native audio only for "generated" — every other mode
              // (silent, and the ElevenLabs-backed music/voiceover/captions
              // modes) needs the clip itself silent so the merge step's
              // generated narration/music is the only audio track.
              audio: (session.audio ?? "generated") === "generated",
            },
          }),
        })
        updateSession(session.id, (prev) => ({
          ...prev,
          scenes: prev.scenes.map((s) =>
            s.index === scene.index ? { ...s, videoGenId: res?.generation_id } : s,
          ),
        }))
      } catch (err) {
        updateSession(session.id, (prev) => ({
          ...prev,
          scenes: prev.scenes.map((s) =>
            s.index === scene.index
              ? { ...s, videoStatus: "failed", videoError: err instanceof Error ? err.message : String(err) }
              : s,
          ),
        }))
      }
    },
    [updateSession],
  )

  const runMerge = React.useCallback(
    async (id: string) => {
      const session = getSession(id)
      if (!session) return
      try {
        // `session.scenes`' own array order isn't guaranteed to match play
        // order (adding/reordering scenes doesn't reshuffle the array,
        // just each scene's `.index`) — every consumer of scene ORDER walks
        // a copy sorted by `.index` instead; this is the one place that
        // didn't (video_urls has no index metadata for the backend to
        // recover it from), so a reordered run would merge clips out of
        // sequence.
        const ordered = [...session.scenes].sort((a, b) => a.index - b.index)
        const res = await apiRequest("/story/merge", {
          method: "POST",
          body: JSON.stringify({
            video_urls: ordered.map((s) => s.videoUrl),
            prompt: session.prompt,
            aspect_ratio: session.aspectRatio,
            resolution: pickResolution(session.videoModel, session.quality),
            duration: String(session.totalDuration),
            scenes: ordered.map((s) => ({
              index: s.index,
              title: s.title,
              duration: s.duration,
              image_prompt: s.imagePrompt,
              video_prompt: s.videoPrompt,
            })),
            audio_mode: session.audio ?? "generated",
            music_prompt: session.musicPrompt,
            // The story synopsis, for the backend to auto-write a narration
            // script from when narration_text is blank — sized to the
            // ACTUAL merged runtime (which the backend measures directly),
            // not whatever was planned, since adding/removing/reordering
            // scenes on Animate can change the real total freely.
            story: session.story,
            narration_text: session.narrationText?.trim() || undefined,
            narration_voice_id: session.narrationVoiceId,
            // Korean by default — this app is built for Korean users first
            // (see audio-settings-dialog.tsx's DEFAULT_NARRATION_LANGUAGE).
            narration_language: session.narrationLanguage ?? "ko",
            llm: session.llmModel ?? DEFAULT_LLM,
            captions_enabled: session.audio === "voiceover_music" ? (session.captionsEnabled ?? true) : false,
          }),
        })
        updateSession(id, (prev) => ({
          ...prev,
          step: "merging",
          mergeGenId: res?.generation_id,
          mergeStatus: "generating",
          mergeError: undefined,
        }))
      } catch (err) {
        updateSession(id, (prev) => ({
          ...prev,
          mergeStatus: "failed",
          mergeError: err instanceof Error ? err.message : String(err),
        }))
        onError("merge", err)
      }
    },
    [getSession, updateSession, onError],
  )

  // ---- Auto-advance --------------------------------------------------------

  // Images all done → write motion prompts (once per session).
  React.useEffect(() => {
    for (const s of sessions) {
      if (s.step !== "images") continue
      if (!s.scenes.every((sc) => sc.imageStatus === "completed" && sc.imageUrl)) continue
      if (promptsRequestedRef.current.has(s.id)) continue
      promptsRequestedRef.current.add(s.id)
      void generateVideoPrompts(s.id)
    }
  }, [sessions, generateVideoPrompts])

  // Deliberately no "clips all done → merge" auto-advance here: merging (and
  // the narration/music/captions layered onto it) only starts once the user
  // explicitly clicks "Go to Publish" — see allClipsDone() below and
  // app.tsx's onGoPublish — so they can still regenerate any scene's clip
  // right up until then without a merge already having consumed the old one.

  // ---- Per-session action bundle ------------------------------------------
  const actionsFor = React.useCallback(
    (id: string): SessionActions => {
      const update = (updater: (prev: StorySession) => StorySession) => updateSession(id, updater)
      return {
        updateScene: (index, patch) =>
          update((prev) => ({
            ...prev,
            scenes: prev.scenes.map((s) => (s.index === index ? { ...s, ...patch } : s)),
          })),
        patchSession: (patch) => update((prev) => ({ ...prev, ...patch })),
        regeneratePlan: async () => {
          const session = getSession(id)
          if (!session) return
          const references = (session.references ?? [])
            .filter((r) => r.url)
            .map((r) => ({
              index: r.index,
              url: r.url,
              analysis: { kind: r.kind, name: r.name, description: r.description },
            }))
          const editedStory =
            session.story && session.story !== session.planBaseline?.story ? session.story : undefined
          try {
            // Runs as a background job, same as the initial plan — the
            // result lands later via syncSession/applyPlanResult (which also
            // re-arms the prompts/merge auto-advance guards once it applies,
            // in the "sync live items" effect below), so this survives a
            // refresh instead of losing the re-plan if the connection drops.
            const res = await apiRequest("/story/plan", {
              method: "POST",
              body: JSON.stringify({
                prompt: session.prompt,
                duration: session.totalDuration,
                aspect_ratio: session.aspectRatio,
                llm: session.llmModel ?? DEFAULT_LLM,
                ...(references.length ? { references } : {}),
                ...(session.targetSceneCount ? { scenes: session.targetSceneCount } : {}),
                ...(editedStory ? { story: editedStory } : {}),
              }),
            })
            update((prev) => ({
              ...prev,
              planGenId: res?.generation_id,
              planningStatus: "generating",
              planningError: undefined,
            }))
          } catch (err) {
            update((prev) => ({
              ...prev,
              planningStatus: "failed",
              planningError: err instanceof Error ? err.message : String(err),
            }))
            onError("regenerate", err)
            throw err
          }
        },
        // Generate every scene image SEQUENTIALLY: each scene is generated
        // from the previous scene's finished image (plus the run's
        // references/anchor), so characters and look stay consistent across
        // the whole board. Runs the full chain each time it's invoked.
        generateImages: async () => {
          const session = getSession(id)
          if (!session) return
          promptsRequestedRef.current.delete(id)
          const order = [...session.scenes].sort((a, b) => a.index - b.index)
          // Reset the whole board to a clean pending state up front — except
          // any uploaded scene the user hasn't asked to AI-generate over.
          update((prev) => ({
            ...prev,
            step: "images",
            scenes: prev.scenes.map((s) =>
              isProtectedUpload(s, "imagePrompt")
                ? s
                : {
                    ...s,
                    imageGenId: undefined,
                    imageStatus: "idle" as const,
                    imageUrl: undefined,
                    imageError: undefined,
                    imagePromptUsed: undefined,
                  },
            ),
          }))
          let prevImageUrl: string | undefined
          // The first scene's OWN image, set once and never overwritten —
          // the stable "ground truth" every later scene also anchors to
          // (see postSceneImage's anchorImageUrl), on top of the rolling
          // previous-scene reference.
          let anchorImageUrl: string | undefined
          for (const s of order) {
            const cur = getSession(id)
            const scene = cur?.scenes.find((x) => x.index === s.index)
            if (!cur || !scene) break
            if (isProtectedUpload(scene, "imagePrompt")) {
              // Leave it exactly as uploaded — just fold its image into the
              // chain so scenes after it still have something to anchor to.
              if (scene.imageUrl) {
                prevImageUrl = scene.imageUrl
                if (anchorImageUrl === undefined) anchorImageUrl = scene.imageUrl
              }
              continue
            }
            const genId = makeGenerationId()
            update((prev) => ({
              ...prev,
              scenes: prev.scenes.map((x) =>
                x.index === s.index
                  ? {
                      ...x,
                      imageGenId: genId,
                      imageStatus: "generating" as const,
                      imageUrl: undefined,
                      imageError: undefined,
                      imagePromptUsed: x.imagePrompt,
                      imageModelUsed: cur.imageModel,
                    }
                  : x,
              ),
            }))
            await postSceneImage(cur, scene, genId, prevImageUrl, anchorImageUrl)
            const url = await waitForSceneImage(id, s.index)
            if (url) {
              prevImageUrl = url // keep last good image as the anchor
              if (anchorImageUrl === undefined) anchorImageUrl = url
            }
          }
        },
        // Regenerates ONLY scenes whose prompt was edited since their image
        // was made (isSceneStale) — every other scene's image is left
        // completely untouched, unlike generateImages (wipes everything) and
        // regenerateImage (cascades forward from one scene through the rest).
        // Each stale scene still anchors off whatever its predecessor's
        // image currently is, so two adjacent edited scenes stay consistent
        // with each other even though nothing in between was touched.
        regenerateStaleImages: async () => {
          const session = getSession(id)
          if (!session) return
          promptsRequestedRef.current.delete(id)
          const order = [...session.scenes].sort((a, b) => a.index - b.index)
          const staleIndices = new Set(order.filter((s) => isSceneStale(session, s)).map((s) => s.index))
          if (staleIndices.size === 0) return
          update((prev) => ({
            ...prev,
            step: prev.step === "video-prompts" ? "images" : prev.step,
            scenes: prev.scenes.map((x) =>
              staleIndices.has(x.index)
                ? {
                    ...x,
                    imageGenId: undefined,
                    imageStatus: "idle" as const,
                    imageUrl: undefined,
                    imageError: undefined,
                    imagePromptUsed: undefined,
                  }
                : x,
            ),
          }))
          for (let pos = 0; pos < order.length; pos++) {
            const s = order[pos]
            if (!staleIndices.has(s.index)) continue
            const cur = getSession(id)
            const scene = cur?.scenes.find((x) => x.index === s.index)
            if (!cur || !scene) break
            const prevImageUrl =
              pos > 0 ? cur.scenes.find((x) => x.index === order[pos - 1].index)?.imageUrl : undefined
            // Read live each iteration in case scene one is ALSO stale and
            // just got regenerated earlier in this same pass — later scenes
            // then anchor to its fresh image, not the pre-regen one.
            const anchorImageUrl =
              pos > 0 ? cur.scenes.find((x) => x.index === order[0].index)?.imageUrl : undefined
            const genId = makeGenerationId()
            update((prev) => ({
              ...prev,
              scenes: prev.scenes.map((x) =>
                x.index === s.index
                  ? {
                      ...x,
                      imageGenId: genId,
                      imageStatus: "generating" as const,
                      imageUrl: undefined,
                      imageError: undefined,
                      imagePromptUsed: x.imagePrompt,
                      imageModelUsed: cur.imageModel,
                    }
                  : x,
              ),
            }))
            await postSceneImage(cur, scene, genId, prevImageUrl, anchorImageUrl)
            await waitForSceneImage(id, s.index)
          }
        },
        // Re-runs the chain FROM a given scene onward (its predecessor's image
        // is the anchor), so downstream scenes stay consistent with the edit.
        regenerateImage: async (scene, promptOverride) => {
          const session = getSession(id)
          if (!session) return
          promptsRequestedRef.current.delete(id)
          const order = [...session.scenes].sort((a, b) => a.index - b.index)
          const startPos = order.findIndex((s) => s.index === scene.index)
          if (startPos < 0) return
          // A regenerated frame steps the flow back to the image step. An
          // uploaded scene in the cascade is skipped UNLESS it's the exact
          // target and promptOverride gives it something to actually
          // generate from — same "leave it alone until asked" rule as
          // generateImages.
          update((prev) => ({
            ...prev,
            step: prev.step === "video-prompts" ? "images" : prev.step,
            scenes: prev.scenes.map((x) => {
              if (!order.slice(startPos).some((o) => o.index === x.index)) return x
              const promptAfterOverride =
                promptOverride !== undefined && x.index === scene.index ? promptOverride : x.imagePrompt
              if (x.sceneKind === "uploaded" && !promptAfterOverride.trim()) return x
              return {
                ...x,
                // Applied in this SAME update, before the generation loop
                // below reads the session back — no race with a caller
                // that just called updateScene separately.
                ...(promptOverride !== undefined && x.index === scene.index
                  ? { imagePrompt: promptOverride }
                  : {}),
                imageGenId: undefined,
                imageStatus: "idle" as const,
                imageUrl: undefined,
                imageError: undefined,
                imagePromptUsed: undefined,
              }
            }),
          }))
          // Anchor from the scene just before the start of the re-chain.
          let prevImageUrl =
            startPos > 0
              ? getSession(id)?.scenes.find((x) => x.index === order[startPos - 1].index)?.imageUrl
              : undefined
          for (const s of order.slice(startPos)) {
            const cur = getSession(id)
            const sc = cur?.scenes.find((x) => x.index === s.index)
            if (!cur || !sc) break
            if (isProtectedUpload(sc, "imagePrompt")) {
              if (sc.imageUrl) prevImageUrl = sc.imageUrl
              continue
            }
            // Scene one's own regen (startPos 0's first iteration) has
            // nothing to anchor to yet; every scene after that anchors to
            // whatever scene one's live image currently is.
            const anchorImageUrl =
              s.index === order[0].index
                ? undefined
                : cur.scenes.find((x) => x.index === order[0].index)?.imageUrl
            const genId = makeGenerationId()
            update((prev) => ({
              ...prev,
              scenes: prev.scenes.map((x) =>
                x.index === s.index
                  ? {
                      ...x,
                      imageGenId: genId,
                      imageStatus: "generating" as const,
                      imageUrl: undefined,
                      imageError: undefined,
                      imagePromptUsed: x.imagePrompt,
                      imageModelUsed: cur.imageModel,
                    }
                  : x,
              ),
            }))
            await postSceneImage(cur, sc, genId, prevImageUrl, anchorImageUrl)
            const url = await waitForSceneImage(id, s.index)
            if (url) prevImageUrl = url
          }
        },
        generateVideoPrompts: (force = false) => generateVideoPrompts(id, force),
        generateVideos: async () => {
          let session = getSession(id)
          if (!session) return
          // Continuity/model/audio may have changed since the motion prompts
          // were last written (e.g. switching to Cinematic) — rewrite them
          // now, at click-time, rather than the instant the user picks a new
          // option.
          const stale =
            !session.promptsFor ||
            session.promptsFor.continuity !== effectiveContinuity(session) ||
            session.promptsFor.videoModel !== session.videoModel ||
            session.promptsFor.audio !== (session.audio ?? "generated")
          if (stale) {
            await generateVideoPrompts(id, true)
            session = getSession(id)
            if (!session) return
          }
          update((prev) => ({
            ...prev,
            step: "videos",
            // An uploaded scene the user hasn't given a motion prompt is
            // already a finished clip — leave it alone rather than wiping
            // it to regenerate from an empty prompt.
            scenes: prev.scenes.map((s) =>
              isProtectedUpload(s, "videoPrompt")
                ? s
                : {
                    ...s,
                    videoGenId: undefined,
                    videoStatus: "generating" as const,
                    videoUrl: undefined,
                    videoError: undefined,
                    videoModelUsed: session.videoModel,
                  },
            ),
          }))
          await Promise.all(
            session.scenes
              .filter((s) => !isProtectedUpload(s, "videoPrompt"))
              .map((s) => postSceneVideo(session, s)),
          )
        },
        retryVideo: async (scene) => {
          const session = getSession(id)
          if (!session) return
          // Also used to REGENERATE a completed clip after merge/done: step
          // back to "videos" and drop the stale merge result — the next
          // "Go to Publish" click re-merges with this clip's fresh output.
          update((prev) => ({
            ...prev,
            step: prev.step === "merging" || prev.step === "done" ? "videos" : prev.step,
            mergeGenId: undefined,
            mergeStatus: undefined,
            mergeError: undefined,
            finalUrl: undefined,
            finalThumbnailUrl: undefined,
            scenes: prev.scenes.map((s) =>
              s.index === scene.index
                ? {
                    ...s,
                    videoGenId: undefined,
                    videoStatus: "generating" as const,
                    videoUrl: undefined,
                    videoError: undefined,
                    videoModelUsed: session.videoModel,
                  }
                : s,
            ),
          }))
          await postSceneVideo(session, scene)
        },
        retryAllFailedVideos: async () => {
          const session = getSession(id)
          if (!session) return
          const failed = session.scenes.filter((s) => s.videoStatus === "failed")
          if (failed.length === 0) return
          const failedIdx = new Set(failed.map((s) => s.index))
          update((prev) => ({
            ...prev,
            step: prev.step === "merging" || prev.step === "done" ? "videos" : prev.step,
            mergeGenId: undefined,
            mergeStatus: undefined,
            mergeError: undefined,
            finalUrl: undefined,
            finalThumbnailUrl: undefined,
            scenes: prev.scenes.map((s) =>
              failedIdx.has(s.index)
                ? {
                    ...s,
                    videoGenId: undefined,
                    videoStatus: "generating" as const,
                    videoUrl: undefined,
                    videoError: undefined,
                    videoModelUsed: session.videoModel,
                  }
                : s,
            ),
          }))
          await Promise.all(failed.map((s) => postSceneVideo(session, s)))
        },
        runMerge: () => runMerge(id),
        generateMaster: async () => {
          const session = getSession(id)
          if (!session?.masterPrompt) return
          if ((session.masterImages ?? []).length >= MAX_INPUT_REFS) {
            onError(`Maximum ${MAX_INPUT_REFS} style-anchor images`, null)
            return
          }
          const genId = makeGenerationId()
          update((prev) => ({
            ...prev,
            masterImages: [
              ...(prev.masterImages ?? []),
              { id: genId, genId, status: "generating" as const, source: "generated" as const },
            ],
          }))
          try {
            await apiRequest("/generate/image", {
              method: "POST",
              body: JSON.stringify({
                models: [session.imageModel],
                prompt: session.masterPrompt + NO_TEXT_IMAGE,
                generation_id: genId,
                params: { aspect_ratio: session.aspectRatio, resolution: "hd", num_images: 1 },
              }),
            })
          } catch (err) {
            update((prev) => ({
              ...prev,
              masterImages: prev.masterImages?.map((m) =>
                m.id === genId ? { ...m, status: "failed" as const } : m,
              ),
            }))
            onError("style-anchor", err)
          }
        },
        uploadMasterImage: async (file) => {
          if (((getSession(id)?.masterImages ?? []).length) >= MAX_INPUT_REFS) {
            onError(`Maximum ${MAX_INPUT_REFS} style-anchor images`, null)
            return
          }
          const mid = makeGenerationId()
          update((prev) => ({
            ...prev,
            masterImages: [
              ...(prev.masterImages ?? []),
              { id: mid, status: "generating" as const, source: "uploaded" as const },
            ],
          }))
          try {
            const res = await uploadReferenceImage(null, file)
            update((prev) => ({
              ...prev,
              masterImages: prev.masterImages?.map((m) =>
                m.id === mid ? { ...m, status: "completed" as const, url: res.url } : m,
              ),
            }))
          } catch (err) {
            update((prev) => ({
              ...prev,
              masterImages: prev.masterImages?.map((m) =>
                m.id === mid ? { ...m, status: "failed" as const } : m,
              ),
            }))
            onError("style-anchor", err)
          }
        },
        removeMasterImage: (mid) =>
          update((prev) => ({
            ...prev,
            masterImages: prev.masterImages?.filter((m) => m.id !== mid),
          })),
        addReference: async (file) => {
          const session = getSession(id)
          if (!session) return
          if ((session.references ?? []).length >= MAX_INPUT_REFS) {
            onError(`Maximum ${MAX_INPUT_REFS} reference images`, null)
            return
          }
          const tempIndex =
            Math.max(0, ...(session.references ?? []).map((r) => r.index)) + 1
          const previewUrl = URL.createObjectURL(file)
          update((prev) => ({
            ...prev,
            references: [
              ...(prev.references ?? []),
              { index: tempIndex, url: "", previewUrl, analyzing: true },
            ],
          }))
          try {
            const uploaded = await uploadReferenceImage(null, file)
            const res = await apiRequest("/story/reference/analyze", {
              method: "POST",
              body: JSON.stringify({ url: uploaded.url, asset_id: uploaded.id }),
            })
            const a = res?.analysis ?? {}
            update((prev) => ({
              ...prev,
              references: (prev.references ?? []).map((r) =>
                r.index === tempIndex
                  ? {
                      ...r,
                      url: uploaded.url,
                      analyzing: false,
                      kind: a.kind,
                      name: a.name,
                      description: a.description,
                    }
                  : r,
              ),
              // A new cast member joins every scene; regenerate to apply.
              scenes: prev.scenes.map((s) => ({
                ...s,
                referenceUrls: [...(s.referenceUrls ?? []), uploaded.url],
              })),
            }))
          } catch (err) {
            update((prev) => ({
              ...prev,
              references: (prev.references ?? []).filter((r) => r.index !== tempIndex),
            }))
            onError("add-reference", err)
          }
        },
        removeReference: (index) =>
          update((prev) => {
            const url = (prev.references ?? []).find((r) => r.index === index)?.url
            return {
              ...prev,
              references: (prev.references ?? []).filter((r) => r.index !== index),
              scenes: url
                ? prev.scenes.map((s) => ({
                    ...s,
                    referenceUrls: (s.referenceUrls ?? []).filter((u) => u !== url),
                  }))
                : prev.scenes,
            }
          }),
        deleteScene: (index) =>
          update((prev) => {
            if (prev.scenes.length <= 1) return prev
            const removed = prev.scenes.find((s) => s.index === index)
            if (!removed) return prev
            const scenes = prev.scenes
              .filter((s) => s.index !== index)
              .sort((a, b) => a.index - b.index)
              .map((s, i) => ({ ...s, index: i }))
            return {
              ...prev,
              scenes,
              totalDuration: Math.max(0, prev.totalDuration - removed.duration),
            }
          }),
        addUploadedScene: async (file) => {
          const session = getSession(id)
          if (!session) return
          const form = new FormData()
          form.append("file", file, file.name)
          form.append("duration", "5")
          form.append("aspect_ratio", session.aspectRatio)
          form.append("resolution", pickResolution(session.videoModel, session.quality))
          try {
            const res = await apiRequest("/story/scene-media", { method: "POST", body: form })
            const duration = typeof res?.duration === "number" && res.duration > 0 ? res.duration : 5
            const title = file.name.replace(/\.[^./\\]+$/, "").trim() || "Added scene"
            // Local-dev-fallback media comes back as a plugin-relative
            // `/story/media/...` path — <img>/<video> can't go through the
            // credentialed platform.apiFetch those need, so it has to be
            // resolved to an absolute URL first (same as the merged video
            // already does in publish.tsx), or the tile/preview just never
            // loads. Hosted-storage URLs pass through unchanged.
            const [imageUrl, videoUrl] = await Promise.all([
              res?.image_url ? resolveMediaUrl(res.image_url) : Promise.resolve(undefined),
              res?.video_url ? resolveMediaUrl(res.video_url) : Promise.resolve(undefined),
            ])
            update((prev) => {
              const nextIndex = prev.scenes.length
                ? Math.max(...prev.scenes.map((s) => s.index)) + 1
                : 0
              const scene: StoryScene = {
                index: nextIndex,
                title,
                duration,
                sceneKind: "uploaded",
                imagePrompt: "",
                videoPrompt: "",
                imageUrl,
                imageStatus: "completed",
                imagePromptUsed: "",
                videoUrl,
                videoStatus: "completed",
              }
              return {
                ...prev,
                scenes: [...prev.scenes, scene],
                totalDuration: prev.totalDuration + duration,
                // A structural change (a whole new scene) invalidates any
                // merge already done — the next "Go to Publish" re-merges
                // with it included, same as retryVideo does for a regen.
                step: prev.step === "merging" || prev.step === "done" ? "videos" : prev.step,
                mergeGenId: undefined,
                mergeStatus: undefined,
                mergeError: undefined,
                finalUrl: undefined,
                finalThumbnailUrl: undefined,
              }
            })
          } catch (err) {
            onError("add-scene", err)
          }
        },
        moveScene: (index, direction) =>
          update((prev) => {
            const order = [...prev.scenes].sort((a, b) => a.index - b.index)
            const pos = order.findIndex((s) => s.index === index)
            if (pos < 0) return prev
            const swapPos = direction === "left" ? pos - 1 : pos + 1
            if (swapPos < 0 || swapPos >= order.length) return prev
            const reordered = [...order]
            ;[reordered[pos], reordered[swapPos]] = [reordered[swapPos], reordered[pos]]
            const scenes = reordered.map((s, i) => ({ ...s, index: i }))
            return {
              ...prev,
              scenes,
              // Play order genuinely changed — same merge-invalidation as
              // addUploadedScene above.
              step: prev.step === "merging" || prev.step === "done" ? "videos" : prev.step,
              mergeGenId: undefined,
              mergeStatus: undefined,
              mergeError: undefined,
              finalUrl: undefined,
              finalThumbnailUrl: undefined,
            }
          }),
      }
    },
    [getSession, updateSession, postSceneImage, postSceneVideo, generateVideoPrompts, runMerge, waitForSceneImage, onError],
  )

  return {
    sessions,
    loaded,
    addSession,
    updateSession,
    resyncSession,
    removeSession,
    byGenId,
    actionsFor,
    writingPrompts,
    promptsFailed,
    onError,
  }
}

/** Display title for a run: the planner's short title (2–5 words) when
 * present, otherwise the first words of the prompt (old sessions). */
export function runTitle(session: StorySession): string {
  const t = session.title?.trim()
  if (t) return t
  const words = session.prompt.trim().split(/\s+/)
  return words.slice(0, 5).join(" ") + (words.length > 5 ? "…" : "")
}

// ---- Stage helpers (Home → Storyboard → Animate → Publish mapping) ---------

export type RunStage = "storyboard" | "animate" | "publish"

export function reachedStage(session: StorySession): RunStage {
  switch (session.step) {
    case "plan":
    case "images":
      return "storyboard"
    case "video-prompts":
    case "videos":
      return "animate"
    default:
      return "publish"
  }
}

export const STAGE_ORDER: RunStage[] = ["storyboard", "animate", "publish"]

export function stageIndex(stage: RunStage): number {
  return STAGE_ORDER.indexOf(stage)
}

/** Every scene has a finished clip — the gate for enabling "Go to Publish"
 * on Animate. Merging (with narration/music/captions) only starts once the
 * user actually clicks through, not the instant this turns true. */
export function allClipsDone(session: StorySession): boolean {
  return session.scenes.length > 0 && session.scenes.every((s) => s.videoStatus === "completed" && s.videoUrl)
}

/** Live prompt vs. the prompt the current image was actually generated
 * from — the gate for Storyboard's "Regenerate" footer button (only enabled
 * once at least one scene has an edit not yet reflected in its image) and
 * for the per-scene "prompt changed" nudge on a stale tile. */
export function isSceneStale(session: StorySession, scene: StoryScene): boolean {
  if (!scene.imageUrl || scene.imageStatus !== "completed") return false
  if (scene.imagePrompt.trim() !== (scene.imagePromptUsed ?? "").trim()) return true
  // Only counts once a scene has actually been generated under a KNOWN
  // model — undefined (pre-existing scenes from before this field existed)
  // never falsely flags every scene as stale on its own.
  return !!scene.imageModelUsed && scene.imageModelUsed !== session.imageModel
}

/** An uploaded scene (Animate's "add scene") the user hasn't opted back
 * into AI (re)generation for by typing a prompt — the bulk "regenerate
 * everything" actions (generateImages/regenerateImage/generateVideos) leave
 * these completely untouched instead of overwriting the user's own upload
 * with an empty-prompt AI generation. The moment a prompt is typed for it,
 * it's fair game again like any other scene. */
function isProtectedUpload(scene: StoryScene, field: "imagePrompt" | "videoPrompt"): boolean {
  return scene.sceneKind === "uploaded" && !scene[field].trim()
}
