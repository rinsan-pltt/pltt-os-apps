"use client"

import * as React from "react"

// Everything a "Remix" restores besides the prompt text: the model and
// parameters the video was generated with, plus the input images (persisted
// in the item's gen_params). All optional — older items may only have some.
export interface RemixSettings {
  model_name?: string
  aspect_ratio?: string
  resolution?: string
  duration?: string
  start_image?: string | null
  end_image?: string | null
  reference_images?: string[]
  elements?: { name?: string | null; frontal_image?: string | null; reference_images?: string[] }[]
}

/** Builds RemixSettings from a generated item / favourite row. */
export function remixSettingsFromItem(it: {
  model_name?: string
  aspect_ratio?: string
  resolution?: string
  duration?: string
  gen_params?: Record<string, unknown> | null
  image_references?: Array<string | { id?: string; url: string }>
}): RemixSettings {
  const gp = (it.gen_params ?? {}) as Record<string, unknown>
  const normalize = (refs?: Array<string | { id?: string; url: string }>): string[] =>
    (refs ?? []).map((r) => (typeof r === "string" ? r : r?.url)).filter(Boolean) as string[]
  return {
    model_name: it.model_name,
    aspect_ratio: it.aspect_ratio ?? (gp.aspect_ratio as string | undefined),
    resolution: it.resolution ?? (gp.resolution as string | undefined),
    duration: it.duration ?? (gp.duration as string | undefined),
    start_image: (gp.start_image as string | undefined) ?? null,
    end_image: (gp.end_image as string | undefined) ?? null,
    reference_images: normalize(
      (gp.image_references as Array<string | { url: string }> | undefined) ?? it.image_references,
    ),
    elements: (gp.elements as RemixSettings["elements"]) ?? [],
  }
}

// Lets the generated cards push a video's prompt + settings back into the
// control panel ("Remix").
interface ComposerCtx {
  reuse: (text: string, settings?: RemixSettings) => void
  pending: { text: string; settings?: RemixSettings; id: number } | null
}

const Ctx = React.createContext<ComposerCtx | null>(null)

export function PromptComposerProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<
    { text: string; settings?: RemixSettings; id: number } | null
  >(null)
  const counter = React.useRef(0)
  const reuse = React.useCallback((text: string, settings?: RemixSettings) => {
    counter.current += 1
    setPending({ text, settings, id: counter.current })
  }, [])
  return <Ctx.Provider value={{ reuse, pending }}>{children}</Ctx.Provider>
}

/** Returns the composer, or null when rendered outside a provider. */
export function usePromptComposer() {
  return React.useContext(Ctx)
}
