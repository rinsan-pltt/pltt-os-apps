"use client"

import * as React from "react"

/**
 * Global keyboard shortcuts.
 *
 * Registered on the bubble phase on purpose: `components/ui/dialog.tsx` listens
 * at *capture* phase for its focus trap, so anything here would otherwise fight
 * it for Escape and Tab.
 */

export interface Hotkey {
  /** e.g. "mod+k", "shift+x", "/", "j" — "mod" is Cmd on macOS, Ctrl elsewhere. */
  combo: string
  run: (event: KeyboardEvent) => void
  /** Fire even while the user is typing. Only sensible for chords. */
  allowInInput?: boolean
  enabled?: boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true ||
    el.closest?.("[role='textbox']") != null
  )
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split("+")
  const key = parts[parts.length - 1]
  const wantMod = parts.includes("mod")
  const wantShift = parts.includes("shift")
  const wantAlt = parts.includes("alt")

  const mod = e.metaKey || e.ctrlKey
  if (wantMod !== mod) return false
  if (wantAlt !== e.altKey) return false
  // Shift is implicit for characters that require it (e.g. "?"), so only
  // enforce it when the binding asks for it.
  if (wantShift && !e.shiftKey) return false

  return e.key.toLowerCase() === key
}

export function useHotkeys(hotkeys: Hotkey[], options?: { enabled?: boolean }) {
  const ref = React.useRef(hotkeys)
  ref.current = hotkeys
  const enabled = options?.enabled ?? true

  React.useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      // IME composition first, before anything else. This app ships Korean, and
      // typing Hangul emits keydown with isComposing — a bare-letter binding
      // would swallow it and mangle the user's input mid-word.
      if (e.isComposing || e.keyCode === 229) return

      // Never steal keys from an open modal except the palette toggle itself.
      const modalOpen = document.querySelector('[role="dialog"][aria-modal="true"]') != null
      const typing = isTypingTarget(e.target)

      for (const hotkey of ref.current) {
        if (hotkey.enabled === false) continue
        if (!matches(hotkey.combo, e)) continue
        if (typing && !hotkey.allowInInput) continue
        if (modalOpen && !hotkey.allowInInput) continue
        // A bare letter must never shadow a browser or OS chord.
        const bare = !hotkey.combo.includes("mod") && !hotkey.combo.includes("alt")
        if (bare && (e.metaKey || e.ctrlKey || e.altKey)) continue
        e.preventDefault()
        hotkey.run(e)
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}
