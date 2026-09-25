"use client"

/**
 * The global chat: a ChatGPT-style conversation that can run any of the app's
 * tools.
 *
 * Sessions live in this browser (lib/chat-store.ts) — the list on the left,
 * newest first, each renamable and deletable. Files attached to a message, and
 * every file a tool produces, get a session-wide id (f1, f2, …) so later
 * messages can refer back: "now compress it" uses the last result. Each turn:
 * the model plans (backend /ai/agent), then the browser runs the planned steps
 * through the tools' own endpoints (lib/chat-runner.ts) and shows the results
 * as download cards under the reply.
 */

import * as React from "react"
import Link from "next/link"
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  PanelLeft,
  Pencil,
  SendHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { askAgent, downloadBlob } from "@/lib/api"
import { buildCatalog, runStep } from "@/lib/chat-runner"
import {
  deleteSession,
  getFile,
  listSessions,
  newId,
  putFile,
  saveSession,
  type ChatFileRef,
  type ChatMessage,
  type ChatSession,
} from "@/lib/chat-store"
import { useRegistryText, useT } from "@/lib/i18n"
import { getTool, TOOLS, toolHref } from "@/lib/tools"
import { cn } from "@/lib/utils"

/** Everything any tool accepts — what the paperclip offers. */
const ANY_ACCEPT = Array.from(
  new Set(TOOLS.flatMap((tool) => tool.accept.split(",").map((e) => e.trim()).filter(Boolean))),
).join(",")

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function newSession(): ChatSession {
  const now = Date.now()
  return { id: newId(), title: "", createdAt: now, updatedAt: now, messages: [], fileSeq: 1 }
}

/** The conversation as the model reads it: text plus which files each turn
 *  attached or produced, by id. */
function historyFor(messages: ChatMessage[]) {
  return messages.map((m) => {
    const files = m.files?.length
      ? `\n[${m.role === "user" ? "attached" : "results"}: ${m.files.map((f) => `${f.id} ${f.name}`).join(", ")}]`
      : ""
    return { role: m.role, content: (m.content || "") + files }
  })
}

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
          // Clipboard blocked — nothing useful to do.
        }
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? t("ai.copied") : t("ai.copy")}
    </button>
  )
}

function FileCard({ sessionId, file }: { sessionId: string; file: ChatFileRef }) {
  const t = useT()
  const [missing, setMissing] = React.useState(false)
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" dir="ltr" title={file.name}>
          {file.name}
        </div>
        <div className="text-xs text-muted-foreground">
          {missing ? t("chat.fileGone") : formatSize(file.size)}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={missing}
        onClick={async () => {
          const blob = await getFile(sessionId, file.id)
          if (blob) downloadBlob(blob, file.name)
          else setMissing(true)
        }}
      >
        <Download className="size-4" /> {t("chat.download")}
      </Button>
    </div>
  )
}

