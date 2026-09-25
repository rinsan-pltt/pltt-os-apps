/**
 * Where the global chat keeps its sessions: this browser's IndexedDB.
 *
 * Two stores — `sessions` (title + messages) and `files` (the uploaded files
 * and the tools' results, as Blobs) — so a conversation survives a reload with
 * its files still usable: "now compress it" still works tomorrow. IndexedDB can
 * be unavailable (private windows, blocked site data), so every call falls
 * back to an in-memory copy for the life of the page instead of failing.
 */

export interface ChatFileRef {
  id: string
  name: string
  size: number
  type: string
  origin: "uploaded" | "result"
}

export interface ChatStepLog {
  tool: string
  ok: boolean
  error?: string
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  /** Attachments on a user message; results on an assistant message. */
  files?: ChatFileRef[]
  steps?: ChatStepLog[]
  /** A tool that has to be used on its own page (the editor, signing). */
  openTool?: string
  error?: string
  createdAt: number
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  /** Next file number — ids are f1, f2, … within a session. */
  fileSeq: number
}

interface StoredFile {
  id: string // `${sessionId}:${fileId}`
  sessionId: string
  blob: Blob
}

const DB_NAME = "file-convertor-chat"
const DB_VERSION = 1

const memory = {
  sessions: new Map<string, ChatSession>(),
  files: new Map<string, StoredFile>(),
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" })
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files", { keyPath: "id" }).createIndex("bySession", "sessionId")
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const tx = db.transaction(store, mode)
          const req = fn(tx.objectStore(store))
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined)
          tx.onerror = () => resolve(undefined)
          tx.onabort = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

export async function listSessions(): Promise<ChatSession[]> {
  const stored = await run<ChatSession[]>("sessions", "readonly", (s) => s.getAll())
  const all = stored ?? Array.from(memory.sessions.values())
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveSession(session: ChatSession): Promise<void> {
  memory.sessions.set(session.id, session)
  await run("sessions", "readwrite", (s) => s.put(session))
}

export async function deleteSession(id: string): Promise<void> {
  memory.sessions.delete(id)
  for (const key of Array.from(memory.files.keys())) if (key.startsWith(`${id}:`)) memory.files.delete(key)
  await run("sessions", "readwrite", (s) => s.delete(id))
  const keys = await run<IDBValidKey[]>("files", "readonly", (s) => s.index("bySession").getAllKeys(id))
  for (const key of keys ?? []) await run("files", "readwrite", (s) => s.delete(key))
}

export async function putFile(sessionId: string, fileId: string, blob: Blob): Promise<void> {
  const record: StoredFile = { id: `${sessionId}:${fileId}`, sessionId, blob }
  memory.files.set(record.id, record)
  await run("files", "readwrite", (s) => s.put(record))
}

export async function getFile(sessionId: string, fileId: string): Promise<Blob | null> {
  const key = `${sessionId}:${fileId}`
  const hit = memory.files.get(key)
  if (hit) return hit.blob
  const stored = await run<StoredFile>("files", "readonly", (s) => s.get(key))
  if (stored) memory.files.set(key, stored)
  return stored?.blob ?? null
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
