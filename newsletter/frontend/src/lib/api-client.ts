import type {
  Brand,
  DocumentChunk as DocumentChunkDTO,
  DocumentPreview,
  BrandTemplate,
  BrandTheme,
  GenerateRequest,
  Mascot,
  Newsletter,
  Palette,
  RenderedTemplate,
  RetrievedChunk,
  SourceDocument,
} from "./types"
import { nextExportFilename } from "./export-filename"

// Thin client over the plugin backend, mounted at API_BASE by the platform.
// apiFetch is injected per-call from usePlatform() so requests carry the
// platform's auth/session context in both pltt dev and hosted sandbox.

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export const API_BASE = "/api/v1/plugins/newsletter"

/** Pull the backend's `detail` out of a failed response.
 *
 * FastAPI/HTTPException errors carry the real cause in `detail`; dropping it
 * (as this used to, keeping only `status statusText`) is what leaves a failed
 * upload showing nothing but "500" in the UI while the actual reason —
 * platform storage unavailable, a DB/schema error — is sitting in the body. */
async function errorDetail(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "")
  if (raw) {
    try {
      const body = JSON.parse(raw)
      const detail = body?.detail ?? body?.message
      if (typeof detail === "string" && detail.trim()) return detail
      if (detail) return JSON.stringify(detail)
    } catch {
      // non-JSON body (e.g. a proxy's plain-text error page) — use it as-is
    }
    return raw.slice(0, 300)
  }
  return `${res.status} ${res.statusText}`.trim()
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await errorDetail(res)}`)
  return (await res.json()) as T
}

// The SDK's own apiUpload() helper reads a module-level base URL that pltt
// dev's local simulator never configures (it only wires the platform's
// closure-scoped apiFetch, injected via usePlatform() — apiUpload always hits
// the SDK's http://localhost:8000 default in local dev). Build uploads on
// apiFetch instead so they go through the correctly-wired backend URL in both
// pltt dev and hosted sandbox.
async function upload(apiFetch: ApiFetch, path: string, file: File): Promise<Response> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch(path, { method: "POST", body: form })
}

export async function listDocuments(apiFetch: ApiFetch): Promise<SourceDocument[]> {
  return json(await apiFetch(`${API_BASE}/documents`, { cache: "no-store" }))
}

export async function searchDocuments(apiFetch: ApiFetch, query: string): Promise<SourceDocument[]> {
  return json(
    await apiFetch(`${API_BASE}/documents/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  )
}

export async function uploadFile(apiFetch: ApiFetch, file: File): Promise<SourceDocument> {
  return json(await upload(apiFetch, `${API_BASE}/documents/upload`, file))
}

export async function getDocument(apiFetch: ApiFetch, id: string): Promise<SourceDocument> {
  return json(await apiFetch(`${API_BASE}/documents/${id}`, { cache: "no-store" }))
}

export async function getDocumentChunks(
  apiFetch: ApiFetch,
  id: string,
): Promise<DocumentChunkDTO[]> {
  return json(await apiFetch(`${API_BASE}/documents/${id}/chunks`, { cache: "no-store" }))
}

export async function getDocumentPreview(
  apiFetch: ApiFetch,
  id: string,
): Promise<DocumentPreview> {
  return json(await apiFetch(`${API_BASE}/documents/${id}/preview`, { cache: "no-store" }))
}

/** One rendered page as an object URL.
 *
 * Fetched through `apiFetch` rather than set straight on `<img src>`: the
 * preview routes are permission-gated plugin API routes, so a bare <img>
 * request would arrive without the platform's auth context. The caller owns the
 * returned URL and must revoke it. */
export async function getDocumentPageImage(
  apiFetch: ApiFetch,
  id: string,
  page: number,
): Promise<string> {
  const res = await apiFetch(`${API_BASE}/documents/${id}/preview/${page}`)
  if (!res.ok) throw new Error(`${res.status}: ${await errorDetail(res)}`)
  return URL.createObjectURL(await res.blob())
}

export async function deleteDocument(apiFetch: ApiFetch, id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `${res.status}`)
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Render on the server and save the result as a file.
 *
 * Fetched through `apiFetch` rather than opened as a URL: the export routes are
 * permission-gated plugin API routes, so they need the platform's auth context,
 * and going through fetch also lets a failure surface as a real error instead
 * of a stray tab showing an error page. */
export async function downloadExport(
  apiFetch: ApiFetch,
  id: string,
  format: "pdf" | "html",
  fallbackTitle = "newsletter",
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/newsletters/${id}/export.${format}`, {
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`${res.status}: ${await errorDetail(res)}`)
  const blob = await res.blob()
  // Our own numbered name rather than the server's Content-Disposition: that
  // header is the same on every export, so repeated downloads would collide.
  saveBlob(blob, nextExportFilename(id, fallbackTitle, format))
}

// ---- mascots ----

export async function listMascots(apiFetch: ApiFetch): Promise<Mascot[]> {
  return json(await apiFetch(`${API_BASE}/mascots`, { cache: "no-store" }))
}

export async function uploadMascot(apiFetch: ApiFetch, file: File): Promise<Mascot> {
  return json(await upload(apiFetch, `${API_BASE}/mascots/upload`, file))
}

export async function startPose(
  apiFetch: ApiFetch,
  mascotId: string,
  prompt: string,
): Promise<{ poseId: string; status: string }> {
  return json(
    await apiFetch(`${API_BASE}/mascots/${mascotId}/pose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    }),
  )
}