export function ChatView() {
  const t = useT()
  const reg = useRegistryText()
  const [sessions, setSessions] = React.useState<ChatSession[] | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState("")
  const [pending, setPending] = React.useState<File[]>([])
  const [busy, setBusy] = React.useState<string | null>(null) // status line while working
  const [error, setError] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [renameText, setRenameText] = React.useState("")
  const [pendingDelete, setPendingDelete] = React.useState<ChatSession | null>(null)
  const [showSessions, setShowSessions] = React.useState(false) // phone drawer
  const [dragging, setDragging] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const catalog = React.useMemo(() => buildCatalog(), [])

  React.useEffect(() => {
    void listSessions().then((all) => {
      setSessions(all)
      setActiveId(all[0]?.id ?? null)
    })
  }, [])

  const active = sessions?.find((s) => s.id === activeId) ?? null

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [active?.messages.length, busy])

  /** Replace a session in state and storage, newest first. */
  const commit = React.useCallback(async (session: ChatSession) => {
    const next = { ...session, updatedAt: Date.now() }
    setSessions((prev) => [next, ...(prev ?? []).filter((s) => s.id !== next.id)])
    await saveSession(next)
    return next
  }, [])

  const startNew = () => {
    setActiveId(null)
    setDraft("")
    setPending([])
    setError(null)
    setShowSessions(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    setPending((prev) => [...prev, ...Array.from(list)])
  }

  const send = async (text: string) => {
    const prompt = text.trim()
    if ((!prompt && pending.length === 0) || busy) return
    setError(null)
    let session = active ?? newSession()
    const sessionId = session.id

    // Attachments get session-wide ids and are stored with the session.
    const attached: ChatFileRef[] = []
    let seq = session.fileSeq
    for (const file of pending) {
      const id = `f${seq++}`
      await putFile(sessionId, id, file)
      attached.push({ id, name: file.name, size: file.size, type: file.type, origin: "uploaded" })
    }
    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: prompt,
      files: attached.length ? attached : undefined,
      createdAt: Date.now(),
    }
    const history = historyFor(session.messages)
    session = await commit({
      ...session,
      title: session.title || (prompt || attached[0]?.name || t("chat.untitled")).slice(0, 60),
      fileSeq: seq,
      messages: [...session.messages, userMessage],
    })
    setActiveId(sessionId)
    setDraft("")
    setPending([])
    setBusy(t("chat.thinking"))

    try {
      // Every file the session has seen, marked when its bytes are gone.
      const refs = session.messages.flatMap((m) => m.files ?? [])
      const files = await Promise.all(
        refs.map(async (f) => ({
          id: f.id,
          name: f.name,
          origin: f.origin === "result" ? "result of an earlier step" : "uploaded",
          available: (await getFile(sessionId, f.id)) !== null,
        })),
      )
      const plan = await askAgent({
        catalog,
        files,
        history,
        prompt: prompt || t("chat.attachedOnly"),
      })

      const answer: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: plan.reply,
        openTool: plan.open_tool ?? undefined,
        createdAt: Date.now(),
      }
      const results: ChatFileRef[] = []
      const texts: string[] = []
      const logs: NonNullable<ChatMessage["steps"]> = []
      let previous: File[] = []
      let fileSeq = session.fileSeq

      for (const step of plan.steps) {
        const title = getTool(step.tool) ? reg.toolTitle(getTool(step.tool)!) : step.tool
        setBusy(t("chat.running", { tool: title }))
        try {
          const inputs: File[] = []
          for (const ref of step.files) {
            if (ref === "$prev") inputs.push(...previous)
            else {
              const meta = refs.find((f) => f.id === ref) ?? results.find((f) => f.id === ref)
              const blob = await getFile(sessionId, ref)
              if (meta && blob) inputs.push(new File([blob], meta.name, { type: meta.type || blob.type }))
            }
          }
          const outcome = await runStep(step.tool, inputs, step.options, {
            fixes: (n) => t("ai.fixesApplied", { count: n }),
          })
          previous = []
          for (const out of outcome.files) {
            const id = `f${fileSeq++}`
            await putFile(sessionId, id, out.blob)
            results.push({ id, name: out.filename, size: out.blob.size, type: out.blob.type, origin: "result" })
            previous.push(new File([out.blob], out.filename, { type: out.blob.type }))
          }
          if (outcome.text) texts.push(outcome.text)
          logs.push({ tool: step.tool, ok: true })
        } catch (e) {
          logs.push({ tool: step.tool, ok: false, error: e instanceof Error ? e.message : String(e) })
          break // later steps depend on this one
        }
      }

      answer.content = [answer.content, ...texts].filter(Boolean).join("\n\n")
      if (results.length) answer.files = results
      if (logs.length) answer.steps = logs
      await commit({ ...session, fileSeq, messages: [...session.messages, answer] })
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai.requestFailed"))
    } finally {
      setBusy(null)
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    }
  }

  const rename = async (session: ChatSession) => {
    const title = renameText.trim()
    setRenaming(null)
    if (title && title !== session.title) await commit({ ...session, title })
  }

  const remove = async (session: ChatSession) => {
    await deleteSession(session.id)
    setSessions((prev) => (prev ?? []).filter((s) => s.id !== session.id))
    if (activeId === session.id) setActiveId(null)
  }

  const suggestions = [t("chat.suggestConvert"), t("chat.suggestCompress"), t("chat.suggestSummary"), t("chat.suggestMerge")]

  const sessionList = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-3">
        <Button className="w-full justify-start" variant="outline" onClick={startNew}>
          <MessageSquarePlus className="size-4" /> {t("chat.newChat")}
        </Button>
      </div>
      <nav aria-label={t("chat.history")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sessions === null ? null : sessions.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">{t("chat.noSessions")}</p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                {renaming === s.id ? (
                  <input
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => void rename(s)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void rename(s)
                      if (e.key === "Escape") setRenaming(null)
                    }}
                    aria-label={t("chat.rename")}
                    className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                ) : (
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded-md pr-1",
                      s.id === activeId ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(s.id)
                        setError(null)
                        setShowSessions(false)
                      }}
                      aria-current={s.id === activeId ? "true" : undefined}
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                      title={s.title}
                    >
                      {s.title || t("chat.untitled")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(s.id)
                        setRenameText(s.title)
                      }}
                      aria-label={t("chat.rename")}
                      title={t("chat.rename")}
                      className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(s)}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                      className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  )

  return (
    <AppShell>
      <div className="relative flex h-full min-h-0">
        {/* Sessions: a column from md up, a drawer below. */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:block">{sessionList}</aside>
        {showSessions && (
          <div className="absolute inset-0 z-40 flex md:hidden">
            <div className="w-72 max-w-[85%] border-r border-border bg-card shadow-lg">{sessionList}</div>
            <button
              type="button"
              aria-label={t("common.close")}
              className="flex-1 bg-black/30"
              onClick={() => setShowSessions(false)}
            />
          </div>
        )}

        <section
          className="relative flex min-w-0 flex-1 flex-col"
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
            <button
              type="button"
              onClick={() => setShowSessions(true)}
              aria-label={t("chat.history")}
              className="rounded p-1 text-muted-foreground hover:bg-muted md:hidden"
            >
              <PanelLeft className="size-4" />
            </button>
            <Sparkles className="size-4 text-indigo-500" aria-hidden />
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{active?.title || t("chat.title")}</h1>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
              {(!active || active.messages.length === 0) && (
                <div className="space-y-4 py-10 text-center">
                  <Sparkles className="mx-auto size-8 text-indigo-500" aria-hidden />
                  <h2 className="text-lg font-medium">{t("chat.welcome")}</h2>
                  <p className="text-sm text-muted-foreground">{t("chat.intro")}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setDraft(s)
                          inputRef.current?.focus()
                        }}
                        className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {active?.messages.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] space-y-2 rounded-lg px-3 py-2 text-sm",
                      m.role === "user"
                        ? "border border-primary/20 bg-primary/10 text-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.content && <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>}
                    {m.files && (
                      <div className="grid gap-2">
                        {m.files.map((f) =>
                          m.role === "user" ? (
                            <div key={f.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Paperclip className="size-3.5" aria-hidden />
                              <span className="truncate" dir="ltr">{f.name}</span>
                            </div>
                          ) : (
                            <FileCard key={f.id} sessionId={active.id} file={f} />
                          ),
                        )}
                      </div>
                    )}
                    {m.steps?.filter((s) => !s.ok).map((s, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>
                          {getTool(s.tool) ? reg.toolTitle(getTool(s.tool)!) : s.tool}: {s.error}
                        </span>
                      </div>
                    ))}
                    {m.openTool && getTool(m.openTool) && (
                      <Link
                        href={toolHref(m.openTool)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-background"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                        {t("chat.openTool", { tool: reg.toolTitle(getTool(m.openTool)!) })}
                      </Link>
                    )}
                    {m.role === "assistant" && m.content && (
                      <div className="flex justify-end border-t border-border pt-1.5">
                        <CopyButton text={m.content} />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> {busy}
                </div>
              )}
              {error && <Alert tone="error">{error}</Alert>}
            </div>
          </div>

          <form
            className="shrink-0 border-t border-border bg-background px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              void send(draft)
            }}
          >
            <div className="mx-auto w-full max-w-3xl">
              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {pending.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-xs"
                    >
                      <Paperclip className="size-3 shrink-0" aria-hidden />
                      <span className="truncate" dir="ltr">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={t("chat.removeFile", { name: f.name })}
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ANY_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.currentTarget.value = ""
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy !== null}
                  aria-label={t("chat.attach")}
                  title={t("chat.attach")}
                >
                  <Paperclip className="size-4" />
                </Button>
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
                  placeholder={t("chat.placeholder")}
                  aria-label={t("chat.placeholder")}
                  disabled={busy !== null}
                  className="min-h-10 flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={busy !== null || (!draft.trim() && pending.length === 0)}
                  aria-label={t("edit.ai.send")}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                </Button>
              </div>
              <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{t("chat.note")}</p>
            </div>
          </form>

          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
              {t("chat.dropHere")}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t("chat.deleteTitle")}
        description={pendingDelete ? t("chat.deleteBody", { title: pendingDelete.title || t("chat.untitled") }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete)
        }}
      />
    </AppShell>
  )
}
