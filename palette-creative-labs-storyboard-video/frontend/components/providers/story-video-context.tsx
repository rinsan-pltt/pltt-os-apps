"use client"

import * as React from "react"
import { apiRequest } from "@/lib/api-helper"
import { useProjectContext } from "@/components/providers/project-context"

// Long Video (story) session state, shared between the control panel (which
// plans the story via /story/plan) and the workspace's StoryBoard (which
// drives image → video-prompt → video → merge steps). Kept in a context so
// both sides of the split layout see the same state machine.

export type StoryStep =
  | "plan" // scenes planned; user edits image prompts + picks the image model
  | "images" // per-scene images generating
  | "video-prompts" // images done; user edits motion prompts + picks the video model
  | "videos" // per-scene clips generating
  | "merging" // ffmpeg merge running on the backend
  | "done" // final video available

export type SceneJobStatus = "idle" | "generating" | "completed" | "failed"

// How consecutive clips connect:
// - "bridge" (default): clip N is generated with scene N's image as its START
//   frame and scene N+1's image as its END frame, so every cut point is
//   pixel-identical between clips (Kling/Seedance support start+end frames).
// - "cinematic": each clip is ALSO bridged (when the model supports it) AND
//   its motion prompt is written as a multi-angle shot list — Kling's native
//   pipe-separated multi-prompt, or an explicit timestamped shot breakdown
//   for models without that (Seedance, …) — for a professional-videography
//   feel within every clip, not just a single continuous move.
// - "independent": every clip only gets its own start frame and a single
//   continuous motion prompt (the old behaviour) — scenes may cut harder but
//   each shot is freer.
export type StoryContinuity = "bridge" | "cinematic" | "independent"

// "generated": model-native ambience/sound (Kling/Seedance render it
// straight from the clip's own motion prompt). "silent": no audio at all.
// The remaining two replace model-native audio with an ElevenLabs pipeline
// run once on the merged video: "music" (Eleven Music only), "voiceover_music"
// (eleven_v3 narration + Eleven Music — optionally with captions burned in via
// ffmpeg drawtext, timed from the narration's word-level alignment; see
// `captionsEnabled`).
export type AudioMode = "generated" | "silent" | "music" | "voiceover_music"

// The LLM that writes the story/scenes (/story/plan) and motion prompts
// (/story/video-prompts).
export type StoryLlm = "claude_opus" | "claude_sonnet" | "claude_haiku" | "gpt" | "gemini"

// The film's LOCKED production design, written by the planner. Appended (as a
// GLOBAL STYLE block) to every scene image prompt, and its camera/atmosphere
// lock rides every clip prompt so lens/light/grade never drift between shots.
export interface StoryBible {
  characters?: string
  environment?: string
  lighting?: string
  camera?: string
  grading?: string
}

// A user-provided reference image (character/object/background/style), already
// analysed by the vision model so the planner can cast it into scenes.
export interface StoryReferenceInfo {
  index: number // 1-based number the plan/scenes refer to
  url: string
  // Browser-displayable src for thumbnails: local dev storage hands out
  // file:// urls the browser refuses, so the uploader's object-URL preview is
  // kept for display while `url` stays the canonical generation input.
  previewUrl?: string
  kind?: string
  name?: string
  description?: string
  // True while a just-added reference is uploading/analysing (shows a
  // placeholder tile until its analysis lands).
  analyzing?: boolean
}

// One candidate in the Master Reference gallery — either AI-generated (from
// `masterPrompt`) or manually uploaded by the user. Multiple can coexist;
// every `completed` one anchors scene image generation (as image_references).
export interface MasterReferenceImage {
  id: string
  genId?: string // set only for "generated" — used to poll its item's status
  url?: string
  status: SceneJobStatus
  source: "generated" | "uploaded"
}

export interface StoryChatMessage {
  role: "user" | "assistant" | "note"
  text: string
  // "@Scene 03"-style context chip the message was sent under.
  chip?: string
}

