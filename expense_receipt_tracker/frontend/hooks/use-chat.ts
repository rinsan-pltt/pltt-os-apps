"use client"

import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

import {
  chatDownloadToFilters,
  downloadBlob,
  exportReport,
  scanReceipt,
  sendChat,
  type ChatAttachment,
  type ChatDownload,
  type ChatPendingAction,
} from "@/lib/api"
import { uploadReceiptToStorage } from "@/lib/receipt-storage"

/** One turn in the transcript, plus everything the UI renders alongside it. */
export interface ChatTurn {
  id: string
  role: "user" | "assistant"
  /** What the assistant is sent. For a message with receipts this carries an
   *  `[attached receipt: …]` marker naming the ids the tools take. */
  content: string
  /** What the bubble shows, when that differs from `content` — the attachment
   *  marker is plumbing the assistant needs and the user does not: the
   *  filenames are already on the chips beneath the bubble. */
  display?: string
  /** Filenames the user attached to this turn, for the bubble to show. */
  attachments?: string[]
  /** Past-tense summaries of the writes this reply performed. */
  actions?: string[]
  /** A report this reply prepared, offered as a download button. */
  download?: ChatDownload
  /** A write awaiting the user's approval. Cleared once answered. */
  pending?: ChatPendingAction
  /** The request failed — the bubble renders as an error with a retry. */
  failed?: boolean
}

/** Where the transcript survives a reload.
 *
 * Deliberately `localStorage` and not the plugin's database: chat history is
 * not a record the app reports on or exports, and a new org-scoped message
 * table would need a migration plus a retention answer to hold something the
 * user can already re-ask. The consequence to be honest about is that the
 * transcript is per-browser — it does not follow the user to another device. */
const STORAGE_KEY = "expense-receipt-tracker:chat"
const STORAGE_LIMIT = 60

function loadStored(): ChatTurn[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // A stored `pending` would offer a Confirm button for a write proposed in
    // a session that has ended, so it is dropped on load — the user would be
    // approving something they can no longer see the reasoning for.
    return parsed
      .filter(
        (t: unknown): t is ChatTurn =>
          !!t &&
          typeof t === "object" &&
          typeof (t as ChatTurn).content === "string" &&
          ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant"),
      )
      .map((turn) => ({ ...turn, pending: undefined }))
  } catch {
    return []
  }
}

let _uid = 0
const turnId = () => `t${Date.now().toString(36)}-${_uid++}`

export interface UseChatOptions {
  /** Called after any turn that wrote data, so the caller can refetch. */
  onChanged?: () => void
}

