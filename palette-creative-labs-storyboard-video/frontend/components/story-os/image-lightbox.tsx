"use client"

// A single full-screen image viewer for the story UI. Any component calls
// useLightbox()(url) to enlarge a reference or generated image; the overlay
// is portaled to the plugin's portal host so it escapes overflow clipping.
// Reference images can additionally pass their vision-model analysis
// (kind/name/description), shown in a side panel next to the image.

import * as React from "react"
import { createPortal } from "react-dom"
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react"
import { usePlttCreativeVideoPortalContainer } from "@/components/ui/app-portal"
import { useTheme } from "@/components/providers/theme-provider"

export interface LightboxDetails {
  title?: string
  kind?: string
  description?: string
}

export interface LightboxGalleryItem {
  url: string
  alt?: string
}

const Ctx = React.createContext<
  (url: string, alt?: string, details?: LightboxDetails, gallery?: LightboxGalleryItem[]) => void
>(() => {})

/** Returns `open(url, alt?, details?, gallery?)` — enlarges the given image,
 * optionally with an analysis panel (reference images) shown to its right.
 * When `gallery` is given (and has more than one entry), prev/next arrows
 * step through it in place without closing the overlay. */
export function useLightbox() {
  return React.useContext(Ctx)
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = React.useState<{
    url: string
    alt?: string
    details?: LightboxDetails
    gallery?: LightboxGalleryItem[]
    // Tracked explicitly (not re-derived from `url`) so navigation stays
    // correct even if two scenes happen to share the same image URL.
    index?: number
  } | null>(null)
  const host = usePlttCreativeVideoPortalContainer()
  const open = React.useCallback(
    (url: string, alt?: string, details?: LightboxDetails, gallery?: LightboxGalleryItem[]) => {
      const at = gallery?.findIndex((g) => g.url === url)
      setItem({ url, alt, details, gallery, index: at !== undefined && at >= 0 ? at : 0 })
    },
    [],
  )
  // The overlay is portaled outside the app's `.pos-root`, so the theme
  // variables don't inherit — stamp the current theme on the overlay's own
  // root (same shared theme the app toolbar toggles).
  const { theme } = useTheme()

  const step = React.useCallback((delta: number) => {
    setItem((cur) => {
      if (!cur?.gallery || cur.gallery.length < 2) return cur
      const from = cur.index ?? 0
      const nextIndex = (from + delta + cur.gallery.length) % cur.gallery.length
      const next = cur.gallery[nextIndex]
      return { url: next.url, alt: next.alt, gallery: cur.gallery, index: nextIndex }
    })
  }, [])

  React.useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setItem(null)
      else if (e.key === "ArrowLeft") step(-1)
      else if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [item, step])

  return (
    <Ctx.Provider value={open}>
      {children}
      {item &&
        createPortal(
          <div
            className="pos-root fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8 backdrop-blur-lg"
            data-pos-theme={theme}
            style={{ background: "rgba(0,0,0,0.72)" }}
            onClick={() => setItem(null)}
            role="dialog"
            aria-modal="true"
          >
            {/* Close is pinned to the overlay's own corner (not the image
                panel's edge, nor `fixed` to the true viewport — the plugin
                sandbox's transformed root would then hijack its containing
                block) so its position stays predictable whether or not the
                details side-panel is showing. */}
            <button
              type="button"
              onClick={() => setItem(null)}
              aria-label="Close"
              className="absolute top-5 right-5 z-10 size-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white/85 hover:text-white flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,.5)]"
            >
              <IconX className="size-5" />
            </button>
            {/* The image sits in a panel ("tab") over the blurred backdrop. A
                reference's analyzed data (kind/name/description), when
                given, shows in a panel to the image's right. */}
            <div
              className="relative max-w-[97vw] max-h-[94vh] flex items-stretch gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative p-2.5 rounded-2xl bg-[var(--pos-s2)] border border-[var(--pos-b2)] shadow-[0_32px_80px_rgba(0,0,0,.65)] flex items-center justify-center min-w-0">
                <img
                  src={item.url}
                  alt={item.alt ?? ""}
                  className="max-w-full max-h-[90vh] object-contain rounded-xl block"
                />
                {item.gallery && item.gallery.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label="Previous image"
                      className="absolute left-4 top-1/2 -translate-y-1/2 size-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white/85 hover:text-white flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,.5)]"
                    >
                      <IconChevronLeft className="size-6" />
                    </button>
                    <button
                      type="button"
                      onClick={() => step(1)}
                      aria-label="Next image"
                      className="absolute right-4 top-1/2 -translate-y-1/2 size-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white/85 hover:text-white flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,.5)]"
                    >
                      <IconChevronRight className="size-6" />
                    </button>
                    <span className="absolute bottom-4 left-1/2 -translate-x-1/2 pos-mono text-[11px] font-medium text-white/90 bg-black/60 border border-white/10 px-2.5 py-1 rounded-full backdrop-blur-md">
                      {(item.index ?? 0) + 1} / {item.gallery.length}
                    </span>
                  </>
                )}
              </div>
              {item.details && (item.details.description || item.details.kind || item.details.title) && (
                <div className="w-[280px] shrink-0 rounded-2xl bg-[var(--pos-s2)] border border-[var(--pos-b2)] shadow-[0_32px_80px_rgba(0,0,0,.65)] p-4 overflow-y-auto max-h-[94vh]">
                  {item.details.title && (
                    <div className="text-sm font-semibold text-[var(--pos-t1)] mb-2">{item.details.title}</div>
                  )}
                  {item.details.kind && (
                    <span className="inline-block pos-mono text-[10px] uppercase tracking-wide text-[var(--pos-vioT)] bg-[var(--pos-vioS)] px-2 py-0.5 rounded mb-2.5">
                      {item.details.kind}
                    </span>
                  )}
                  {item.details.description && (
                    <p className="text-xs leading-relaxed text-[var(--pos-t2)] whitespace-pre-wrap">
                      {item.details.description}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>,
          host ?? document.body,
        )}
    </Ctx.Provider>
  )
}