export interface StoryScene {
  index: number
  title: string
  duration: number // seconds; all scenes sum to totalDuration
  // Set when the user added this scene by directly uploading an image/video
  // (Animate's "add scene") rather than it coming from the AI pipeline — an
  // image was looped into a silent clip server-side, a video used as-is.
  // Protects it from the bulk "regenerate everything" actions AS LONG AS its
  // prompts stay empty; typing a prompt for it opts it back into normal AI
  // (re)generation like any other scene.
  sceneKind?: "uploaded"
  imagePrompt: string
  videoPrompt: string
  // Reference images assigned to this scene by the story plan; attached as
  // image_references when the scene image is generated.
  referenceUrls?: string[]
  imageGenId?: string
  imageUrl?: string
  imageStatus: SceneJobStatus
  imageError?: string
  // The imagePrompt value that the current image was generated from. When it
  // differs from the live imagePrompt, the scene image is stale and the UI
  // nudges the user to regenerate.
  imagePromptUsed?: string
  // The session's imageModel at the time this image was generated. When it
  // differs from the live session.imageModel (user picked a different
  // model), the scene is ALSO stale — same nudge/regenerate path as an
  // edited prompt, just triggered by a model switch instead.
  imageModelUsed?: string
  videoGenId?: string
  videoUrl?: string
  videoStatus: SceneJobStatus
  videoError?: string
  // The session's videoModel at the time this clip was generated — shown
  // next to the per-scene "regenerate clip" affordance so it's clear which
  // model a stale-looking clip would be redone with.
  videoModelUsed?: string
}

export interface StorySession {
  id: string
  // When the story was planned — the workspace interleaves the board with the
  // generation batches by time (newer generations render above it).
  createdAt?: string
  // Key frame the story was created on — the session (and its board) belongs
  // to that key frame only. Null for standalone (project-less) sessions.
  keyFrameId?: string | null
  prompt: string // the user's original idea
  // Short display title (2–5 words) written by the planner; absent on old
  // sessions — display falls back to a truncated prompt.
  title?: string
  totalDuration: number // seconds (20–60)
  aspectRatio: string
  story: string
  bible?: StoryBible
  step: StoryStep
  scenes: StoryScene[]
  references?: StoryReferenceInfo[]
  // Master reference gallery (text-only stories): one or more images — AI-
  // generated from `masterPrompt` and/or manually uploaded — that anchor
  // every scene image when the user attached no references.
  masterPrompt?: string
  masterImages?: MasterReferenceImage[]
  // Deprecated single-image fields — old persisted sessions may still carry
  // these; `sanitizeLoadedSession` folds them into `masterImages` on load.
  // New code should read/write `masterImages` only.
  masterGenId?: string
  masterUrl?: string
  masterStatus?: SceneJobStatus
  // The writer LLM for this run's plan/motion-prompt generation. Absent on
  // old sessions → defaults applied where read (DEFAULT_LLM in engine.ts).
  llmModel?: StoryLlm
  imageModel: string
  videoModel: string
  continuity?: StoryContinuity
  // Snapshot of the structural inputs (idea, concept, duration, ratio, scene
  // count) as of the last plan/re-plan. The Brief compares the live values to
  // this to know when a re-plan is needed (its CTA flips to "Regenerate").
  planBaseline?: {
    prompt: string
    story: string
    totalDuration: number
    aspectRatio: string
    sceneCount: number
  }
  // A pending desired scene count set on the Brief; applied on the next
  // re-plan. Until then the real count is scenes.length.
  targetSceneCount?: number
  // Output quality (short-side resolution, e.g. "720p"/"1080p") picked at
  // brief time; clamped to what the chosen video model supports when clips
  // are generated. Absent on old sessions → auto-pick (highest available).
  quality?: string
  // Clip audio: "generated" = model-native ambience/sound, "silent" = none,
  // "music" = ElevenLabs Music only, "voiceover_music" = ElevenLabs narration
  // (eleven_v3) + Music. Absent on old sessions → "generated".
  audio?: AudioMode
  // Settings captured by the audio settings dialog for the "music"/
  // "voiceover_music" modes above — irrelevant (but harmless if stale) for
  // "generated"/"silent".
  musicPrompt?: string
  narrationText?: string
  narrationVoiceId?: string
  // "voiceover_music" only: which language the narration is spoken/
  // pronounced in ("en" | "ko"). Defaults to "en" when unset.
  narrationLanguage?: string
  // "voiceover_music" only: burn captions (ffmpeg drawtext) timed from the
  // narration's word alignment. Defaults to true when unset.
  captionsEnabled?: boolean
  // The continuity/model the CURRENT scene.videoPrompt values were written
  // for — lets the board detect when the user changes either afterward
  // (e.g. picks Cinematic post-hoc) so the stale prompts don't silently ride
  // into clip generation unformatted for the new choice.
  promptsFor?: { continuity: StoryContinuity; videoModel: string; audio: AudioMode }
  mergeGenId?: string
  mergeStatus?: SceneJobStatus
  mergeError?: string
  finalUrl?: string
  // First-frame still of the final merged video — same server-extracted
  // poster mechanism as each scene's own clip.
  finalThumbnailUrl?: string | null
  // YouTube Shorts publish state for THIS run's final video (Publish
  // screen). Persisted so a completed/failed publish survives a refresh.
  youtubePublishStatus?: "publishing" | "published" | "failed"
  youtubePublishedUrl?: string
  youtubePublishError?: string
  // Same, for Instagram Reels.
  instagramPublishStatus?: "publishing" | "published" | "failed"
  instagramPublishedUrl?: string
  instagramPublishError?: string
  // Same, for TikTok — no publishedUrl: TikTok's API doesn't hand back a
  // permalink for a freshly published post.
  tiktokPublishStatus?: "publishing" | "published" | "failed"
  tiktokPublishError?: string
  // Scene-chat conversation history — part of the session's own persisted
  // state (see SessionAutosave below), so it survives navigating away and a
  // page refresh, scoped to this run just like everything else here.
  // Storyboard and Animate each have their own chat (different context —
  // image prompts vs. motion prompts), hence two separate histories.
  storyboardChatMessages?: StoryChatMessage[]
  animateChatMessages?: StoryChatMessage[]
  // Set from the moment a plan is requested (both a brand-new session and a
  // Brief "Regenerate") until it resolves. /story/plan itself runs as a
  // background job (like scene/merge generations) rather than being awaited
  // inline, so the result survives not just navigating away but a full page
  // refresh too — planGenId is how a reloaded session finds its way back to
  // that job's result via the same generation-id lookup scene/merge use.
  planningStatus?: "generating" | "failed"
  planningError?: string
  planGenId?: string
}

