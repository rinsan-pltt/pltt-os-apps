/**
 * Centralized API client for the File Convertor plugin.
 *
 * All plugin backend routes live under `/api/v1/plugins/file-handler-and-convertor/*`
 * (the plugin id in palette-plugin.json). `app/layout.tsx` calls
 * `registerApiFetch(platform.apiFetch)` at mount time and every request
 * routes through that — in production the OS provides its own credentialed
 * fetcher; under `pltt dev` the simulator provides one that targets the
 * dynamic backend port. When no platform fetch is registered (plain
 * standalone dev against uvicorn) we fall back to localhost:8000.
 */

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

const BASE = "/api/v1/plugins/file-handler-and-convertor"
const STANDALONE_BASE = "http://localhost:8000/api"

let _platformFetch: ApiFetch | null = null

export function registerApiFetch(fn: ApiFetch | undefined | null) {
  _platformFetch = fn ?? null
}

export interface ToolResult {
  blob: Blob
  filename: string
}

// Content-Type is always readable cross-origin (it's on the CORS "safelist"),
// unlike Content-Disposition — used as a defensive fallback so a downloaded
// or chained file never ends up with no extension at all, e.g. if some proxy
// between us and a hosted deployment ever strips Content-Disposition.
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/markdown": ".md",
  "application/zip": ".zip",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
}

function filenameFromResponse(resp: Response, fallback: string): string {
  const header = resp.headers.get("content-disposition")
  if (header) {
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
    if (utf8) return decodeURIComponent(utf8[1])
    const plain = /filename="?([^";]+)"?/i.exec(header)
    if (plain) return plain[1]
  }
  if (!/\.[a-z0-9]+$/i.test(fallback)) {
    const contentType = (resp.headers.get("content-type") || "").split(";")[0].trim()
    const ext = EXT_BY_CONTENT_TYPE[contentType]
    if (ext) return `${fallback}${ext}`
  }
  return fallback
}

/** POST files + options to the tool endpoint; returns the converted file. */
export async function runTool(
  slug: string,
  files: File[],
  options: Record<string, string> = {},
  /**
   * Ids of files already in the app's Data Room folders, used instead of (or
   * alongside) uploads. The backend reads their bytes through
   * `ctx.data_rooms.read_file_bytes`, so a document the platform already holds
   * is never downloaded to the browser and sent straight back up.
   */
  dataRoomFileIds: number[] = [],
): Promise<ToolResult> {
  const form = new FormData()
  for (const file of files) form.append("files", file)
  if (dataRoomFileIds.length > 0) {
    form.append("data_room_file_ids", dataRoomFileIds.join(","))
  }
  for (const [key, value] of Object.entries(options)) {
    if (value !== "") form.append(key, value)
  }

  let resp: Response
  try {
    if (_platformFetch) {
      resp = await _platformFetch(`${BASE}/tools/${slug}`, { method: "POST", body: form })
    } else {
      resp = await fetch(`${STANDALONE_BASE}/tools/${slug}`, { method: "POST", body: form })
    }
  } catch (err) {
    const cause = (err as { cause?: unknown })?.cause
    const baseMsg = err instanceof Error ? err.message : String(err)
    const causeMsg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : ""
    throw new Error(
      `Could not reach the conversion backend: ${causeMsg ? `${baseMsg}: ${causeMsg}` : baseMsg}`,
    )
  }

  if (!resp.ok) {
    let detail = `Conversion failed (HTTP ${resp.status}).`
    try {
      const body = await resp.json()
      if (typeof body?.detail === "string") detail = body.detail
      else if (Array.isArray(body?.detail)) {
        detail = body.detail
          .map((e: { loc?: string[]; msg?: string }) =>
            e.loc ? `${e.loc.join(".")} — ${e.msg}` : e.msg,
          )
          .join("; ")
      }
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(detail)
  }

  const blob = await resp.blob()
  const filename = filenameFromResponse(resp, "converted")
  return { blob, filename }
}

function apiFetch(path: string, init: RequestInit): Promise<Response> {
  if (_platformFetch) return _platformFetch(`${BASE}${path}`, init)
  return fetch(`${STANDALONE_BASE}${path}`, init)
}

async function errorDetail(resp: Response, fallback: string): Promise<string> {
  try {
    const body = await resp.json()
    if (typeof body?.detail === "string") return body.detail
  } catch {
    // non-JSON body
  }
  return fallback
}

export interface SummarizeResult {
  summary: string
  model: string
  filename: string
  characters_analyzed: number
  truncated: boolean
}

export interface ProofreadFix {
  type: string
  before: string
  after: string
  explanation: string
}

export interface ProofreadResult {
  corrected_text: string
  fixes: ProofreadFix[]
  fix_count: number
  model: string
  filename: string
}

async function postAi<T>(path: string, form: FormData): Promise<T> {
  let resp: Response
  try {
    resp = await apiFetch(path, { method: "POST", body: form })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the AI backend: ${msg}`)
  }
  if (!resp.ok) {
    throw new Error(await errorDetail(resp, `Request failed (HTTP ${resp.status}).`))
  }
  return (await resp.json()) as T
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  let resp: Response
  try {
    resp = await apiFetch(path, { method: "GET" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the conversion backend: ${msg}`)
  }
  if (!resp.ok) throw new Error(await errorDetail(resp, fallback))
  return (await resp.json()) as T
}

