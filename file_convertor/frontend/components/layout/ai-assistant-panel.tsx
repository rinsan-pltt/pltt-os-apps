"use client"

/**
 * The Edit Document AI assistant: a chat beside the pages.
 *
 * Each prompt sends a fresh outline of the document as it is NOW (so manual
 * edits made between prompts are seen), the model replies with an answer and
 * operations, and the operations are applied straight to the editor. Every
 * applied reply keeps a snapshot of the document from before it, so the most
 * recent change can be undone from the chat.
 */

import * as React from "react"
import { Loader2, SendHorizontal, Sparkles, Undo2, X } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { askAssistant } from "@/lib/api"
import { applyOperations, buildOutline, type EditorSelection } from "@/lib/doc-assistant"
import { preserveScroll } from "@/lib/dom-selection"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
  applied?: number
  skipped?: string[]
  /** The editor's HTML from before this reply's changes. */
  snapshot?: string
  undone?: boolean
}

export function AiAssistantPanel({
  editorRef,
  isSheet,
  onChanged,
  getSelection,
  onRestored,
  onClose,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>
  isSheet: boolean
  /** The document was edited by the assistant — mark it dirty. */
  onChanged: () => void
  /** What the user has selected in the document right now. */
  getSelection: () => EditorSelection
  /** The document's markup was replaced wholesale (undo) — re-fit the pages. */
  onRestored: () => void
  onClose: () => void
}) {
  const t = useT()
  const [messages, setMessages] = React.useState<Message[]>([])
  const [draft, setDraft] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, busy])

  const suggestions = isSheet
    ? [t("edit.ai.suggestSheetTotal"), t("edit.ai.suggestSheetBold"), t("edit.ai.suggestSummary")]
    : [t("edit.ai.suggestSummary"), t("edit.ai.suggestHeading"), t("edit.ai.suggestParagraph")]

  const send = async (text: string) => {
    const prompt = text.trim()
    const editor = editorRef.current
    if (!prompt || busy || !editor) return
    setDraft("")
    setError(null)
    const history = messages.map(({ role, content }) => ({ role, content }))
    setMessages((prev) => [...prev, { role: "user", content: prompt }])
    setBusy(true)
    try {
      const selection = getSelection()
      const outline = buildOutline(editor, isSheet, selection)
      const reply = await askAssistant({ ...outline, history, prompt })
      let applied = 0
      let skipped: string[] = []
      let snapshot: string | undefined
      if (reply.operations.length > 0 && editorRef.current) {
        snapshot = editorRef.current.innerHTML
        const target = editorRef.current
        // Applying selects each target in turn; keep the reader's place.
        const result = preserveScroll(target, () =>
          applyOperations(target, reply.operations, {
            missing: t("edit.ai.skippedMissing"),
            positioned: t("edit.ai.skippedPositioned"),
            notFound: t("edit.ai.skippedNotFound"),
            noSelection: t("edit.ai.skippedNoSelection"),
          }, selection),
        )
        applied = result.applied
        skipped = result.skipped
        if (applied > 0) {
          // Drop any image/shape frame: its object may just have been deleted.
          onRestored()
          onChanged()
        } else snapshot = undefined
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply.answer || t("edit.ai.done"), applied, skipped, snapshot },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai.requestFailed"))
    } finally {
      setBusy(false)
      // Applying edits focuses the document; hand focus back so the next
      // prompt can be typed straight away (the selection stays remembered
      // and highlighted meanwhile).
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    }
  }

  // Only the latest applied reply can be undone: restoring an older snapshot
  // would silently throw away every change made after it.
  const lastUndoable = messages.reduce(
    (found, m, i) => (m.snapshot && !m.undone ? i : found),
    -1,
  )

  const undo = (index: number) => {
    const snapshot = messages[index]?.snapshot
    if (!snapshot || !editorRef.current) return
    const editor = editorRef.current
    preserveScroll(editor, () => {
      editor.innerHTML = snapshot
    })
    onRestored()
    onChanged()
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, undone: true } : m)))
  }

  return (
    <aside
      aria-label={t("edit.ai.title")}
      className="flex h-full min-h-0 w-full flex-col border-l border-border bg-background"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="size-4 text-indigo-500" aria-hidden />
        <h2 className="flex-1 text-sm font-medium">{t("edit.ai.title")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          title={t("common.close")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("edit.ai.intro")}</p>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                // A light tint, not the solid primary: solid read as another
                // Download-style button sitting next to the real one.
                m.role === "user"
                  ? "border border-primary/20 bg-primary/10 text-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {m.content}
              {m.role === "assistant" && (m.applied ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  <span>
                    {m.undone ? t("edit.ai.undone") : t("edit.ai.applied", { count: m.applied ?? 0 })}
                  </span>
                  {i === lastUndoable && (
                    <button
                      type="button"
                      onClick={() => undo(i)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-background"
                    >
                      <Undo2 className="size-3.5" aria-hidden /> {t("edit.ai.undo")}
                    </button>
                  )}
                </div>
              )}
              {m.role === "assistant" && m.skipped && m.skipped.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {m.skipped.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("edit.ai.thinking")}
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>

      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line. Never mid-IME: Korean
              // and Japanese input confirm a character with Enter.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(draft)
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={t("edit.ai.placeholder")}
            aria-label={t("edit.ai.placeholder")}
            disabled={busy}
            className="min-h-10 flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label={t("edit.ai.send")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("edit.ai.note")}</p>
      </form>
    </aside>
  )
}
