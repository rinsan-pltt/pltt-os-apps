"use client"

// Scene chat — the reference design's Storyboard/Animate Agent rail.
// Presentational shell: message list + input. The actual backend call and
// what to DO with its result (edit a prompt, regenerate, jump to another
// scene…) lives entirely in `onSend`, passed in by the screen that owns the
// session/actions. Without an `onSend` (e.g. the Animate screen for now), it
// falls back to a one-time "coming soon" note.

import * as React from "react"
import { IconChevronDown, IconSparkles } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import type { StoryChatMessage, StoryLlm } from "@/components/providers/story-video-context"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { llmLabel, storyLlmModels } from "./engine"
import { usePosT } from "./i18n"

type ChatMsg = StoryChatMessage

export interface SceneChatReply {
  reply: string
  // Small system-style aside shown after the reply (e.g. "switched to Scene
  // 03" when the message targeted a different scene than the one in focus).
  note?: string
}

export interface MentionScene {
  index: number
  title: string
}

// English regardless of UI language — matches the "scene N" pattern
// storyboard.tsx's resolveMentionedScene() looks for when resolving a
// cross-scene chat message, and the literal chip text seen elsewhere
// ("@Scene 06").
function mentionLabel(index: number): string {
  return `Scene ${String(index + 1).padStart(2, "0")}`
}

