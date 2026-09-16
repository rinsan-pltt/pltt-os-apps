"use client"

/**
 * Backwards-compatible hook. Uploads a reference image to Palette-managed app
 * storage using the documented SDK storage client (`palette.storage.upload`),
 * then registers the asset record in the plugin DB. Works in `pltt dev` and in
 * the hosted OS preview without sending multipart through the sandbox bridge.
 */
import * as React from "react"
import { createPaletteClient, usePlatform } from "@palettelab/sdk"

import { uploadReferenceImage, type UploadResult } from "@/lib/gcs-upload-helper"

export function useGcsUpload() {
  const platform = usePlatform()
  const palette = React.useMemo(() => createPaletteClient(platform), [platform])
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const upload = React.useCallback(
    async (file: File): Promise<UploadResult | null> => {
      setUploading(true)
      setError(null)
      try {
        return await uploadReferenceImage(palette, file)
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed"
        setError(message)
        return null
      } finally {
        setUploading(false)
      }
    },
    [palette],
  )

  return { upload, uploading, error }
}
