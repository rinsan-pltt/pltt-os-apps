"use client"

import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

/**
 * Theme provider driven by the Palette OS appearance.
 *
 * Palette OS (>= @palettelab/sdk 0.1.24) reports the active light/dark
 * appearance through `usePlatform().colorMode` and updates it live when the OS
 * switches. This provider simply mirrors that value into the app — there is
 * no in-app override; light/dark is controlled by the OS only, the same way
 * language is controlled by `usePlatform().language` (see ../story-os/i18n.tsx).
 *
 * For older hosts that don't yet send `colorMode`, it falls back to the
 * browser's `prefers-color-scheme`.
 */

type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

function prefersColorScheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  } catch {
    return "dark"
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()

  // Fallback for hosts that predate the colorMode API. Tracked separately so the
  // app still follows the OS even when the platform value is absent.
  const [fallback, setFallback] = React.useState<Theme>(prefersColorScheme)

  React.useEffect(() => {
    let media: MediaQueryList
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)")
    } catch {
      return
    }
    const onChange = () => setFallback(media.matches ? "dark" : "light")
    setFallback(media.matches ? "dark" : "light")
    media.addEventListener?.("change", onChange)
    return () => media.removeEventListener?.("change", onChange)
  }, [])

  const theme: Theme = platform.colorMode ?? fallback
  const value = React.useMemo(() => ({ theme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>")
  }
  return ctx
}
