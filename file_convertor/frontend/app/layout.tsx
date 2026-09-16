"use client"

import "./compiled.css"
import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

import { useColorMode } from "@/hooks/use-color-mode"
import { registerApiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"

// Keep multipart/form-data uploads intact through the OS `apiFetch` bridge.
// The bridge injects `Content-Type: application/json` onto every request; for
// a FormData body that overrides the browser's boundary-carrying
// `multipart/form-data` header and the backend's UploadFile parses as missing.
// Patch `window.fetch` once: for FormData bodies, drop Content-Type and let
// the browser set it. JSON requests pass through untouched.
if (typeof window !== "undefined") {
  const w = window as unknown as { __fileConvFetchPatched?: boolean }
  if (!w.__fileConvFetchPatched) {
    w.__fileConvFetchPatched = true
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init && init.body instanceof FormData) {
        const headers = new Headers(init.headers || {})
        headers.delete("Content-Type")
        return originalFetch(input, { ...init, headers })
      }
      return originalFetch(input, init)
    }
  }
}

/** Renders a visible error panel instead of leaving the plugin surface blank
 *  when any descendant throws. */
class LayoutErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[file-convertor] layout error", error, info)
  }
  render() {
    if (!this.state.error) return this.props.children
    const e = this.state.error as Error
    return (
      <div
        style={{
          padding: 16,
          margin: 16,
          background: "#fff1f2",
          border: "1px solid #fb7185",
          color: "#9f1239",
          fontFamily: "ui-monospace, monospace",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>file-convertor crashed</div>
        <div>{(e && (e.message || String(e))) || "unknown error"}</div>
      </div>
    )
  }
}

function ApiFetchBridge({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const fetchFn = (platform as unknown as { apiFetch?: typeof fetch }).apiFetch

  // Deliberately DURING render, not in an effect.
  //
  // React runs child effects before parent effects, and this component is a
  // parent of every page. Registering in an effect meant any page that fetches
  // on mount — the Data Room page does — ran before the bridge existed and fell
  // through to the standalone `localhost:8000` base. The symptom is a
  // connection-refused on the platform, where nothing is listening there.
  //
  // The write is guarded so it happens once per changed value rather than on
  // every render, which was the reason to move it in the first place.
  const registered = React.useRef<typeof fetchFn>(undefined)
  if (fetchFn && registered.current !== fetchFn) {
    registered.current = fetchFn
    registerApiFetch(fetchFn as never)
  }

  return <>{children}</>
}

/**
 * The plugin's root element, carrying the theme it was told to use.
 *
 * Both markers are required, because the theme reaches the app two ways:
 *
 *   - `data-dt-theme` resolves the token block ON THIS ELEMENT, which is what
 *     paints `bg-background` here and what every `var(--dt-*)` below inherits;
 *   - the `dark` CLASS is what makes the ~60 `dark:` utilities scattered
 *     through the components match, since that variant is `&:is(.dark *)` — a
 *     descendant selector.
 *
 * Set only one and half the app stays light. See the long note at the top of
 * globals.css for why a host class cannot do either job.
 */
function AppRoot({ children }: { children: React.ReactNode }) {
  // The ref lets the theme search walk up from the plugin's own position rather
  // than guessing which ancestor the host marked.
  const rootRef = React.useRef<HTMLDivElement>(null)
  const colorMode = useColorMode(rootRef)
  return (
    <div
      ref={rootRef}
      data-file-convertor-root
      data-dt-root=""
      data-dt-theme={colorMode}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground antialiased",
        colorMode === "dark" && "dark",
      )}
      style={{ height: "100%" }}
    >
      {children}
    </div>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <LayoutErrorBoundary>
      <ApiFetchBridge>
        <AppRoot>{children}</AppRoot>
      </ApiFetchBridge>
    </LayoutErrorBoundary>
  )
}
