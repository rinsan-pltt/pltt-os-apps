"use client"

import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

/**
 * Whether to render the plugin's dark palette.
 *
 * The plugin has to decide this itself. `@palettelab/cli` scopes the plugin's
 * stylesheet to its root at publish time, rewriting `.dark { … }` into
 * `[data-palette-plugin-root="…"] .dark { … }` — a DESCENDANT selector. Every
 * element the host might mark as dark is an ANCESTOR of that root, so no host
 * class can ever satisfy the scoped rule. Under `pltt dev` the CSS is injected
 * unscoped and plain `.dark` matches any ancestor, which is why theming looks
 * correct in the simulator and fails on the platform.
 *
 * So the class has to go on an element the plugin owns, and this decides when.
 *
 * The search walks the whole ancestor chain with `closest`, not just <html> and
 * <body>. That is the important part: a host that marks its app-shell wrapper
 * rather than the document element is invisible to a check that only looks at
 * those two, while unscoped CSS in dev would still have matched it — the exact
 * shape of "works in the simulator, not on the OS".
 *
 * Order: `usePlatform().colorMode` is the documented signal — Palette OS reports
 * the active appearance there and updates it live — so it wins outright,
 * including when it says "light". The DOM walk and `prefers-color-scheme` are
 * fallbacks for hosts predating that API, not tie-breakers.
 */

const THEME_ATTRS = ["data-theme", "data-color-mode", "data-mode", "data-appearance"]

const DARK_SELECTOR = [".dark", ...THEME_ATTRS.map((a) => `[${a}~="dark"]`)].join(",")
const LIGHT_SELECTOR = [".light", ...THEME_ATTRS.map((a) => `[${a}~="light"]`)].join(",")

/**
 * The nearest explicit theme marker strictly ABOVE `el`, or null if the DOM
 * says nothing. Whichever is closer wins, so a dark app shell inside a light
 * document resolves to dark.
 *
 * Starting at the parent rather than at `el` is load-bearing: the plugin root
 * publishes this hook's own result as `data-theme`, and `closest` includes the
 * element it starts from — so searching from `el` found that attribute first
 * and the hook read its own output back, pinning it to light forever.
 */
function nearestSignal(el: Element | null): boolean | null {
  const from = el?.parentElement ?? null
  if (!from) return null
  const dark = from.closest(DARK_SELECTOR)
  const light = from.closest(LIGHT_SELECTOR)
  if (dark && light) return light.contains(dark) ? true : false
  if (dark) return true
  if (light) return false
  return null
}

function prefersDark(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
}

export function useColorMode(ref: React.RefObject<HTMLElement | null>): "light" | "dark" {
  const platform = usePlatform() as unknown as { colorMode?: string }
  const platformMode = platform?.colorMode

  // Not read during render: `next build` may prerender this, where there is no
  // document, and a first paint that disagrees with the client would flash the
  // wrong palette.
  const [fromDom, setFromDom] = React.useState<boolean | null>(null)
  const [media, setMedia] = React.useState(false)

  React.useEffect(() => {
    const sync = () => {
      setFromDom((prev) => {
        const next = nearestSignal(ref.current)
        return prev === next ? prev : next
      })
      setMedia((prev) => {
        const next = prefersDark()
        return prev === next ? prev : next
      })
    }
    sync()

    // Attributes only, but across the whole tree: the marker can be on any
    // ancestor, and which ancestor is the host's business, not ours. Cheap
    // because it never fires on child lists or text, and `sync` is a no-op
    // unless the resolved value actually changed.
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class", ...THEME_ATTRS],
    })

    const query = window.matchMedia?.("(prefers-color-scheme: dark)")
    query?.addEventListener?.("change", sync)
    // The dev simulator announces theme changes on this event; harmless
    // elsewhere.
    window.addEventListener("palette:theme-change", sync)

    return () => {
      observer.disconnect()
      query?.removeEventListener?.("change", sync)
      window.removeEventListener("palette:theme-change", sync)
    }
  }, [ref])

  if (platformMode === "dark" || platformMode === "light") return platformMode
  if (fromDom !== null) return fromDom ? "dark" : "light"
  return media ? "dark" : "light"
}