export function useChat({ onChanged }: UseChatOptions = {}) {
  const platform = usePlatform()
  const [turns, setTurns] = React.useState<ChatTurn[]>([])
  const [sending, setSending] = React.useState(false)
  const [preparing, setPreparing] = React.useState<string | null>(null)
  const [downloading, setDownloading] = React.useState(false)

  // Read storage after mount, not in the initial state: this component renders
  // on the server too, and a first paint from localStorage would not match it.
  React.useEffect(() => {
    setTurns(loadStored())
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-STORAGE_LIMIT)))
    } catch {
      // Private mode, or the quota is full. Losing the transcript on reload is
      // not worth failing the send that produced it.
    }
  }, [turns])

  const changedRef = React.useRef(onChanged)
  changedRef.current = onChanged

  /** Send a transcript to the backend and fold the reply in. */
  const exchange = React.useCallback(
    async (
      history: ChatTurn[],
      attachments: ChatAttachment[],
      confirm: ChatPendingAction | null,
    ) => {
      setSending(true)
      try {
        const reply = await sendChat({
          // Only the two fields the API takes — the UI's own bookkeeping
          // (ids, action lines, download descriptors) is not conversation.
          messages: history.map(({ role, content }) => ({ role, content })),
          attachments,
          confirm,
        })
        setTurns((prev) => [
          ...prev,
          {
            id: turnId(),
            role: "assistant",
            content: reply.reply,
            actions: reply.actions.length ? reply.actions : undefined,
            download: reply.download ?? undefined,
            pending: reply.pending ?? undefined,
          },
        ])
        if (reply.changed) changedRef.current?.()
        return true
      } catch (e) {
        setTurns((prev) => [
          ...prev,
          {
            id: turnId(),
            role: "assistant",
            content: e instanceof Error ? e.message : "Something went wrong.",
            failed: true,
          },
        ])
        return false
      } finally {
        setSending(false)
      }
    },
    [],
  )

  /**
   * Send a message, with any receipts attached to it.
   *
   * Receipts are scanned and stored before the message goes out, so the
   * assistant sees the vendor, amount and date already read off the document
   * and can save the expense in the same turn instead of asking for them.
   */
  const send = React.useCallback(
    async (text: string, files: File[] = []) => {
      const trimmed = text.trim()
      if (!trimmed && files.length === 0) return
      if (sending) return

      const attachments: ChatAttachment[] = []
      if (files.length > 0) {
        setPreparing(files.length === 1 ? files[0].name : `${files.length} receipts`)
        try {
          for (const [index, file] of files.entries()) {
            // Both calls are best-effort: a receipt the OCR cannot read, or a
            // storage service that is unavailable, must not stop the user from
            // sending the message. The assistant is told what is missing.
            const [draft, stored] = await Promise.all([
              scanReceipt(file).catch(() => null),
              uploadReceiptToStorage(platform, file).catch(() => null),
            ])
            attachments.push({
              id: `a${index + 1}`,
              original_name: file.name,
              content_type: stored?.content_type ?? file.type ?? undefined,
              object_path: stored?.object_path,
              file_url: stored?.file_url,
              draft: {
                ...(draft ?? {}),
                ...(stored ? {} : { storage_unavailable: true }),
              } as Record<string, unknown>,
            })
          }
        } finally {
          setPreparing(null)
        }
      }

      // The message the assistant reads has to name the attachments, or an
      // empty-text send ("here" plus a photo) gives it nothing to act on.
      const attachmentNote = attachments.length
        ? `[attached ${attachments.length === 1 ? "receipt" : "receipts"}: ${attachments
            .map((a) => `${a.id} = ${a.original_name}`)
            .join("; ")}]`
        : ""
      const content = [trimmed, attachmentNote].filter(Boolean).join("\n")

      const userTurn: ChatTurn = {
        id: turnId(),
        role: "user",
        content,
        display: attachmentNote ? trimmed : undefined,
        attachments: attachments.length ? attachments.map((a) => a.original_name ?? "receipt") : undefined,
      }
      const history = [...turns, userTurn]
      setTurns(history)
      await exchange(history, attachments, null)
    },
    [exchange, platform, sending, turns],
  )

  /** Approve a proposed write. The transcript records the answer so the reply
   *  that follows has something to refer to. */
  const confirmAction = React.useCallback(
    async (turnIdToAnswer: string, action: ChatPendingAction, approved: boolean) => {
      // Retire the proposal first: leaving the buttons live through the round
      // trip is how a delete gets confirmed twice.
      setTurns((prev) =>
        prev.map((turn) => (turn.id === turnIdToAnswer ? { ...turn, pending: undefined } : turn)),
      )
      const answer: ChatTurn = {
        id: turnId(),
        role: "user",
        content: approved ? `Yes — ${action.description}.` : "No, don't do that.",
      }
      setTurns((prev) => [...prev, answer])
      const history = [
        ...turns.map((turn) => (turn.id === turnIdToAnswer ? { ...turn, pending: undefined } : turn)),
        answer,
      ]
      await exchange(history, [], approved ? action : null)
    },
    [exchange, turns],
  )

  /** Fetch a report the assistant prepared. The browser only starts a download
   *  from a user gesture, which is why this is a button and not automatic. */
  const download = React.useCallback(async (descriptor: ChatDownload) => {
    setDownloading(true)
    try {
      const file = await exportReport(chatDownloadToFilters(descriptor))
      downloadBlob(file.blob, file.filename)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : "Could not export the report."
    } finally {
      setDownloading(false)
    }
  }, [])

  const clear = React.useCallback(() => setTurns([]), [])

  return { turns, sending, preparing, downloading, send, confirmAction, download, clear }
}
