import { createPaletteClient, type PlatformContext } from "@palettelab/sdk"

/** A receipt persisted in the platform's durable storage, as stored on the
 *  expense record. */
export interface ReceiptStorageRef {
  object_path: string
  file_url: string
  content_type: string
  original_name: string
}

/**
 * Upload a receipt file to the platform's durable storage service via the SDK
 * (`palette.storage`). On the hosted platform this is the OS-configured backend
 * (GCS), so the file survives server restarts — unlike the plugin's local
 * filesystem. Returns a reference to persist on the expense, or `null` when
 * platform storage isn't available or the upload fails (e.g. standalone dev),
 * so the caller can fall back to sending the raw file to the backend.
 *
 * `platform_services: ["storage"]` is declared in palette-plugin.json, which is
 * what grants this app access to the storage service.
 */
export async function uploadReceiptToStorage(
  platform: PlatformContext | null | undefined,
  file: File,
): Promise<ReceiptStorageRef | null> {
  if (!platform || !file) return null
  try {
    const palette = createPaletteClient(platform)
    const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "receipt"
    // Keep keys unique so two receipts with the same filename never collide.
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await palette.storage.upload(file, {
      key: `receipts/${unique}-${safeName}`,
      contentType: file.type || "application/octet-stream",
    })
    if (!result?.object_path) return null
    return {
      object_path: result.object_path,
      file_url: result.file_url,
      content_type: result.content_type || file.type || "application/octet-stream",
      original_name: file.name,
    }
  } catch {
    // Platform storage unavailable/failed — signal fallback to backend upload.
    return null
  }
}