interface StoryVideoCtx {
  // ALL Long Video sessions for the current scope (project + active key
  // frame, or the user's standalone sessions), oldest first. Several boards
  // can coexist on the same key frame — generating a new story appends to
  // this list rather than replacing whatever was already there.
  sessions: StorySession[]
  addSession: (session: StorySession) => void
  updateSession: (
    id: string,
    updater: StorySession | ((prev: StorySession) => StorySession),
  ) => void
  removeSession: (id: string) => void
  // True once the persisted sessions (if any) have been loaded — consumers
  // that hydrate inputs from a session should wait for this.
  loaded: boolean
}

const noop = () => {}
const Ctx = React.createContext<StoryVideoCtx>({
  sessions: [],
  addSession: noop,
  updateSession: noop,
  removeSession: noop,
  loaded: false,
})

/** Drop session fields that can't survive a reload (blob: object URLs), and
 * fold pre-gallery sessions' single masterUrl/masterGenId/masterStatus into
 * the masterImages array so they keep displaying after this upgrade. */
function sanitizeLoadedSession(data: StorySession): StorySession {
  const legacyMaster =
    !data.masterImages?.length && (data.masterUrl || data.masterGenId)
      ? [
          {
            id: data.masterGenId ?? `legacy-${data.id}`,
            genId: data.masterGenId,
            url: data.masterUrl,
            status: data.masterStatus ?? (data.masterUrl ? "completed" : "idle"),
            source: "generated" as const,
          },
        ]
      : undefined
  return {
    ...data,
    masterImages: legacyMaster ?? data.masterImages,
    references: data.references?.map((r) => ({
      ...r,
      previewUrl: r.previewUrl?.startsWith("blob:") ? undefined : r.previewUrl,
    })),
  }
}

/** One per live session: debounce-saves it to `/story/session` on change,
 * mirroring the same per-session effect+cleanup a single-session version
 * would have — mounting/unmounting with the session covers start/stop
 * automatically as sessions are added/removed. Renders nothing. */
