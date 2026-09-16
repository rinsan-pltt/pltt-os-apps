"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * Filter state that lives in the URL.
 *
 * Filters used to be plain `useState`, so a reload, or a trip to Reports and
 * back, silently reset everything the user had set up.
 *
 * `next/navigation` here is the Palette SDK router — the pltt bundler aliases
 * the module (`@palettelab/cli/lib/bundler.js`), and its `replace` writes
 * through to `history.replaceState`. So this survives reload and back/forward
 * within the plugin. `replace` rather than `push` on purpose: filtering is not
 * a navigation, and pushing would make Back walk backwards through every
 * keystroke's worth of filter state.
 */

export interface UrlKeySpec {
  /** Value that means "unset". Never written to the URL. */
  default: string
  /** Reject junk. Returning null falls back to `default` *without* rewriting
   *  the address bar — important, because a malformed date would otherwise be
   *  sent to the backend, which 422s on it. */
  parse?: (raw: string) => string | null
}

export function useUrlState<K extends string>(
  spec: Record<K, UrlKeySpec>,
): [Record<K, string>, (patch: Partial<Record<K, string>>) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const specRef = React.useRef(spec)
  specRef.current = spec

  const keys = Object.keys(spec) as K[]
  // Flattened so the memo below doesn't churn on every render.
  const raw = keys.map((k) => `${k}=${params.get(k) ?? ""}`).join("&")

  const value = React.useMemo(() => {
    const out = {} as Record<K, string>
    for (const key of Object.keys(specRef.current) as K[]) {
      const entry = specRef.current[key]
      const present = new URLSearchParams(raw).get(key)
      if (present === null || present === "") {
        out[key] = entry.default
        continue
      }
      const parsed = entry.parse ? entry.parse(present) : present
      out[key] = parsed ?? entry.default
    }
    return out
  }, [raw])

  const setValue = React.useCallback(
    (patch: Partial<Record<K, string>>) => {
      // Clone the LIVE query string rather than rebuilding it: the host's own
      // params (the SDK router carries preview_publish_id / preview_token) live
      // here too, and rebuilding from scratch would drop them.
      const next = new URLSearchParams(
        typeof window === "undefined" ? "" : window.location.search,
      )
      for (const [key, v] of Object.entries(patch) as [K, string][]) {
        // Defaults are absent, not spelled out. That also means the "all"
        // sentinel never reaches the URL, and `toQuery` in lib/api.ts — which
        // already drops "all" — needs no change.
        if (v === undefined) continue
        if (v === specRef.current[key].default || v === "") next.delete(key)
        else next.set(key, v)
      }
      const qs = next.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`)
    },
    [router, pathname],
  )

  return [value, setValue]
}

/** Shared validators, so a hand-typed URL can never put the app into a state
 *  the backend rejects. */
export const urlParse = {
  oneOf:
    (allowed: readonly string[]) =>
    (raw: string): string | null =>
      allowed.includes(raw) ? raw : null,
  isoDate: (raw: string): string | null =>
    /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null,
  text:
    (max = 200) =>
    (raw: string): string | null =>
      raw.slice(0, max),
}