export function SceneChat({
  accent,
  title,
  context,
  hasContent,
  messages,
  onMessagesChange,
  onSend,
  llmModel,
  onLlmChange,
  scenes,
  onMentionSelect,
}: {
  accent: "vio" | "org"
  title: string
  // "@Scene 03"-style context chip for the message being written.
  context: string
  // Whether the selected scene already has a finished image (Storyboard) /
  // clip (Animate) — the header hint reads "Generate" before that exists
  // and "Edit" once it does, since at that point this chat is refining
  // something rather than making it from nothing.
  hasContent?: boolean
  // The conversation itself — owned by the caller (persisted on the
  // session, e.g. `session.storyboardChatMessages`) rather than local state,
  // so it survives switching tabs/screens and a page refresh.
  messages: ChatMsg[]
  onMessagesChange: (messages: ChatMsg[]) => void
  // Real backend hook: resolves with the assistant's reply once any
  // side-effect (prompt edit, regenerate, generate-all…) has been kicked off.
  // Omit to keep the chat as a UI-only placeholder.
  onSend?: (text: string) => Promise<SceneChatReply>
  // Which LLM this chat's own requests are written with — same picker the
  // user already has on Home/Brief for planning, surfaced here too since
  // it's just as reasonable to switch it mid-conversation. Omit both to hide
  // the switcher (e.g. Animate's chat, not backend-wired yet).
  llmModel?: StoryLlm
  onLlmChange?: (v: StoryLlm) => void
  // Every scene in the board, for the "@" mention autocomplete below.
  scenes: MentionScene[]
  // Fired the moment a mention is PICKED (click/Enter), not at send time —
  // moves the inspector's own selection to match, same as a manual scene-
  // rail click would.
  onMentionSelect?: (index: number) => void
}) {
  const { t } = usePosT()
  const [draft, setDraft] = React.useState("")
  const [thinking, setThinking] = React.useState(false)
  const [llmPickerOpen, setLlmPickerOpen] = React.useState(false)
  // Only guards against re-adding the "coming soon" placeholder within a
  // single mount — primed from whatever's already persisted so a session
  // that already has it doesn't get a second copy after a refresh.
  const notedRef = React.useRef(
    messages.some((m) => m.role === "note" && m.text === t("chatComingSoon")),
  )
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const accT = accent === "vio" ? "var(--pos-vioT)" : "var(--pos-orgT)"
  const accS = accent === "vio" ? "var(--pos-vioS)" : "var(--pos-orgS)"

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, thinking])

  // ---- "@" mention autocomplete -------------------------------------------
  // Active whenever the cursor sits right after an "@" with no whitespace in
  // between — mentionStart/mentionEnd bound the span in `draft` that gets
  // replaced once a scene is picked.
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [mentionStart, setMentionStart] = React.useState<number | null>(null)
  const [mentionEnd, setMentionEnd] = React.useState<number | null>(null)
  const [highlightIndex, setHighlightIndex] = React.useState(0)
  const pendingCursorRef = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    if (pendingCursorRef.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current)
      pendingCursorRef.current = null
    }
  }, [draft])

  const closeMention = () => {
    setMentionQuery(null)
    setMentionStart(null)
    setMentionEnd(null)
  }

  const updateMentionFromCursor = (value: string, cursor: number) => {
    const at = value.slice(0, cursor).lastIndexOf("@")
    if (at === -1) {
      closeMention()
      return
    }
    const between = value.slice(at + 1, cursor)
    if (/\s/.test(between)) {
      closeMention()
      return
    }
    setMentionStart(at)
    setMentionEnd(cursor)
    setMentionQuery(between)
    setHighlightIndex(0)
  }

  const filteredScenes = React.useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.trim().toLowerCase()
    if (!q) return scenes
    return scenes.filter(
      (s) => mentionLabel(s.index).toLowerCase().includes(q) || s.title.toLowerCase().includes(q),
    )
  }, [scenes, mentionQuery])

  // Picking a scene is purely a selection action, same as clicking it in the
  // scene rail — the "@query" the user typed to open this dropdown is
  // removed rather than replaced with mention text, so nothing shows up in
  // the message itself.
  const selectMention = (sceneIndex: number) => {
    if (mentionStart == null || mentionEnd == null) return
    const newDraft = `${draft.slice(0, mentionStart)}${draft.slice(mentionEnd)}`
    pendingCursorRef.current = mentionStart
    setDraft(newDraft)
    closeMention()
    onMentionSelect?.(sceneIndex)
    inputRef.current?.focus()
  }

  const send = () => {
    const text = draft.trim()
    if (!text || thinking) return
    setDraft("")
    const withUser: ChatMsg[] = [...messages, { role: "user", text, chip: context }]
    onMessagesChange(withUser)

    if (!onSend) {
      // Backend not wired for this screen yet — answer once with a note.
      if (!notedRef.current) {
        notedRef.current = true
        onMessagesChange([...withUser, { role: "note", text: t("chatComingSoon") }])
      }
      return
    }

    setThinking(true)
    onSend(text)
      .then((res) => {
        const next: ChatMsg[] = [
          ...withUser,
          { role: "assistant", text: res.reply || t("chatEmptyReply") },
        ]
        if (res.note) next.push({ role: "note", text: res.note })
        onMessagesChange(next)
      })
      .catch((err) => {
        onMessagesChange([
          ...withUser,
          { role: "note", text: err instanceof Error ? err.message : String(err) },
        ])
      })
      .finally(() => setThinking(false))
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2.5" style={{ minHeight: 160 }}>
      {/* Header — the right-side badge is a hint about what the chat is FOR
          (generate/edit), not which scene: the scene is already shown right
          above this in the inspector card, so repeating it here (e.g. via
          `context`, "@Scene 01") would just be the same number twice. Each
          message still gets its own `context` chip below, since THAT can
          legitimately differ message-to-message (mentioning another scene,
          or switching the selection mid-conversation). */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-[12.5px] font-semibold text-[var(--pos-t1)] truncate">{title}</span>
        <span
          className="pos-mono text-[10px] px-1.5 py-[1.5px] rounded whitespace-nowrap"
          style={{ color: accT, background: accS }}
        >
          {hasContent ? t("chatHeaderHintEdit") : t("chatHeaderHintGenerate")}
        </span>
      </div>

      {/* The whole chat — messages, LLM picker and input — lives inside one
          contained pane (border only, no fill: the surrounding inspector
          card is already --pos-s1, and every bubble/control inside already
          carries its own --pos-s2/s3 background, so a filled box here would
          collide with one or the other depending on theme) rather than
          floating loose in the card. */}
      <div className="flex-1 min-h-0 border border-[var(--pos-b1)] rounded-[10px] p-2.5 flex flex-col gap-2.5">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5">
          {messages.length === 0 && !thinking && (
            <div className="flex-1 flex items-center justify-center text-center text-[11px] text-[var(--pos-t3)] px-4">
              {t("chatEmptyState")}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div
                key={i}
                className="self-end max-w-[88%] bg-[var(--pos-s3)] rounded-[10px] px-2.5 py-2 shrink-0"
              >
                {m.chip && (
                  <span
                    className="pos-mono text-[10px] font-medium px-1.5 py-[1.5px] rounded mr-1.5"
                    style={{ color: accT, background: accS }}
                  >
                    {m.chip}
                  </span>
                )}
                <span className="text-[12.5px] leading-relaxed text-[var(--pos-t1)]">{m.text}</span>
              </div>
            ) : m.role === "assistant" ? (
              // Same bubble treatment as the user's own messages (just
              // left-aligned) — the inspector panel behind the chat is
              // already --pos-s2, so this reuses --pos-s3 (like the user
              // bubble) rather than --pos-s2, which would be invisible
              // against its own background.
              <div
                key={i}
                className="self-start max-w-[88%] bg-[var(--pos-s3)] border border-[var(--pos-b2)] rounded-[10px] px-2.5 py-2 shrink-0"
              >
                <span className="text-[12.5px] leading-relaxed text-[var(--pos-t1)]">{m.text}</span>
              </div>
            ) : (
              <div key={i} className="text-xs leading-relaxed text-[var(--pos-t3)] shrink-0">
                {m.text}
              </div>
            ),
          )}
          {thinking && (
            <div className="shrink-0 text-xs pos-shimmer-text">{t("chatThinking")}</div>
          )}
        </div>

        {/* LLM picker — bottom-left, just above the input box. */}
        {llmModel && onLlmChange && (
          <div className="shrink-0 flex items-center justify-start">
            <Popover open={llmPickerOpen} onOpenChange={setLlmPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={t("chatLlmPickerTitle", { n: llmLabel(llmModel) })}
                  className="inline-flex items-center gap-1 pos-mono text-[10.5px] font-medium text-[var(--pos-t2)] bg-[var(--pos-s3)] border border-[var(--pos-b2)] rounded-full px-2.5 py-[4px] hover:text-[var(--pos-t1)] hover:border-[var(--pos-b3)] cursor-pointer transition-colors"
                >
                  <IconSparkles className="size-3" />
                  {llmLabel(llmModel)}
                  <IconChevronDown className="size-2.5 opacity-70" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={6}
                className="bg-[var(--pos-s2)] border-[var(--pos-b2)] rounded-[10px] p-[5px] shadow-[0_16px_48px_rgba(0,0,0,.45)] w-52"
              >
                {storyLlmModels.map((m) => {
                  const active = m.value === llmModel
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => {
                        onLlmChange(m.value)
                        setLlmPickerOpen(false)
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-[6px] px-2.5 py-[7px] cursor-pointer text-left transition-colors",
                        active ? "bg-[var(--pos-vioS)]" : "hover:bg-[var(--pos-s3)]",
                      )}
                    >
                      <span className="w-3 shrink-0 text-[10px] text-[var(--pos-vioT)]">{active ? "✓" : ""}</span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          active ? "text-[var(--pos-vioT)]" : "text-[var(--pos-t1)]",
                        )}
                      >
                        {m.label} {m.version}
                      </span>
                    </button>
                  )
                })}
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Input — the "@" mention popover anchors to this row so it opens
            right above the text field regardless of where the input sits. */}
        <Popover open={mentionQuery !== null} onOpenChange={(o) => !o && closeMention()}>
          <PopoverAnchor asChild>
            <div className="shrink-0 bg-[var(--pos-s3)] border border-[var(--pos-b1)] rounded-[10px] px-2.5 py-2 flex items-center gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  updateMentionFromCursor(e.target.value, e.target.selectionStart ?? e.target.value.length)
                }}
                onKeyDown={(e) => {
                  if (mentionQuery !== null && filteredScenes.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault()
                      setHighlightIndex((i) => (i + 1) % filteredScenes.length)
                      return
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault()
                      setHighlightIndex((i) => (i - 1 + filteredScenes.length) % filteredScenes.length)
                      return
                    }
                    if (e.key === "Enter") {
                      e.preventDefault()
                      selectMention(filteredScenes[highlightIndex].index)
                      return
                    }
                    if (e.key === "Escape") {
                      e.preventDefault()
                      closeMention()
                      return
                    }
                  }
                  if (e.key === "Enter") send()
                }}
                disabled={thinking}
                placeholder={t("chatPh")}
                className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12.5px] text-[var(--pos-t1)] placeholder:text-[var(--pos-t3)] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={send}
                disabled={thinking}
                className={cn(
                  "size-[26px] shrink-0 rounded-full border border-[var(--pos-b2)] flex items-center justify-center text-xs cursor-pointer transition-colors disabled:cursor-not-allowed",
                )}
                style={
                  draft.trim() && !thinking
                    ? { background: "var(--pos-inv-bg)", color: "var(--pos-inv-fg)" }
                    : { background: "var(--pos-s3)", color: "var(--pos-t3)" }
                }
              >
                ↑
              </button>
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className="bg-[var(--pos-s2)] border-[var(--pos-b2)] rounded-[10px] p-[5px] shadow-[0_16px_48px_rgba(0,0,0,.45)] w-56 max-h-56 overflow-y-auto"
          >
            {filteredScenes.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-[var(--pos-t3)]">{t("noScenesFound")}</div>
            ) : (
              filteredScenes.map((s, i) => (
                <button
                  key={s.index}
                  type="button"
                  // Keeps focus on the input instead of stealing it on mousedown.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectMention(s.index)}
                  onMouseEnter={() => setHighlightIndex(i)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-[6px] px-2.5 py-[6px] cursor-pointer text-left transition-colors",
                    i === highlightIndex ? "bg-[var(--pos-vioS)]" : "hover:bg-[var(--pos-s3)]",
                  )}
                >
                  <span
                    className={cn(
                      "pos-mono text-[10.5px] font-medium shrink-0",
                      i === highlightIndex ? "text-[var(--pos-vioT)]" : "text-[var(--pos-t1)]",
                    )}
                  >
                    {mentionLabel(s.index)}
                  </span>
                  <span className="text-[10.5px] text-[var(--pos-t3)] truncate">{s.title}</span>
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