async function postJson<T>(path: string, form: FormData): Promise<T> {
  let resp: Response
  try {
    resp = await apiFetch(path, { method: "POST", body: form })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the conversion backend: ${msg}`)
  }
  if (!resp.ok) {
    throw new Error(await errorDetail(resp, `Request failed (HTTP ${resp.status}).`))
  }
  return (await resp.json()) as T
}

export interface ComparePage {
  index: number
  src: string
  w: number
  h: number
}

export interface CompareRender {
  filename: string
  pages: ComparePage[]
}

export interface CompareChange {
  type: "edit" | "delete" | "insert"
  old: string
  new: string
  page: number
  oldCount: number
  newCount: number
}

export interface CompareHighlight {
  page: number
  /** All values are 0..1 fractions of the page's width/height. */
  x: number
  y: number
  w: number
  h: number
  type: "edit" | "delete" | "insert"
}

export interface CompareReport {
  total: number
  changes: CompareChange[]
  /** Bounding boxes of changed words, for overlaying on the rendered pages. */
  highlightsA: CompareHighlight[]
  highlightsB: CompareHighlight[]
}

/** Rasterise one PDF's pages (base64) for the side-by-side compare viewer. */
export function compareRenderPages(file: File): Promise<CompareRender> {
  const form = new FormData()
  form.append("file", file)
  return postJson<CompareRender>("/compare/pages", form)
}

/** Structured text diff (edit / delete / insert) between two PDFs. */
export function compareReport(a: File, b: File): Promise<CompareReport> {
  const form = new FormData()
  form.append("a", a)
  form.append("b", b)
  return postJson<CompareReport>("/compare/report", form)
}

export function summarizeDocument(file: File, length: string): Promise<SummarizeResult> {
  const form = new FormData()
  form.append("file", file)
  form.append("length", length)
  return postAi<SummarizeResult>("/ai/summarize", form)
}

export function proofreadDocument(file: File): Promise<ProofreadResult> {
  const form = new FormData()
  form.append("file", file)
  return postAi<ProofreadResult>("/ai/proofread", form)
}

export interface TranslateResult {
  html: string
  model: string
  filename: string
  target_language: string
  truncated: boolean
}

export function translateDocument(file: File, targetLanguage: string): Promise<TranslateResult> {
  const form = new FormData()
  form.append("file", file)
  form.append("target_language", targetLanguage)
  return postAi<TranslateResult>("/ai/translate", form)
}

/** Post a URL (no file) to a tool endpoint, e.g. HTML to PDF. */
export async function runUrlTool(slug: string, url: string): Promise<ToolResult> {
  const form = new FormData()
  form.append("url", url)
  let resp: Response
  try {
    resp = await apiFetch(`/tools/${slug}`, { method: "POST", body: form })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the conversion backend: ${msg}`)
  }
  if (!resp.ok) {
    throw new Error(await errorDetail(resp, `Conversion failed (HTTP ${resp.status}).`))
  }
  const blob = await resp.blob()
  const filename = filenameFromResponse(resp, "converted.pdf")
  return { blob, filename }
}

export interface OrganizePage {
  index: number
  thumbnail: string
  rotation: number
}

export interface OrganizePreview {
  filename: string
  pages: OrganizePage[]
}

/** Load page thumbnails for the Organize PDF workspace. */
export function organizePreview(file: File): Promise<OrganizePreview> {
  const form = new FormData()
  form.append("file", file)
  return postAi<OrganizePreview>("/organize/preview", form)
}

