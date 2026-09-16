"use client"

import React from "react"
import { IconBrush, IconEraser, IconLoader2, IconPlus, IconSettings, IconSend, IconSparkles, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MaskEditorModal } from "./mask-editor-modal"
import { apiRequest } from "@/lib/api-helper"
import { uploadReferenceImage } from "@/lib/gcs-upload-helper"
import { ITEM_DRAG_TYPE, getItemDragPayload } from "@/lib/drag-types"
import { useProjectContext } from "@/components/providers/project-context"
import { useSharedGenerationEvents } from "@/components/providers/generation-events-context"
import { toast } from "@/components/ui/sonner"

// CHAT tab UI for the control panel. Self-contained so the PROMPT tab keeps
// its existing behaviour untouched — all chat-specific state lives here.
//
// Backend integration: an Edit click anchors the chat to that image's thread
// (one thread per image, `/agent/threads` is get-or-create). Without an Edit
// target the keyframe gets a draft thread — a fresh server-side thread not
// anchored to any image — whose id is persisted in localStorage so the same
// conversation survives navigation and refresh. When the chat generates its
// first image the backend re-keys the draft to that image's id and we adopt
// it, so all of the history lives under the image from then on. Turns go
// through `/agent/chat`; the agent's tools drive the same generation pipeline
// as the PROMPT tab, so anything it creates also lands in the workspace (we
// refresh the project after each reply to surface it).

const COUNT_OPTIONS = ["1", "2", "4"]
const ASPECT_OPTIONS = ["16:9", "1:1", "9:16"]
const RESOLUTION_OPTIONS = ["HD", "2K", "4K"]
const MAX_REFERENCES = 10

