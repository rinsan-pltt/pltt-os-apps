"use client"

import * as React from "react"
import {
  AlertCircle,
  ArrowUp,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Paperclip,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { IconChip } from "@/components/ui/icon-chip"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import type { ChatDownload, ChatPendingAction } from "@/lib/api"
import type { ChatTurn } from "@/hooks/use-chat"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** What a receipt can be. Mirrors RECEIPT_EXTS on the backend so the picker
 *  can't offer a file POST /expenses would refuse. */
const ACCEPT = ".jpg,.jpeg,.png,.webp,.bmp,.tiff,.gif,.pdf"
const MAX_ATTACHMENTS = 10

/** Prompts that stand in for the app's own screens, so the empty state teaches
 *  what the assistant can do rather than just inviting a blank guess. */
export const SUGGESTION_KEYS = [
  "chat.suggestSpend",
  "chat.suggestPending",
  "chat.suggestLog",
  "chat.suggestExport",
] as const

function TurnBubble({ turn }: { turn: ChatTurn }) {
  const t = useT()
  const mine = turn.role === "user"
  const shown = (turn.display ?? turn.content).trim()
  const hasText = shown.length > 0
  // An assistant turn that only proposes a confirm-required write carries no
  // prose — the model answers with the tool call alone. Rendering the bubble
  // anyway left an empty pill floating above the confirmation card, and
  // inventing a sentence would only repeat what the card already says.
  if (!hasText && !turn.attachments?.length && !turn.actions?.length) return null
  return (
    <div className={cn("flex gap-3", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <IconChip
          icon={turn.failed ? AlertCircle : Sparkles}
          tone={turn.failed ? "warning" : "default"}
          size="sm"
          className="mt-0.5 shrink-0"
        />
      )}
      <div className={cn("min-w-0 max-w-[min(46rem,88%)] space-y-2", mine && "flex flex-col items-end")}>
        {hasText && (
          <div
            className={cn(
              "whitespace-pre-wrap break-words rounded-xl px-4 py-2.5 text-body",
              mine
                ? "bg-primary text-primary-foreground"
                : turn.failed
                  ? "border border-destructive/40 bg-destructive-subtle text-foreground"
                  : "border border-border bg-surface-sunken/60 text-foreground",
            )}
          >
            {shown}
          </div>
        )}
        {turn.attachments && turn.attachments.length > 0 && (
          <ul className="flex flex-wrap justify-end gap-1.5">
            {turn.attachments.map((name, i) => (
              <li
                key={`${name}-${i}`}
                className="flex max-w-56 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-caption text-muted-foreground"
              >
                <FileText className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ul>
        )}
        {/* A write must never be invisible: the model's prose is not evidence,
            these lines are what the server reports it actually did. */}
        {turn.actions && turn.actions.length > 0 && (
          <ul aria-label={t("chat.doneLabel")} className="space-y-1">
            {turn.actions.map((action, i) => (
              <li key={`${action}-${i}`} className="flex items-start gap-2 text-caption text-success">
                <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">{action}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ConfirmCard({
  action,
  busy,
  onAnswer,
}: {
  action: ChatPendingAction
  busy: boolean
  onAnswer: (approved: boolean) => void
}) {
  const t = useT()
  return (
    // Not a modal dialog. The proposal belongs in the transcript beside the
    // message that produced it — a dialog would hide the conversation the user
    // needs in order to judge it, and the chat is still usable if they ignore it.
    <div className="ml-11 max-w-[min(46rem,88%)] rounded-xl border border-warning/40 bg-warning-subtle p-4">
      <p className="flex items-start gap-2 text-body font-medium text-foreground">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span className="min-w-0">{t("chat.confirmTitle")}</span>
      </p>
      <p className="mt-1.5 pl-6 text-body text-muted-foreground">{action.description}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onAnswer(false)} disabled={busy}>
          <X className="size-4" aria-hidden /> {t("chat.confirmCancel")}
        </Button>
        <Button
          size="sm"
          variant={action.tool === "delete_expenses" ? "destructive" : "default"}
          onClick={() => onAnswer(true)}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          {t("chat.confirmGo")}
        </Button>
      </div>
    </div>
  )
}

function DownloadCard({
  descriptor,
  busy,
  onDownload,
}: {
  descriptor: ChatDownload
  busy: boolean
  onDownload: () => void
}) {
  const t = useT()
  return (
    <div className="ml-11 flex max-w-[min(46rem,88%)] flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      <IconChip icon={FileText} tone="neutral" size="sm" />
      <span className="min-w-0 flex-1 text-body">
        {t("chat.reportReady", { format: descriptor.format.toUpperCase() })}
      </span>
      <Button size="sm" variant="outline" onClick={onDownload} disabled={busy}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
        {t("chat.download")}
      </Button>
    </div>
  )
}

export function ChatPanel({
  turns,
  sending,
  preparing,
  downloading,
  onSend,
  onAnswer,
  onDownload,
  onClear,
}: {
  turns: ChatTurn[]
  sending: boolean
  preparing: string | null
  downloading: boolean
  onSend: (text: string, files: File[]) => void
  onAnswer: (turnId: string, action: ChatPendingAction, approved: boolean) => void
  onDownload: (descriptor: ChatDownload) => Promise<string | null>
  onClear: () => void
}) {
  const t = useT()
  const { toast } = useToast()
  const [text, setText] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const busy = sending || preparing !== null

  // Follow the conversation. `scrollTop` rather than scrollIntoView: the latter
  // scrolls every ancestor, which under the OS host means scrolling the
  // platform's own chrome to chase a message inside the plugin.
  React.useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [turns, sending])

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return
    setFiles((prev) => {
      const room = MAX_ATTACHMENTS - prev.length
      if (room <= 0) {
        toast(t("chat.tooManyFiles", { count: MAX_ATTACHMENTS }))
        return prev
      }
      const picked = Array.from(incoming).slice(0, room)
      if (picked.length < incoming.length) toast(t("chat.tooManyFiles", { count: MAX_ATTACHMENTS }))
      return [...prev, ...picked]
    })
  }

  const submit = () => {
    if (busy) return
    if (!text.trim() && files.length === 0) return
    onSend(text, files)
    setText("")
    setFiles([])
    if (fileRef.current) fileRef.current.value = ""
    composerRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter is a newline — the convention for a chat
    // composer. The send button stays for anyone who never learns that.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ------------------------------------------------------- transcript */}
      <div
        ref={listRef}
        // The live region is the message list itself, so a reply that arrives
        // while focus is in the composer is announced without moving focus.
        role="log"
        aria-live="polite"
        aria-label={t("chat.transcript")}
        // A scroll container that is not focusable cannot be scrolled from the
        // keyboard at all: with focus in the composer the arrow keys move the
        // caret, so a long conversation would be unreachable without a mouse.
        tabIndex={0}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {turns.length === 0 && !busy ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-4 text-center">
            <IconChip icon={Sparkles} tone="default" />
            <div className="space-y-1.5">
              <p className="text-heading">{t("chat.emptyTitle")}</p>
              <p className="mx-auto max-w-[52ch] text-pretty text-body text-muted-foreground">
                {t("chat.emptyBody")}
              </p>
            </div>
            <ul className="flex flex-wrap justify-center gap-2">
              {SUGGESTION_KEYS.map((key) => {
                const prompt = t(key)
                return (
                  <li key={key}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setText(prompt)
                        composerRef.current?.focus()
                      }}
                    >
                      {prompt}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <>
            {turns.map((turn) => (
              <React.Fragment key={turn.id}>
                <TurnBubble turn={turn} />
                {turn.pending && (
                  <ConfirmCard
                    action={turn.pending}
                    busy={busy}
                    onAnswer={(approved) => onAnswer(turn.id, turn.pending!, approved)}
                  />
                )}
                {turn.download && (
                  <DownloadCard
                    descriptor={turn.download}
                    busy={downloading}
                    onDownload={async () => {
                      const error = await onDownload(turn.download!)
                      if (error) toast(error)
                    }}
                  />
                )}
              </React.Fragment>
            ))}
            {busy && (
              <p className="flex items-center gap-2 pl-11 text-body text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {preparing ? t("chat.reading", { name: preparing }) : t("chat.thinking")}
              </p>
            )}
          </>
        )}
      </div>

      {/* --------------------------------------------------------- composer */}
      <div className="shrink-0 space-y-2 border-t border-border p-surface">
        {files.length > 0 && (
          <ul aria-label={t("chat.attachedLabel")} className="flex flex-wrap gap-1.5">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex max-w-64 items-center gap-1.5 rounded-full bg-muted py-1 pl-2.5 pr-1 text-caption text-muted-foreground"
              >
                <FileText className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, index) => index !== i))}
                  aria-label={t("chat.removeFile", { name: file.name })}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          {/* The real picker, driven by the labelled button beside it. `sr-only`
              alone leaves it focusable, which put an invisible, unnamed stop in
              the tab order; -1 and aria-hidden take it out without using
              `display:none`, which some browsers refuse to open. */}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            onChange={(e) => addFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label={t("chat.attach")}
            title={t("chat.attach")}
          >
            <Paperclip className="size-4" aria-hidden />
          </Button>
          <Textarea
            ref={composerRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("chat.placeholder")}
            disabled={busy}
            rows={1}
            aria-label={t("chat.composerLabel")}
            className="min-h-10 max-h-40 flex-1 resize-y py-2.5"
          />
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={busy || (!text.trim() && files.length === 0)}
            aria-label={t("chat.send")}
            title={t("chat.send")}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-4" aria-hidden />
            )}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-caption text-muted-foreground">{t("chat.hint")}</p>
          {turns.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
              <Trash2 className="size-4" aria-hidden /> {t("chat.clear")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