function SessionAutosave({
  session,
  projectId,
  savedRef,
}: {
  session: StorySession
  projectId?: string | null
  savedRef: React.MutableRefObject<Map<string, string>>
}) {
  React.useEffect(() => {
    const json = JSON.stringify(session)
    if (savedRef.current.get(session.id) === json) return
    const timer = setTimeout(() => {
      savedRef.current.set(session.id, json)
      apiRequest("/story/session", {
        method: "PUT",
        body: JSON.stringify({
          id: session.id,
          project_id: projectId ?? null,
          // Persist under the key frame the story was CREATED on (not the one
          // currently open), so it stays attached to its own key frame.
          key_frame_id: session.keyFrameId ?? null,
          data: session,
        }),
      }).catch((e) => console.error("Failed to save story session:", e))
    }, 800)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, projectId])
  return null
}

export function StoryVideoProvider({
  projectId,
  children,
}: {
  projectId?: string | null
  children: React.ReactNode
}) {
  const [sessions, setSessions] = React.useState<StorySession[]>([])
  const [loaded, setLoaded] = React.useState(false)
  // Sessions are scoped per key frame: a story created on Key Frame 01 shows
  // only while Key Frame 01 is open. Switching keyframes swaps the list.
  const { activeKeyFrameId } = useProjectContext()
  const keyFrameId = projectId ? activeKeyFrameId : null
  // What the server currently holds per session id, to skip no-op saves
  // (also primed on load) — shared with every SessionAutosave instance.
  const lastSavedRef = React.useRef<Map<string, string>>(new Map())

  // Restore every persisted session for the scope on mount / project or
  // keyframe switch, so generated stories/images/videos survive a refresh.
  React.useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setSessions([])
    lastSavedRef.current = new Map()
    // On a project page, wait for the keyframe selection to settle.
    if (projectId && !keyFrameId) return
    const qs = projectId
      ? `?project_id=${encodeURIComponent(projectId)}&key_frame_id=${encodeURIComponent(keyFrameId!)}`
      : ""
    apiRequest(`/story/session${qs}`)
      .then((res) => {
        if (cancelled) return
        const rows: { data?: StorySession; created_at?: string }[] = res?.sessions ?? []
        const restored = rows
          .map((row) => {
            const data = row.data
            if (!data?.id || !Array.isArray(data.scenes)) return null
            // Older sessions predate createdAt — fall back to the row's time.
            return sanitizeLoadedSession({ ...data, createdAt: data.createdAt ?? row.created_at })
          })
          .filter((s): s is StorySession => !!s)
        if (restored.length === 0) return
        setSessions((prev) => {
          // The user may have planned NEW stories while the restore was in
          // flight — merge in, never clobber sessions created since.
          const known = new Set(prev.map((s) => s.id))
          const fresh = restored.filter((s) => !known.has(s.id))
          for (const s of fresh) lastSavedRef.current.set(s.id, JSON.stringify(s))
          return fresh.length ? [...prev, ...fresh] : prev
        })
      })
      .catch(() => {
        // No sessions / endpoint unavailable — start fresh.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, keyFrameId])

  const addSession = React.useCallback((session: StorySession) => {
    setSessions((prev) => [...prev, session])
  }, [])

  const updateSession = React.useCallback(
    (id: string, updater: StorySession | ((prev: StorySession) => StorySession)) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? typeof updater === "function"
              ? (updater as (prev: StorySession) => StorySession)(s)
              : updater
            : s,
        ),
      )
    },
    [],
  )

  const removeSession = React.useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    lastSavedRef.current.delete(id)
    apiRequest(`/story/session/${id}`, { method: "DELETE" }).catch(() => {})
  }, [])

  const value = React.useMemo(
    () => ({ sessions, addSession, updateSession, removeSession, loaded }),
    [sessions, addSession, updateSession, removeSession, loaded],
  )
  return (
    <Ctx.Provider value={value}>
      {loaded &&
        sessions.map((s) => (
          <SessionAutosave key={s.id} session={s} projectId={projectId} savedRef={lastSavedRef} />
        ))}
      {children}
    </Ctx.Provider>
  )
}

/** Long Video sessions state; inert (empty list, no-op setters) outside the provider. */
export function useStoryVideo() {
  return React.useContext(Ctx)
}