// The LLM that drives the chat agent (the other is used as fallback). Persisted
// so the choice sticks across reloads.
type LlmProvider = "openai" | "gemini"
const LLM_OPTIONS: { value: LlmProvider; label: string }[] = [
  { value: "openai", label: "GPT" },
  { value: "gemini", label: "Gemini" },
]
const LLM_STORAGE_KEY = "palette:chatLlm"
const readStoredLlm = (): LlmProvider => {
  try {
    return localStorage.getItem(LLM_STORAGE_KEY) === "gemini" ? "gemini" : "openai"
  } catch {
    return "openai"
  }
}

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c_${Math.random().toString(36).slice(2)}_${Date.now()}`

// Where the keyframe's current draft-thread id is persisted, so the default
// conversation survives navigation and refresh until an image re-keys it.
const storedThreadKey = (kfScope: string) => `palette:chatThread:${kfScope}`

const readStoredThreadId = (kfScope: string): string | null => {
  try {
    return localStorage.getItem(storedThreadKey(kfScope))
  } catch {
    return null
  }
}

const writeStoredThreadId = (kfScope: string, threadId: string) => {
  try {
    localStorage.setItem(storedThreadKey(kfScope), threadId)
  } catch {
    /* storage unavailable — the thread just won't survive a refresh */
  }
}

// Forget the keyframe's persisted draft-thread id so the next bootstrap starts
// a brand-new empty chat. Used once a draft graduates to an image (its history
// now lives under that image) so a refresh — or closing the chat — lands on a
// fresh conversation instead of reloading the graduated one.
const clearStoredThreadId = (kfScope: string) => {
  try {
    localStorage.removeItem(storedThreadKey(kfScope))
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

type ChatRef = { id: string; file: File; url: string }

// A model-selection request the backend attaches to an assistant message when
// a create/edit was asked without naming a model. Rendered as selectable
// chips below the message; the chosen models are echoed back on confirm.
type ModelOption = { value: string; label: string }
type ModelRequest = {
  action: "create" | "edit"
  instruction?: string | null
  options: ModelOption[]
  default?: string | null
  multi?: boolean
  // Storage URL of the mask uploaded with the original request (and the image
  // it was painted on), echoed back on the confirmation turn so the edit still
  // applies it to the right image.
  mask_url?: string | null
  mask_image_url?: string | null
  // Hosted URLs of reference images attached to the original request, echoed
  // back on the confirmation turn so the edit still receives them.
  reference_images?: string[] | null
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  images: string[]
  modelRequest?: ModelRequest | null
  // Set on the user turn that kicks off an edit: the image being edited. When
  // present the message renders as a compact "EDIT IMAGE" card (thumbnail +
  // instruction) instead of a plain text bubble.
  editImage?: string | null
  // When the user painted a mask before sending, the masked image + its overlay
  // preview are recorded on the turn so they stay visible in the chat as a
  // record of what was sent (the live mask state is cleared on send).
  maskRecord?: { url: string; mask: string } | null
  // generation_id(s) this assistant turn kicked off. When the turn returned
  // before the images finished (slow models like Midjourney), the chat
  // reconciles the produced images into the message by matching these against
  // the live generation stream — so they appear without a refresh and persist
  // across one (the project re-seeds them by the same id).
  generationIds?: string[]
}

// Wire shapes from the /agent endpoints.
type AgentImageRef = { url?: string | null; status?: string | null }
type AgentMessageRow = {
  id: number | string
  role: string
  content: string
  tool_calls?: {
    created?: AgentImageRef[]
    model_request?: ModelRequest | null
    reference_images?: string[] | null
    generation_ids?: string[] | null
  } | null
}
type ThreadResponse = {
  thread: {
    id: string
    base_image_url?: string | null
    title?: string | null
    // The anchored image's generation settings, stored on the thread — used to
    // prefill the composer so an Edit defaults to the image's own aspect ratio.
    aspect_ratio?: string | null
    resolution?: string | null
  }
  messages: AgentMessageRow[]
}
type ChatResponse = {
  thread_id: string
  reply: string
  images?: AgentImageRef[]
  model_request?: ModelRequest | null
  // Generation tracking: when `pending` is true the reply came back before all
  // images finished. The chat registers an optimistic item per `generation_ids`
  // so the workspace poll fallback runs (multi-worker SSE can't always reach the
  // browser) and reconciles the images as they land.
  generation_ids?: string[] | null
  pending?: boolean
  project_id?: string | null
  key_frame_id?: string | null
}

const completedUrls = (rows?: AgentImageRef[] | null): string[] =>
  (rows ?? [])
    .filter((r) => r.status === "completed" && r.url)
    .map((r) => r.url as string)

// Chat state for ONE conversation scope (a targeted image, or a keyframe's
// default thread). Kept per scope so several conversations can be in flight
// at once — a turn thinking in one keyframe must never block, interrupt, or
// leak its state into another keyframe's chat.
type ScopeChat = {
  threadId: string | null
  threadMeta: { imageUrl?: string | null; title?: string | null } | null
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  // What the in-flight turn is doing: a confirmed model selection generates
  // images, anything else is the agent thinking. Drives the indicator bubble.
  sendingKind: "thinking" | "generating"
  // The composer draft (typed text + attached reference images) is part of
  // the scope too: text typed in one keyframe must not show up in another,
  // and must still be there when its own keyframe is reopened.
  input: string
  refs: ChatRef[]
  // True while this scope's attached references upload at send time — blocks
  // a second Send in THIS scope only.
  uploadingRefs: boolean
  // A painted mask also belongs to its conversation: `editMask` is the styled
  // overlay previewed on the image, `editMaskData` the actual mask PNG
  // (white = editable, black = preserve) sent to the backend, and
  // `editMaskImageUrl` the image it was painted on. Kept per scope so it
  // survives keyframe switches (until sent, removed, or the page reloads).
  editMask: string | null
  editMaskData: string | null
  editMaskImageUrl: string | null
}

const EMPTY_SCOPE_CHAT: ScopeChat = {
  threadId: null,
  threadMeta: null,
  messages: [],
  loading: false,
  sending: false,
  sendingKind: "thinking",
  input: "",
  refs: [],
  uploadingRefs: false,
  editMask: null,
  editMaskData: null,
  editMaskImageUrl: null,
}

const toChatMessage = (m: AgentMessageRow): ChatMessage => ({
  id: `srv_${m.id}`,
  role: m.role === "user" ? "user" : "assistant",
  text: m.content ?? "",
  // Assistant turns show the images they produced; user turns re-show any
  // reference images they attached (persisted in tool_calls on send).
  images:
    m.role === "assistant"
      ? completedUrls(m.tool_calls?.created)
      : m.tool_calls?.reference_images ?? [],
  modelRequest: m.role === "assistant" ? m.tool_calls?.model_request ?? null : null,
  // Carry generation_ids so a reloaded turn can still reconcile images that
  // finished after the reply was persisted (e.g. Midjourney): the project
  // re-seeds those items by the same id, and the chat matches them in.
  generationIds:
    m.role === "assistant" ? m.tool_calls?.generation_ids ?? undefined : undefined,
})

/** Selectable model chips below an assistant message. Multi-select with the
 * backend's default preselected; Generate/Apply sends the chosen set. */
const ModelSelector = ({
  request,
  disabled,
  busy,
  onConfirm,
}: {
  request: ModelRequest
  disabled: boolean
  busy: boolean
  onConfirm: (models: string[]) => void
}) => {
  const [selected, setSelected] = React.useState<string[]>(
    request.default ? [request.default] : [],
  )
  const toggle = (value: string) =>
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1">
        {request.options.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="xs"
            variant={selected.includes(opt.value) ? "default" : "outline"}
            disabled={disabled}
            onClick={() => toggle(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        size="xs"
        variant="secondary"
        disabled={disabled || busy || selected.length === 0}
        onClick={() => onConfirm(selected)}
      >
        {request.action === "create" ? "Generate" : "Apply edit"}
        {selected.length > 1 ? ` (${selected.length} models)` : ""}
      </Button>
    </div>
  )
}

/** A labelled row of segmented options inside the settings popover. */
const SettingsSection = ({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) => (
  <div className="px-4 py-3 [&:not(:first-child)]:border-t border-border50">
    <div className="mb-2 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
      {label}
    </div>
    <div className="flex">
      {options.map((opt) => (
        <Button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          variant={value === opt ? "default" : "outline"}
          size="xs"
          className="flex-1 [&:not(:first-child)]:-ml-px"
        >
          {opt}
        </Button>
      ))}
    </div>
  </div>
)

export const ChatPanel = () => {
  const {
    currentProject,
    activeKeyFrameId,
    refreshCurrentProject,
    addOptimisticItems,
    chatTarget,
    openChatForItem,
    clearChatTarget,
  } = useProjectContext()

  // Per-scope chat state. Each keyframe (and each Edit-targeted image) is its
  // own entry, with its own history, thread id, and in-flight flag — so a
  // reply pending in one keyframe never shows "Thinking…" in, or blocks
  // sending from, any other keyframe.
  const [chatByScope, setChatByScope] = React.useState<Record<string, ScopeChat>>({})
  const chatByScopeRef = React.useRef(chatByScope)
  chatByScopeRef.current = chatByScope

  // Merge a patch into one scope's chat state, creating the entry on first
  // touch. Async handlers patch the scope they captured at send time, so
  // results land in the right conversation no matter what's visible now.
  const patchScope = React.useCallback(
    (
      scope: string,
      patch: Partial<ScopeChat> | ((s: ScopeChat) => Partial<ScopeChat>),
    ) => {
      setChatByScope((prev) => {
        const cur = prev[scope] ?? EMPTY_SCOPE_CHAT
        const p = typeof patch === "function" ? patch(cur) : patch
        return { ...prev, [scope]: { ...cur, ...p } }
      })
    },
    [],
  )

  const [count, setCount] = React.useState("1")
  const [aspect, setAspect] = React.useState("1:1")
  const [resolution, setResolution] = React.useState("HD")
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // Chosen chat LLM (persisted). Sent with every turn; the backend runs it
  // first and falls back to the other provider on error.
  const [llm, setLlm] = React.useState<LlmProvider>(readStoredLlm)
  const [llmOpen, setLlmOpen] = React.useState(false)
  React.useEffect(() => {
    try {
      localStorage.setItem(LLM_STORAGE_KEY, llm)
    } catch {
      /* storage unavailable — the choice just won't survive a refresh */
    }
  }, [llm])
  // Mask editor modal. `maskEditorUrl` is the image the editor is open for
  // (null = closed) — the staged edit image OR any image generated in the
  // chat. The saved mask itself lives in the scope's chat state (see
  // ScopeChat) so it stays with its conversation across keyframe switches.
  const [maskEditorUrl, setMaskEditorUrl] = React.useState<string | null>(null)

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const settingsRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // An explicit Edit-click target anchors the chat to that image's thread
  // (one agent thread per image id, each with its own persisted history).
  // Without a target the keyframe uses its persisted draft thread — created
  // empty, not anchored to any image — until the chat generates an image and
  // the backend re-keys the thread to it.
  const targetItem = chatTarget?.item ?? null

  // Live view of the on-screen project, for async completions that need to
  // know whether their project is still the one being viewed.
  const currentProjectIdRef = React.useRef(currentProject?.id)
  currentProjectIdRef.current = currentProject?.id

  const kfScope = `${currentProject?.id ?? ""}:${activeKeyFrameId ?? ""}`
  // Each targeted image is its own conversation scope; the keyframe default is
  // another. Switching scope swaps the visible thread (and only that thread).
  const scopeKey = targetItem ? `img:${targetItem.id}` : `kf:${kfScope}`
  const scopeRef = React.useRef(scopeKey)
  scopeRef.current = scopeKey

  // The visible scope's chat — everything below renders from this.
  const scopeChat = chatByScope[scopeKey] ?? EMPTY_SCOPE_CHAT
  const { threadId, threadMeta, messages, sending, sendingKind, input, refs } = scopeChat
  const threadLoading = scopeChat.loading
  const uploadingRefs = scopeChat.uploadingRefs
  const { editMask, editMaskData, editMaskImageUrl } = scopeChat

  // While a chat turn is in flight, mirror the workspace's "Generating…" state:
  // flip the indicator from "Thinking…" to "Generating…" the moment a
  // chat-originated generation goes live (create, edit, blend, …). We read the
  // PROJECT-WIDE live items (not the keyframe-filtered ones) so it catches a
  // generation whatever keyframe it lands on, and only react to items tagged
  // `gen_params.source === "chat"`, so generations started from the PROMPT
  // panel never change the chat indicator (and the indicator only shows while
  // this scope is sending, so prompt-only generations show nothing here).
  const { allItems: liveGenItems } = useSharedGenerationEvents()
  React.useEffect(() => {
    if (!sending || sendingKind !== "thinking") return
    const chatGenLive = liveGenItems.some((it) => {
      const src = (it.gen_params as { source?: string } | undefined)?.source
      return src === "chat" && (it.status === "started" || it.status === "in_progress")
    })
    if (chatGenLive) patchScope(scopeKey, { sendingKind: "generating" })
  }, [liveGenItems, sending, sendingKind, scopeKey, patchScope])

  // Completed images keyed by generation_id, from the project-wide live stream
  // (which already folds in the project's seeded items after a refresh). Lets a
  // turn that returned before its images finished — Midjourney, or any turn cut
  // short by a proxy timeout — show them inline once they land, live and across
  // a reload, by matching the message's `generationIds`.
  const completedByGen = React.useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const it of liveGenItems) {
      if (it.status === "completed" && it.url && it.generation_id) {
        ;(map[it.generation_id] ??= []).push(it.url)
      }
    }
    return map
  }, [liveGenItems])

  // The images to show for an assistant turn: those persisted on the message,
  // plus any later-arriving ones reconciled by generation_id (de-duplicated).
  const messageImages = React.useCallback(
    (m: ChatMessage): string[] => {
      if (!m.generationIds?.length) return m.images
      const extra = m.generationIds.flatMap((g) => completedByGen[g] ?? [])
      return extra.length ? Array.from(new Set([...m.images, ...extra])) : m.images
    },
    [completedByGen],
  )

  // True when a turn's generation(s) all ended in failure — none produced an
  // image and none are still running. Lets the inline indicator stop spinning
  // and report the failure instead of hanging forever (e.g. after a refresh
  // where the original request that would have reported it is gone).
  const messageGenFailed = React.useCallback(
    (m: ChatMessage): boolean => {
      if (!m.generationIds?.length) return false
      const gids = new Set(m.generationIds)
      const mine = liveGenItems.filter((it) => it.generation_id && gids.has(it.generation_id))
      if (mine.length === 0) return false
      const done = mine.some((it) => it.status === "completed" && it.url)
      const pending = mine.some((it) => it.status === "started" || it.status === "in_progress")
      const failed = mine.some((it) => it.status === "failed")
      return !done && !pending && failed
    },
    [liveGenItems],
  )

  // Whether a chat-originated generation for the CURRENT keyframe is still
  // running, read from the SAME live stream the workspace uses (project seed +
  // poll fallback). This is what keeps the chat showing "Generating…" after a
  // refresh in production: it doesn't depend on the in-flight request or any
  // client-side storage (localStorage), so it survives a reload exactly like
  // the workspace does — which the prompt panel already proves works in prod.
  const hasActiveKeyframeGen = React.useMemo(() => {
    if (!activeKeyFrameId) return false
    return liveGenItems.some((it) => {
      const src = (it.gen_params as { source?: string } | undefined)?.source
      return (
        src === "chat" &&
        it.key_frame_id === activeKeyFrameId &&
        (it.status === "started" || it.status === "in_progress")
      )
    })
  }, [liveGenItems, activeKeyFrameId])

  // The text to show for an assistant turn. The settle window can persist a
  // reply like "… 1 still generating — it will appear shortly." before slow
  // images (Midjourney) finish; once the image reconciles in, that clause is
  // stale and contradicts the shown image — so strip it (keeping any leading
  // "Done — …" part). Returns "" when nothing meaningful remains, so the bubble
  // is hidden and the image speaks for itself.
  const messageText = React.useCallback(
    (m: ChatMessage): string => {
      if (m.role !== "assistant" || !m.text) return m.text
      if (!m.generationIds?.length) return m.text
      if (!/still generating|appear shortly/i.test(m.text)) return m.text
      const cleaned = m.text
        .replace(/\s*;?\s*\d+\s+still generating\b.*?(?:shortly\.?|$)/i, "")
        .replace(/[\s;,—-]+$/, "")
        .trim()
      // Keep any "Done — …" portion. A pure-pending reply collapses to nothing:
      // hide it while still generating (the single bottom indicator shows the
      // status) and show a friendly confirmation once the image has landed.
      if (cleaned) return cleaned
      return messageImages(m).length > 0 ? "Done — the generated image is below." : ""
    },
    [messageImages],
  )

  // Drops the visible scope's saved mask (after sending it, or on the remove
  // button). Other scopes' masks are untouched.
  const clearMask = React.useCallback(() => {
    patchScope(scopeKey, { editMask: null, editMaskData: null, editMaskImageUrl: null })
  }, [patchScope, scopeKey])

  // Closing the chat (the header X) drops the keyframe's remembered Edit target
  // and returns to its default chat. What the default shows depends on whether
  // it has already produced an image:
  //   • Not yet (an empty draft or a TEXT-only conversation) — it's still a live
  //     chat, so we keep it: closing reveals the existing text conversation.
  //   • Already generated an image — that history now lives under the image
  //     (reopen via Edit), so we reset the default to a fresh, empty draft.
  // This is why "close" sometimes lingered before: a graduated conversation
  // stayed pinned to the default. We detach only that case, never a text chat.
  const closeChat = React.useCallback(() => {
    clearChatTarget(true)
    const key = `kf:${kfScope}`
    const def = chatByScopeRef.current[key]
    const hasImage = !!def?.messages.some(
      (m) => m.role === "assistant" && m.images.length > 0,
    )
    if (!hasImage) return // text-only / empty draft — keep it on screen
    clearStoredThreadId(kfScope)
    setChatByScope((prev) => {
      if (!(key in prev)) return prev
      const { [key]: _gone, ...rest } = prev
      return rest
    })
  }, [clearChatTarget, kfScope])

  // Keyframe/project switches are handled by the project context: it swaps in
  // the new keyframe's own remembered Edit target (or none), so each
  // keyframe's edit chat comes back exactly as it was left.

  const scrollToBottom = React.useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    })
  }, [])

  // Auto-scroll to the newest message whenever the conversation grows or a turn
  // goes in/out of flight (the "Thinking…/Generating…" bubble), and when the
  // latest turn's images land — so new chats are always brought into view.
  const lastMsg = messages[messages.length - 1]
  React.useEffect(() => {
    scrollToBottom()
  }, [messages.length, lastMsg?.images.length, sending, scrollToBottom])

  // Bootstrap: an Edit target opens (or reuses) that image's thread. The
  // keyframe default reopens its persisted draft thread (localStorage) so the
  // same conversation comes back after navigation/refresh — falling back to a
  // brand-new draft when none is stored (or the stored one was deleted).
  // Runs once per scope (its entry then carries threadId/loading); revisiting
  // a scope shows its cached conversation instantly.
  React.useEffect(() => {
    if (!targetItem && (!currentProject?.id || !activeKeyFrameId)) return
    const existing = chatByScopeRef.current[scopeKey]
    if (existing && (existing.threadId || existing.loading)) return
    const scope = scopeKey
    patchScope(scope, { loading: true })
      ; (async () => {
        try {
          let res: ThreadResponse | null = null
          if (targetItem) {
            res = (await apiRequest("/agent/threads", {
              method: "POST",
              body: JSON.stringify({ image_id: targetItem.id }),
            })) as ThreadResponse
          } else {
            const stored = readStoredThreadId(kfScope)
            if (stored) {
              try {
                res = (await apiRequest(`/agent/threads/${stored}`, {
                  method: "GET",
                })) as ThreadResponse
              } catch {
                res = null // stale id (thread deleted) — start fresh below
              }
            }
            if (!res) {
              res = (await apiRequest("/agent/threads", {
                method: "POST",
                body: JSON.stringify({
                  project_id: currentProject?.id,
                  key_frame_id: activeKeyFrameId,
                }),
              })) as ThreadResponse
            }
            writeStoredThreadId(kfScope, res.thread.id)
          }
          const mapped = (res.messages ?? []).map(toChatMessage)
          // For an edit thread (anchored to a specific image), surface the
          // original instruction as the "EDIT IMAGE" card at the top every
          // time it's reopened — server rows don't carry editImage themselves.
          const baseUrl = res.thread.base_image_url ?? null
          if (baseUrl && scope.startsWith("img:")) {
            const i = mapped.findIndex((m) => m.role === "user")
            if (i >= 0) mapped[i] = { ...mapped[i], editImage: baseUrl }
          }
          patchScope(scope, {
            threadId: res.thread.id,
            threadMeta: {
              imageUrl: res.thread.base_image_url,
              title: res.thread.title,
            },
            messages: mapped,
            loading: false,
          })
          // Edit (image-anchored) chat: prefill the composer settings with the
          // edited image's own aspect ratio / resolution, so it defaults to the
          // image's shape instead of 1:1. Only apply known option values so the
          // segmented control still highlights correctly.
          if (scope.startsWith("img:")) {
            const ar = (res.thread.aspect_ratio || "").trim()
            if (ar && ASPECT_OPTIONS.includes(ar)) setAspect(ar)
            const rs = (res.thread.resolution || "").trim().toUpperCase()
            if (rs && RESOLUTION_OPTIONS.includes(rs)) setResolution(rs)
          }
          if (scopeRef.current === scope) scrollToBottom()
        } catch (err) {
          // Drop the entry so the next visit to this scope retries the load.
          setChatByScope((prev) => {
            const { [scope]: _gone, ...rest } = prev
            return rest
          })
          if (scopeRef.current === scope) {
            toast.error("Failed to load chat", {
              description: err instanceof Error ? err.message : String(err),
            })
          }
        }
      })()
  }, [targetItem, scopeKey, kfScope, currentProject?.id, activeKeyFrameId, patchScope, scrollToBottom])

  // Revoke any object URLs still owned by the composer (un-sent references) on
  // unmount so previews don't leak. Sent messages keep their URLs alive.
  const liveRefUrls = React.useRef<Set<string>>(new Set())
  React.useEffect(
    () => () => liveRefUrls.current.forEach((u) => URL.revokeObjectURL(u)),
    [],
  )

  // Close the settings / chat-model popovers on outside click / Escape. Both
  // live inside settingsRef, so a click outside it dismisses whichever is open.
  React.useEffect(() => {
    if (!settingsOpen && !llmOpen) return
    const closeAll = () => {
      setSettingsOpen(false)
      setLlmOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) closeAll()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll()
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [settingsOpen, llmOpen])

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (images.length === 0) return
    patchScope(scopeKey, (s) => {
      const room = MAX_REFERENCES - s.refs.length
      const toAdd = images.slice(0, room).map((file) => {
        const url = URL.createObjectURL(file)
        liveRefUrls.current.add(url)
        return { id: makeId(), file, url }
      })
      return { refs: [...s.refs, ...toAdd] }
    })
  }

  const removeRef = (id: string) => {
    patchScope(scopeKey, (s) => {
      const target = s.refs.find((r) => r.id === id)
      if (target) {
        URL.revokeObjectURL(target.url)
        liveRefUrls.current.delete(target.url)
      }
      return { refs: s.refs.filter((r) => r.id !== id) }
    })
  }

  // Drag-and-drop onto the panel. A workspace image (stamped with
  // ITEM_DRAG_TYPE at dragstart) anchors the chat to that image's edit thread
  // — identical to clicking its Edit button. Local image files are added as
  // reference thumbnails, like the + button. Plain-text drags fall through to
  // the textarea's native handling. Depth-tracked so dragging across child
  // nodes doesn't flicker the overlay.
  const [dragKind, setDragKind] = React.useState<"item" | "files" | null>(null)
  const dragDepthRef = React.useRef(0)

  const dropKindOf = (e: React.DragEvent): "item" | "files" | null => {
    const types = Array.from(e.dataTransfer?.types ?? [])
    if (types.includes(ITEM_DRAG_TYPE)) return "item"
    if (types.includes("Files")) return "files"
    return null
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    const kind = dropKindOf(e)
    if (!kind) return
    e.preventDefault()
    dragDepthRef.current += 1
    setDragKind(kind)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dropKindOf(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dropKindOf(e)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragKind(null)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const kind = dropKindOf(e)
    dragDepthRef.current = 0
    setDragKind(null)
    if (!kind) return
    e.preventDefault()
    if (kind === "item") {
      const item = getItemDragPayload(e.dataTransfer)
      if (item?.id && item.url) openChatForItem(item)
      return
    }
    addFiles(e.dataTransfer.files)
  }

  // The agent endpoint needs text; references alone can't be sent (yet).
  const canSend = input.trim().length > 0 && !!threadId && !sending && !uploadingRefs

  // Shared POST /agent/chat path for typed messages AND model-selection
  // confirmations (which carry models + the pending action echoed back).
  const performChat = async (
    userText: string,
    userImages: string[],
    extra: Record<string, unknown>,
    kind: "thinking" | "generating",
    editImage: string | null = null,
    maskRecord: { url: string; mask: string } | null = null,
  ) => {
    if (!threadId) return
    // Captured once: every state write below targets THIS scope's entry, so
    // the reply (or error) lands in the conversation that sent the turn even
    // if the user is on another keyframe by then — and other scopes' chats
    // stay fully usable while this one is in flight.
    const scope = scopeKey
    const tid = threadId
    const kf = kfScope
    const anchored = !!targetItem
    const projectId = currentProject?.id
    patchScope(scope, (s) => ({
      messages: [
        ...s.messages,
        { id: makeId(), role: "user", text: userText, images: userImages, editImage, maskRecord },
      ],
      sending: true,
      sendingKind: kind,
    }))
    scrollToBottom()
    try {
      const res = (await apiRequest("/agent/chat", {
        method: "POST",
        body: JSON.stringify({
          thread_id: tid,
          message: userText,
          llm,
          // Generation settings from the composer's settings popover, so images
          // this turn creates use the chosen count/aspect/resolution. Resolution
          // is sent lower-cased to match the PROMPT tab ("hd"/"2k"/"4k").
          aspect_ratio: aspect,
          resolution: resolution.toLowerCase(),
          count: parseInt(count, 10) || 1,
          ...extra,
        }),
      })) as ChatResponse
      // Generating the first image in a draft thread re-keys it to that
      // image's id on the backend — adopt the new id so the rest of THIS
      // session keeps flowing into one thread. For the keyframe default, forget
      // the persisted id (rather than re-pinning it to the graduated thread):
      // the conversation now lives under the image (reopen via Edit), so a
      // refresh should start a fresh chat instead of reloading this one.
      if (res.thread_id && res.thread_id !== tid) {
        patchScope(scope, { threadId: res.thread_id })
        if (!anchored) clearStoredThreadId(kf)
      }
      const genIds = (res.generation_ids ?? []).filter(Boolean) as string[]
      patchScope(scope, (s) => ({
        messages: [
          ...s.messages,
          {
            id: makeId(),
            role: "assistant",
            text: res.reply || "",
            images: completedUrls(res.images),
            modelRequest: res.model_request ?? null,
            generationIds: genIds.length ? genIds : undefined,
          },
        ],
      }))
      // The reply can come back before slow providers (Midjourney) finish — the
      // generation runs detached on the server. Register an optimistic item per
      // generation so the workspace's `/generations/{project_id}` poll fallback
      // kicks in (in multi-worker production SSE can't always reach the
      // browser), surfacing the images on the right WITHOUT a manual refresh and
      // auto-clearing once the real rows land (matched by generation_id).
      const genProject = res.project_id ?? projectId
      if (res.pending && genIds.length && genProject) {
        const batch = makeId()
        const now = new Date().toISOString()
        addOptimisticItems(
          genIds.map((gid) => ({
            id: `optgen_${gid}`,
            status: "started" as const,
            project_id: genProject,
            key_frame_id: res.key_frame_id ?? activeKeyFrameId ?? undefined,
            created_at: now,
            generation_id: gid,
            // Tag as a chat generation so the chat's single "Generating…"
            // indicator picks it up immediately (no gap before the real row
            // streams in), without affecting prompt-panel placeholders.
            gen_params: { source: "chat" },
            _optimistic: true as const,
            _clientBatchId: batch,
          })),
        )
      }
      // Anything the agent generated also belongs to the keyframe — refresh
      // the project so it shows up in the workspace alongside the chat. Only
      // while that project is still the one on screen (switching keyframes
      // within it is fine; refreshing a project the user left is not).
      if (projectId && currentProjectIdRef.current === projectId) {
        void refreshCurrentProject(projectId)
      }
    } catch (err) {
      patchScope(scope, (s) => ({
        messages: [
          ...s.messages,
          {
            id: makeId(),
            role: "assistant",
            text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
            images: [],
          },
        ],
      }))
    } finally {
      patchScope(scope, { sending: false })
      if (scopeRef.current === scope) scrollToBottom()
    }
  }

  const send = async () => {
    if (!canSend || !threadId) return
    // The scope the user hit Send in — uploads and the draft clear below
    // target it even if the visible keyframe changes mid-upload.
    const scope = scopeKey
    const text = input.trim()
    // In-session the message shows the local blob previews (they render
    // immediately, unlike a freshly-stored URL which may be a dev file:// path
    // the browser can't load). The hosted URLs ride along to the backend for
    // generation and are persisted on the message so it reloads after refresh.
    const images = refs.map((r) => r.url)
    const refFiles = refs.map((r) => r.file)
    // First turn of an edit: tag the message with the image being edited so it
    // renders as the "EDIT IMAGE" card.
    const editImage = staged ? anchorUrl : null
    // A painted mask (if any) rides along with this turn, then resets. The
    // backend uploads it to storage and passes it (with the image it was
    // painted on) as reference images to the edit model.
    const extra: Record<string, unknown> = editMaskData
      ? {
          mask: editMaskData,
          ...(editMaskImageUrl ? { mask_image_url: editMaskImageUrl } : {}),
        }
      : {}
    // Snapshot the painted mask onto the turn so the masked image stays visible
    // in the chat after sending (clearMask() below wipes the live mask state).
    const maskRecord =
      editMaskData && editMask && editMaskImageUrl
        ? { url: editMaskImageUrl, mask: editMask }
        : null
    // Attached reference images: upload to app storage first, then send the
    // hosted URLs with the turn — the edit models receive them alongside the
    // image being edited (which stays the FIRST/base reference).
    if (refFiles.length > 0) {
      patchScope(scope, { uploadingRefs: true })
      try {
        const uploaded = await Promise.all(
          refFiles.map((f) => uploadReferenceImage(null, f)),
        )
        // Hosted URLs go to the backend (generation + persistence); the message
        // keeps showing the blob previews in-session.
        extra.reference_images = uploaded.map((u) => u.url)
      } catch (err) {
        toast.error("Reference upload failed", {
          description: err instanceof Error ? err.message : String(err),
        })
        return
      } finally {
        patchScope(scope, { uploadingRefs: false })
      }
    }
    // The message now owns these blob URLs (rendered in the conversation) — drop
    // them from the live set so unmount cleanup doesn't revoke them.
    images.forEach((u) => liveRefUrls.current.delete(u))
    patchScope(scope, { input: "", refs: [] })
    clearMask()
    // Always start on "Thinking…" — never assume a turn will generate just
    // because it carries an image or reads like a request. The indicator flips
    // to "Generating…" only when a real generation actually starts, detected
    // from the live generation stream (see `hasActiveKeyframeGen`).
    void performChat(text, images, extra, "thinking", editImage, maskRecord)
  }

  // The user picked model(s) on a selection request: echo the choice back with
  // the pending action so the backend runs one generation per selected model.
  const confirmModels = (request: ModelRequest, models: string[]) => {
    if (!threadId || sending || models.length === 0) return
    const labels = models.map(
      (v) => request.options.find((o) => o.value === v)?.label ?? v,
    )
    void performChat(
      `Use ${labels.join(", ")}`,
      [],
      {
        models,
        pending_action: request.action,
        pending_instruction: request.instruction ?? "",
        // The mask uploaded with the original request (if any) — echoed back
        // so the confirmed edit still applies it to the image it was painted on.
        ...(request.mask_url ? { mask_url: request.mask_url } : {}),
        ...(request.mask_image_url ? { mask_image_url: request.mask_image_url } : {}),
        ...(request.reference_images?.length
          ? { reference_images: request.reference_images }
          : {}),
      },
      "generating",
    )
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const emptyHint = threadLoading ? "Loading conversation…" : "Start a conversation"

  const anchorUrl = targetItem?.url ?? threadMeta?.imageUrl ?? null

  // Whether a generation has already produced an image in this thread.
  const hasResult = messages.some((m) => m.role === "assistant" && m.images.length > 0)
  // Whether the conversation already shows the edit image as a sent mask record
  // — if so, the staged preview would be a duplicate of it.
  const hasMaskRecord = messages.some((m) => !!m.maskRecord)

  // The image being edited is shown above the composer until a generation lands
  // — large at first (brand-new edit, no chat), then inside the conversation on
  // the user (right) side once the user has started chatting but hasn't
  // generated yet. Suppressed once a masked send already records the image in
  // the conversation (so it isn't shown twice).
  const showStageImage =
    !!targetItem && !!anchorUrl && !threadLoading && !hasResult && !hasMaskRecord
  const staged = showStageImage && messages.length === 0

  // Only the newest message's model selector is actionable — older requests
  // are kept visible but disabled (they were answered or superseded).
  const lastMessageId = messages[messages.length - 1]?.id

  // The edit turn (image + instruction) is pinned above the conversation as a
  // header rather than scrolling with the messages.
  const editHeader = messages.find((m) => m.role === "user" && m.editImage) ?? null

  // The header shows the EDITED image's own generation prompt — the prompt that
  // produced it — not the user's first chat instruction. Comes from the clicked
  // Edit target, falling back to the thread title (which the server seeds from
  // the base image's prompt).
  const editPrompt = targetItem?.prompt ?? threadMeta?.title ?? null

  // When the edit thread ALREADY has a conversation, the image being edited is
  // shown at the top of the chat on the USER side (right), at generated-image
  // size, with the mask tools — until a generation lands. (A brand-new edit
  // with no chat instead shows the large staged image above the composer.)
  const stagedImageEl =
    showStageImage && messages.length > 0 && anchorUrl ? (
      <div className="flex flex-wrap justify-end gap-1.5 w-full">
        <div className="relative group/cstage" style={{ width: "50%" }}>
          <img
            src={anchorUrl}
            alt=""
            className="w-full h-auto object-contain border border-border60"
          />
          {editMask && editMaskImageUrl === anchorUrl && (
            <img
              src={editMask}
              alt=""
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
          )}
          <button
            type="button"
            onClick={() => setMaskEditorUrl(anchorUrl)}
            className="absolute top-2 left-2 size-8 flex items-center justify-center bg-black/70 text-white hover:bg-black/80 transition-colors"
            title="Mask the image"
          >
            <IconBrush className="size-4" />
          </button>
          {editMaskImageUrl === anchorUrl && (
            <button
              type="button"
              onClick={clearMask}
              className="absolute top-2 left-11 size-8 flex items-center justify-center bg-black/70 text-white hover:bg-black/80 transition-colors"
              title="Remove mask"
            >
              <IconEraser className="size-4" />
            </button>
          )}
          {/* No cancel (X) here — the pinned top header already provides it
              whenever a chat exists. */}
        </div>
      </div>
    ) : null

  return (
    <div
      className="relative flex-1 min-h-0 flex flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop hint while an image is dragged over the panel. */}
      {dragKind && (
        <div className="absolute inset-0 z-50 pointer-events-none border-2 border-dashed border-accent-foreground/40 bg-secondary/70 flex items-center justify-center">
          <span className="flex items-center gap-2 text-sm tracking-wide text-muted-foreground">
            <IconBrush className="size-4" />
            {dragKind === "item" ? "Drop to edit this image" : "Drop to add reference images"}
          </span>
        </div>
      )}

      {/* Pinned EDIT IMAGE header — the edit turn stays fixed above the
          conversation instead of scrolling away with the messages. */}
      {editHeader?.editImage && (
        <div className="shrink-0 mx-3 mt-3 flex items-center gap-2.5 border border-border60 bg-secondary/40 px-1 py-1">
          <img
            src={editHeader.editImage}
            alt=""
            className="h-10 w-14 shrink-0 object-cover border border-border60"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
              Edit image
            </div>
            {editPrompt && (
              <div className="text-xs text-muted-foreground/70 break-words line-clamp-2">
                {editPrompt}
              </div>
            )}
          </div>
          {/* Exit the edit and start a fresh, empty chat (also forgets the
              keyframe's remembered edit, so it won't come back on revisit). */}
          <button
            type="button"
            onClick={closeChat}
            className="shrink-0 mr-1 size-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="New chat"
          >
            <IconX className="size-4" />
          </button>
        </div>
      )}

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {messages.length === 0 && !sending && !hasActiveKeyframeGen ? (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <span className="text-sm tracking-wide text-muted-foreground/50">
              {emptyHint}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-3 py-3">
            {/* The image being edited sits at the top of the conversation
                (above the first message), on the user (right) side. */}
            {stagedImageEl}
            {messages.map((m) =>
              m.role === "user" ? (
                  <div key={m.id} className="flex flex-col items-end gap-1.5 w-full">
                    {/* The masked image sent with this turn, kept as a record
                        (image + the painted mask overlay), on the user side. */}
                    {m.maskRecord && (
                      <div className="relative" style={{ width: "50%" }}>
                        <img
                          src={m.maskRecord.url}
                          alt=""
                          className="w-full h-auto object-contain border border-border60"
                        />
                        <img
                          src={m.maskRecord.mask}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                        />
                      </div>
                    )}
                    {m.images.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {m.images.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt=""
                            className="h-14 w-20 object-cover border border-border60"
                          />
                        ))}
                      </div>
                    )}
                    {m.text && (
                      <div
                        // Inline width cap so it doesn't depend on a Tailwind
                        // arbitrary class (e.g. max-w-[85%]) being present in the
                        // prebuilt compiled.css. fit-content hugs short text;
                        // maxWidth caps long text and forces it to wrap.
                        style={{ width: "fit-content", maxWidth: "85%" }}
                        className="whitespace-pre-wrap break-words bg-secondary border border-border60 px-3 py-2 text-sm leading-relaxed"
                      >
                        {m.text}
                      </div>
                    )}
                  </div>
              ) : (
                <div key={m.id} className="flex flex-col items-start gap-1.5 w-full">
                  {messageText(m) && (
                    <div
                      style={{ width: "fit-content", maxWidth: "85%" }}
                      className="whitespace-pre-wrap break-words text-foreground border border-border60 px-3 py-2 text-sm leading-relaxed"
                    >
                      {messageText(m)}
                    </div>
                  )}
                  {messageImages(m).length === 0 &&
                    !!m.generationIds?.length &&
                    messageGenFailed(m) && (
                      // The generation failed. (The still-generating state is
                      // shown once, by the single bottom indicator below.)
                      <div className="bg-secondary border border-border60 px-3 py-2 text-sm leading-relaxed text-destructive/80">
                        Generation failed — please try again.
                      </div>
                    )}
                  {messageImages(m).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 w-full">
                      {messageImages(m).map((src, i) => (
                        // Half the chat panel's width, height following the
                        // image's own aspect. Inline so it doesn't depend on
                        // a w-1/2 utility existing in the prebuilt CSS.
                        <div key={i} className="relative group/cgen" style={{ width: "50%" }}>
                          <img
                            src={src}
                            alt=""
                            className="w-full h-auto object-contain border border-border60"
                          />
                          {/* Saved mask previewed over the image it was painted on. */}
                          {editMask && editMaskImageUrl === src && (
                            <img
                              src={editMask}
                              alt=""
                              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                            />
                          )}
                          {/* Mask this generated image — the mask rides along
                              with the next instruction and the edit targets
                              this image. */}
                          <button
                            type="button"
                            onClick={() => setMaskEditorUrl(src)}
                            className={cn(
                              "absolute top-2 left-2 size-8 flex items-center justify-center bg-black/70 text-white hover:bg-black/80 transition-opacity",
                              editMaskImageUrl === src
                                ? "opacity-100"
                                : "opacity-0 group-hover/cgen:opacity-100",
                            )}
                            title="Mask the image"
                          >
                            <IconBrush className="size-4" />
                          </button>
                          {editMaskImageUrl === src && (
                            <button
                              type="button"
                              onClick={clearMask}
                              className="absolute top-2 right-2 size-8 flex items-center justify-center bg-black/70 text-white hover:bg-black/80 transition-colors"
                              title="Remove mask"
                            >
                              <IconEraser className="size-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.modelRequest && (
                    <ModelSelector
                      request={m.modelRequest}
                      disabled={m.id !== lastMessageId}
                      busy={sending}
                      onConfirm={(models) => confirmModels(m.modelRequest!, models)}
                    />
                  )}
                </div>
              ),
            )}
            {(sending || hasActiveKeyframeGen) && (
              <div className="flex w-full">
                {sendingKind === "generating" || hasActiveKeyframeGen ? (
                  <div className="flex items-center gap-2 bg-secondary border border-border60 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                    <IconLoader2 className="size-4 pltt-animate-spin" />
                    Generating…
                  </div>
                ) : (
                  <div className="bg-secondary border border-border60 px-3 py-2 text-sm leading-relaxed text-muted-foreground animate-pulse">
                    Thinking…
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Staged edit image + composer, separated from the conversation above
          by a border-t. */}
      <div className="shrink-0 border-t border-border">
        {/* The image being edited, staged large with a brush badge until the
          first edit instruction is sent. */}
        {staged && anchorUrl && (
          <div className="relative mx-3 mt-3">
            <img
              src={anchorUrl}
              alt=""
              style={{ maxHeight: "45vh" }}
              className="w-full h-auto object-contain border border-border60"
            />
            {/* Saved mask previewed over the image (same aspect → exact overlay). */}
            {editMask && editMaskImageUrl === anchorUrl && (
              <img
                src={editMask}
                alt=""
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              />
            )}
            <button
              type="button"
              onClick={() => setMaskEditorUrl(anchorUrl)}
              className="absolute top-2 left-2 size-8 flex items-center justify-center bg-black/70 text-white hover:bg-black/80 transition-colors"
              title="Mask the image"
            >
              <IconBrush className="size-4" />
            </button>
            <button
              type="button"
              onClick={closeChat}
              className="absolute top-2 right-2 size-8 flex items-center justify-center bg-black/70 text-white hover:bg-black/80 transition-colors"
              title="Cancel edit"
            >
              <IconX className="size-4" />
            </button>
          </div>
        )}
        <div className="p-3">
          {/* Selected reference images sit just above the input box, right-aligned. */}
          {refs.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2 pb-2">
              {refs.map((r) => (
                <div
                  key={r.id}
                  className="relative group/cref h-14 w-20 overflow-hidden border border-border60"
                >
                  <img src={r.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeRef(r.id)}
                    className="absolute top-0 right-0 size-4 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/cref:opacity-100 transition-opacity"
                    title="Remove"
                  >
                    <IconX className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col border border-border60 bg-input/50 focus-within:border-accent-foreground/30 transition-colors">
            <textarea
              value={input}
              onChange={(e) => patchScope(scopeKey, { input: e.target.value })}
              onKeyDown={onKeyDown}
              placeholder={
                staged
                  ? "Describe the edits you'd like…"
                  : threadId
                    ? "Send a message…"
                    : "Loading conversation…"
              }
              rows={2}
              disabled={!threadId && !threadLoading}
              className="w-full resize-none bg-transparent px-3 pt-3 pb-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed"
            />

            <div className="flex items-center justify-between p-2">
              <div ref={settingsRef} className="relative flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ""
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size={"icon"}
                  onClick={() => fileInputRef.current?.click()}
                  title="Add reference images"
                >
                  <IconPlus />
                </Button>
                <Button
                  type="button"
                  variant={settingsOpen ? "secondary" : "outline"}
                  size={"icon"}
                  onClick={() => {
                    setSettingsOpen((o) => !o)
                    setLlmOpen(false)
                  }}
                  title="Generation settings"
                >
                  <IconSettings />
                </Button>
                <Button
                  type="button"
                  variant={llmOpen ? "secondary" : "outline"}
                  size={"icon"}
                  onClick={() => {
                    setLlmOpen((o) => !o)
                    setSettingsOpen(false)
                  }}
                  title={`Chat model: ${LLM_OPTIONS.find((o) => o.value === llm)?.label ?? "GPT"}`}
                >
                  <IconSparkles />
                </Button>

                {/* Settings popover, opens above the controls. */}
                {settingsOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-60 bg-popover text-popover-foreground border border-border shadow-xl z-50">
                    <SettingsSection label="Count" options={COUNT_OPTIONS} value={count} onChange={setCount} />
                    <SettingsSection label="Aspect" options={ASPECT_OPTIONS} value={aspect} onChange={setAspect} />
                    <SettingsSection label="Resolution" options={RESOLUTION_OPTIONS} value={resolution} onChange={setResolution} />
                  </div>
                )}

                {/* Chat-model picker — switch the LLM driving the chat anytime. */}
                {llmOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-44 bg-popover text-popover-foreground border border-border shadow-xl z-50">
                    <div className="px-4 py-3">
                      <div className="mb-2 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
                        Chat model
                      </div>
                      <div className="flex">
                        {LLM_OPTIONS.map((opt) => (
                          <Button
                            key={opt.value}
                            type="button"
                            size="xs"
                            variant={llm === opt.value ? "default" : "outline"}
                            className="flex-1 [&:not(:first-child)]:-ml-px"
                            onClick={() => {
                              setLlm(opt.value)
                              setLlmOpen(false)
                            }}
                          >
                            {opt.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="default"
                size={"icon"}
                onClick={() => void send()}
                disabled={!canSend}
                title="Send"
              >
                <IconSend />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {maskEditorUrl && (
        <MaskEditorModal
          imageUrl={maskEditorUrl}
          // Reopening the editor for the image the saved mask was painted on
          // continues from that mask instead of starting blank.
          initialMask={editMaskImageUrl === maskEditorUrl ? editMaskData : null}
          onCancel={() => setMaskEditorUrl(null)}
          onSave={({ preview, mask }) => {
            patchScope(scopeKey, {
              editMask: preview,
              editMaskData: mask,
              editMaskImageUrl: maskEditorUrl,
            })
            setMaskEditorUrl(null)
            toast.success("Mask saved — it will apply to your next instruction")
          }}
        />
      )}
    </div>
  )
}
