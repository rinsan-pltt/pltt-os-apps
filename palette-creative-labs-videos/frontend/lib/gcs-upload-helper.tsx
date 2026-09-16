/**
 * Reference-image upload helper.
 *
 * Uploads the image to the plugin backend's multipart route
 * `POST /assets/reference` (`file: UploadFile`), which stores the bytes with
 * `ctx.storage.upload_file` server-side. This matches the backend that is
 * actually deployed in the hosted appstore preview.
 *
 * Why multipart (not browser-direct, not JSON base64)?
 *  - `palette.storage.upload()` POSTs to the unscoped
 *    `/api/v1/app-storage/{plugin}/uploads`; in a preview the app is previewed,
 *    not installed, so the platform answers `{"detail":"App not found"}` (404).
 *  - A JSON base64 route only helps if the backend is redeployed — but
 *    `--sandbox` previews don't reactivate the backend, so the live backend
 *    stays on this multipart route.
 *
 * The catch with multipart: the OS `apiFetch` bridge injects
 * `Content-Type: application/json`, which clobbers the browser's
 * `multipart/form-data; boundary=...` and makes FastAPI see no `file`
 * (HTTP 422 "body.file required"). `app/layout.tsx` installs a one-time
 * `window.fetch` guard that strips `Content-Type` from any FormData request so
 * the browser sets the correct multipart header + boundary.
 */
import type { PaletteClient } from "@palettelab/sdk"

import { apiRequest } from "@/lib/api-helper"

export interface UploadResult {
  id: string
  url: string
  content_hash: string
  status: "created" | "exists"
}

export async function uploadReferenceImage(
  // Retained for call-site compatibility; the upload goes through the plugin
  // backend, so the browser-side storage client is no longer used.
  _palette: PaletteClient | null,
  file: File,
): Promise<UploadResult> {
  const form = new FormData()
  form.append("file", file, file.name)
  return (await apiRequest("/assets/reference", {
    method: "POST",
    body: form,
  })) as UploadResult
}

/** Backwards-compatible alias matching pltt-agg's helper signature. */
export const uploadToGCS = uploadReferenceImage