export async function poseStatus(
  apiFetch: ApiFetch,
  poseId: string,
): Promise<{ status: "pending" | "ready" | "error"; imageUrl?: string; error?: string }> {
  return json(await apiFetch(`${API_BASE}/mascots/pose/${poseId}/status`, { cache: "no-store" }))
}

export async function deleteMascot(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch(`${API_BASE}/mascots/${id}`, { method: "DELETE" })
}

// ---- overlay images ----

export async function uploadImage(apiFetch: ApiFetch, file: File): Promise<{ imageUrl: string }> {
  return json(await upload(apiFetch, `${API_BASE}/images/upload`, file))
}

export async function generateImage(apiFetch: ApiFetch, prompt: string): Promise<{ imageUrl: string }> {
  return json(
    await apiFetch(`${API_BASE}/images/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    }),
  )
}

/** Reference-guided edit: upload an image, then use it + a prompt as the
 * basis for AI generation (same gateway model as mascot posing). */
export async function startImageEdit(
  apiFetch: ApiFetch,
  imageUrl: string,
  prompt: string,
): Promise<{ jobId: string; status: string }> {
  return json(
    await apiFetch(`${API_BASE}/images/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl, prompt }),
    }),
  )
}

export async function imageEditStatus(
  apiFetch: ApiFetch,
  jobId: string,
): Promise<{ status: "pending" | "ready" | "error"; imageUrl?: string; error?: string }> {
  return json(await apiFetch(`${API_BASE}/images/edit/${jobId}/status`, { cache: "no-store" }))
}

// ---- brand ----

export async function getBrand(apiFetch: ApiFetch): Promise<Brand> {
  return json(await apiFetch(`${API_BASE}/brand`, { cache: "no-store" }))
}

export async function updateBrand(apiFetch: ApiFetch, patch: Partial<Brand>): Promise<Brand> {
  return json(
    await apiFetch(`${API_BASE}/brand`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  )
}

export async function uploadLogo(apiFetch: ApiFetch, file: File): Promise<Brand> {
  return json(await upload(apiFetch, `${API_BASE}/brand/logo`, file))
}

export async function renderBrand(
  apiFetch: ApiFetch,
  title: string,
  palette: Palette,
  headers: BrandTemplate[],
  footers: BrandTemplate[],
  createdAt?: string,
): Promise<{ headers: RenderedTemplate[]; footers: RenderedTemplate[] }> {
  return json(
    await apiFetch(`${API_BASE}/brand/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, palette, headers, footers, createdAt }),
    }),
  )
}

// ---- brand themes ----

export async function listBrandThemes(apiFetch: ApiFetch): Promise<BrandTheme[]> {
  return json(await apiFetch(`${API_BASE}/brand/themes`, { cache: "no-store" }))
}

export async function createBrandTheme(apiFetch: ApiFetch, patch: Partial<BrandTheme>): Promise<BrandTheme> {
  return json(
    await apiFetch(`${API_BASE}/brand/themes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  )
}

export async function updateBrandTheme(
  apiFetch: ApiFetch,
  id: string,
  patch: Partial<BrandTheme>,
): Promise<BrandTheme> {
  return json(
    await apiFetch(`${API_BASE}/brand/themes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  )
}

export async function deleteBrandTheme(apiFetch: ApiFetch, id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/brand/themes/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `${res.status}`)
}

// ---- newsletters ----

export async function listNewsletters(apiFetch: ApiFetch): Promise<Newsletter[]> {
  return json(await apiFetch(`${API_BASE}/newsletters`, { cache: "no-store" }))
}

export async function getNewsletter(apiFetch: ApiFetch, id: string): Promise<Newsletter> {
  return json(await apiFetch(`${API_BASE}/newsletters/${id}`, { cache: "no-store" }))
}

export async function updateNewsletter(
  apiFetch: ApiFetch,
  id: string,
  patch: Partial<Newsletter>,
): Promise<Newsletter> {
  return json(
    await apiFetch(`${API_BASE}/newsletters/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  )
}

export async function retrieve(
  apiFetch: ApiFetch,
  focusPrompt: string,
  sourceDocumentIds: string[],
): Promise<RetrievedChunk[]> {
  return json(
    await apiFetch(`${API_BASE}/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ focusPrompt, sourceDocumentIds }),
    }),
  )
}

export async function generateNewsletter(apiFetch: ApiFetch, req: GenerateRequest): Promise<Newsletter> {
  return json(
    await apiFetch(`${API_BASE}/newsletters/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    }),
  )
}
