"use client"

import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

/**
 * Theme provider driven by the Palette OS appearance.
 *
 * Palette OS (>= @palettelab/sdk 0.1.24) reports the active light/dark
 * appearance through `usePlatform().colorMode` and updates it live when the OS
 * switches. This provider simply mirrors that value into the app and exposes the
 * same `useTheme(): { theme, setTheme }` surface the plugin already consumes
 * (e.g. `AppThemeRoot` applies the theme class to the plugin root).
 *
 * For older hosts that don't yet send `colorMode`, it falls back to the
 * browser's `prefers-color-scheme`.
 */

type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
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
    const onChange = () => {
      setFallback(media.matches ? "dark" : "light")
      // A browser-level appearance change is the user acting outside the app —
      // follow it even if the "d" shortcut had set a local override.
      setOverride(null)
    }
    setFallback(media.matches ? "dark" : "light")
    media.addEventListener?.("change", onChange)
    return () => media.removeEventListener?.("change", onChange)
  }, [])

  // Local user override (e.g. the "d" shortcut). Takes precedence over the OS
  // value so the toggle works even in the dev simulator, where
  // `setColorMode` does not echo back into `platform.colorMode`. In Palette OS
  // `setColorMode` drives a real OS appearance change that flows back through
  // `colorMode`, so the two stay consistent.
  const [override, setOverride] = React.useState<Theme | null>(null)

  // When the OS appearance itself changes (the toggle outside the app), it is
  // the freshest user intent — drop any stale local override so the app
  // follows it. Without this, one "d" press would pin the theme for the rest
  // of the session and the OS switch would appear to do nothing.
  const prevColorModeRef = React.useRef(platform.colorMode)
  React.useEffect(() => {
    if (platform.colorMode !== prevColorModeRef.current) {
      prevColorModeRef.current = platform.colorMode
      setOverride(null)
    }
  }, [platform.colorMode])

  const theme: Theme = override ?? platform.colorMode ?? fallback
  const setTheme = React.useCallback(
    (next: Theme) => {
      setOverride(next)
      platform.setColorMode?.(next)
    },
    [platform],
  )

  // Press "d" to toggle light/dark. Ignored while typing in a field or when
  // combined with a modifier, so it never fights with text entry or shortcuts.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return
      e.preventDefault()
      setTheme(theme === "dark" ? "light" : "dark")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [theme, setTheme])

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>")
  }
  return ctx
}
