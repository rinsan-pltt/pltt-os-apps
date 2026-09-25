"use client"

/**
 * The AI Summarizer as a conversation about one document.
 *
 * The file is read once when it arrives; after that every message — a
 * suggested summary or any question at all — goes to the model with the
 * document's text and the conversation so far. The three summary lengths the
 * tool used to offer as a dropdown are now the suggestion chips, and every
 * answer can be copied.
 */

import * as React from "react"
import { Check, Copy, FileText, Loader2, SendHorizontal, Sparkles } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { askDocument, openDocumentChat, type OpenedDocument } from "@/lib/api"
import { useRegistryText, useT } from "@/lib/i18n"
import type { Tool } from "@/lib/tools"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
}

type SummaryLength = "short" | "medium" | "detailed"

function CopyButton({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Clipboard blocked (permissions / insecure context): nothing to do.
        }
      }}
      aria-label={copied ? t("ai.copied") : t("ai.copy")}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? t("ai.copied") : t("ai.copy")}
    </button>
  )
}

export function DocumentChat({ tool, file }: { tool: Tool; file: File }) {
  const t = useT()
  const reg = useRegistryText()
  const [doc, setDoc] = React.useState<OpenedDocument | null>(null)
  const [opening, setOpening] = React.useState(true)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [draft, setDraft] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  // A new file starts a new conversation.
  React.useEffect(() => {
    let cancelled = false
    setDoc(null)
    setMessages([])
    setError(null)
    setOpening(true)
    openDocumentChat(file)
      .then((opened) => !cancelled && setDoc(opened))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : t("ai.requestFailed")))
      .finally(() => !cancelled && setOpening(false))
    return () => {
      cancelled = true
    }
  }, [file, t])

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, busy])

  // The old length options, as chips — labels straight from the registry so
  // they read the same (and are translated the same) as the dropdown did.
  const lengthOption = (tool.options ?? []).find((o) => o.name === "length")
  const summaryChips =
    lengthOption && lengthOption.kind === "select"
      ? lengthOption.choices.map((choice) => ({
          label: reg.optChoice(tool.slug, "length", choice.value, choice.label),
          summary: choice.value as SummaryLength,
        }))
      : []
  const questionChips = [t("ai.chat.suggestKeyPoints"), t("ai.chat.suggestActions")]

  const send = async (text: string, summary?: SummaryLength) => {
    const prompt = text.trim()
    if (!prompt || busy || !doc) return
    setDraft("")
    setError(null)
    const history = messages
    setMessages((prev) => [...prev, { role: "user", content: prompt }])
    setBusy(true)
    try {
      const reply = await askDocument({ filename: doc.filename, text: doc.text, history, prompt, summary })
      setMessages((prev) => [...prev, { role: "assistant", content: reply.answer }])
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai.requestFailed"))
    } finally {
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    }
  }

  if (opening) return <BusyPanel label={t("ai.chat.reading")} />
  if (!doc) return error ? <Alert tone="error">{error}</Alert> : null

  return (
    <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <FileText className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate" dir="ltr" title={doc.filename}>
          {doc.filename}
        </span>
        {doc.truncated && <span className="shrink-0">{t("ai.truncatedModelLimit")}</span>}
      </div>

      <div ref={listRef} className="max-h-[60vh] min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4 text-purple-500" aria-hidden /> {t("ai.chat.intro")}
            </p>
            <div className="flex flex-wrap gap-2">
              {summaryChips.map((chip) => (
                <button
                  key={chip.summary}
                  type="button"
                  onClick={() => void send(chip.label, chip.summary)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  {chip.label}
                </button>
              ))}
              {questionChips.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[90%] rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "border border-primary/20 bg-primary/10 text-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              {m.role === "assistant" && (
                <div className="mt-1.5 flex justify-end border-t border-border pt-1.5">
                  <CopyButton text={m.content} />
                </div>
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

      {messages.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-3 pt-2">
          {summaryChips.map((chip) => (
            <button
              key={chip.summary}
              type="button"
              disabled={busy}
              onClick={() => void send(chip.label, chip.summary)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="shrink-0 p-3"
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
              // Enter sends; Shift+Enter is a new line; never mid-IME.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(draft)
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={t("ai.chat.placeholder")}
            aria-label={t("ai.chat.placeholder")}
            disabled={busy}
            className="min-h-10 flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label={t("edit.ai.send")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  )
}