/** Apply a reorder/delete/rotate plan; `order` is "idx" or "idx:angle" per final page, comma-separated. */
export async function organizeApply(file: File, order: string): Promise<ToolResult> {
  const form = new FormData()
  form.append("file", file)
  form.append("order", order)
  let resp: Response
  try {
    resp = await apiFetch("/organize/apply", { method: "POST", body: form })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the conversion backend: ${msg}`)
  }
  if (!resp.ok) {
    throw new Error(await errorDetail(resp, `Organize failed (HTTP ${resp.status}).`))
  }
  const blob = await resp.blob()
  const filename = filenameFromResponse(resp, "organized.pdf")
  return { blob, filename }
}

export interface ExtractedPage {
  html: string
  /** The source page's real size in points, when known — lets the editor
   *  render this page at the same size as the original. */
  width_pt?: number
  height_pt?: number
  /** True when every element in `html` carries a real `top`/`left` matching
   *  the source PDF exactly (the positioned-HTML fallback) — the page must
   *  render edge-to-edge, with no padding and no scrollbar, or those
   *  coordinates land in the wrong place. False for normal flowing prose. */
  positioned?: boolean
}

export interface ExtractHtmlResult {
  pages: ExtractedPage[]
  filename: string
  characters: number
}

/** Open a document as editable HTML (layout, tables and images preserved). */
export function extractDocumentHtml(file: File): Promise<ExtractHtmlResult> {
  const form = new FormData()
  form.append("file", file)
  return postAi<ExtractHtmlResult>("/edit/extract", form)
}

/** Export edited document HTML as pdf / docx / html / txt. */
export async function exportEditedHtml(
  html: string,
  format: string,
  basename: string,
) {
  const form = new FormData()
  form.append("html", html)
  form.append("format", format)
  form.append("basename", basename)
  let resp: Response
  try {
    resp = await apiFetch("/edit/export", { method: "POST", body: form })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Export failed: ${msg}`)
  }
  if (!resp.ok) {
    throw new Error(await errorDetail(resp, `Export failed (HTTP ${resp.status}).`))
  }
  const blob = await resp.blob()
  const filename = filenameFromResponse(resp, `${basename}.${format}`)
  downloadBlob(blob, filename)
}

/** Export text as a .pdf, .docx or .txt download. */
export async function exportAiText(text: string, format: "pdf" | "txt" | "docx", basename: string) {
  const form = new FormData()
  form.append("text", text)
  form.append("format", format)
  form.append("basename", basename)
  let resp: Response
  try {
    resp = await apiFetch("/ai/export", { method: "POST", body: form })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Export failed: ${msg}`)
  }
  if (!resp.ok) {
    throw new Error(await errorDetail(resp, `Export failed (HTTP ${resp.status}).`))
  }
  const blob = await resp.blob()
  const filename = filenameFromResponse(resp, `${basename}.${format}`)
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ------------------------------------------------------------------ Data Room

/** A file the app has stored in the org's Data Room. Mirrors the SDK's
 *  `DataRoomFile`, narrowed to what this app shows. */
export interface DataRoomFile {
  id: number
  original_filename: string
  file_url: string
  file_size: number
  mime_type: string
  created_at?: string
}

/** One tool's output folder inside `Results`. */
export interface DataRoomToolFolder {
  id: number
  /** The tool's display title, as the folder is named in the room. */
  name: string
  files: DataRoomFile[]
}

export interface DataRoomFolderListing {
  name: string
  /** Files sitting directly in the folder. For `Results` this is only what was
   *  archived before outputs were grouped by tool — normally empty. */
  files: DataRoomFile[]
  /** `Results` only: one entry per tool that has produced something. */
  folders?: DataRoomToolFolder[]
}

export interface DataRoomListing {
  /** False when the platform provides no Data Room — the plain local
   *  simulator, for instance. `detail` then says why, and both folders are
   *  empty rather than absent, so the page can render either way. */
  available: boolean
  detail?: string
  app_folder: string
  room?: { id: number; name: string }
  uploads: DataRoomFolderListing
  results: DataRoomFolderListing
}

/**
 * Read the app's two Data Room folders.
 *
 * Goes through this plugin's own backend rather than the SDK's `dataRooms`
 * client, and that is not a shortcut: `createPaletteClient(ctx)` builds the
 * data-room client as `new DataRoomClient()` with **no context** (unlike
 * `StorageClient(ctx)` beside it), so it always calls the SDK's module-level
 * `apiFetch`, whose base URL is a build-time `http://localhost:8000`. A plugin
 * bundle is built by `pltt`, not by the OS, so from inside the sandboxed iframe
 * that address does not resolve. The backend's `ctx.data_rooms` is
 * platform-injected and works.
 */
export function listDataRoom(): Promise<DataRoomListing> {
  return getJson("/data-room", "Could not read the Data Room.")
}
