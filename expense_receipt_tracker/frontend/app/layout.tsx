"use client"

import "./compiled.css"
import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

import { CategoriesProvider } from "@/components/categories-provider"
import { CommandsProvider } from "@/components/command-provider"
import { SettingsProvider } from "@/components/settings-provider"
import { ToastProvider } from "@/components/ui/toast"
import { registerApiFetch } from "@/lib/api"
import { useColorMode } from "@/hooks/use-color-mode"
import { cn } from "@/lib/utils"

// Keep multipart/form-data uploads intact through the OS `apiFetch` bridge.
// The bridge injects `Content-Type: application/json` onto every request; for
// a FormData body that overrides the browser's boundary-carrying
// `multipart/form-data` header and the backend's UploadFile parses as missing.
// Patch `window.fetch` once: for FormData bodies, drop Content-Type and let
// the browser set it. JSON requests pass through untouched.
if (typeof window !== "undefined") {
  const w = window as unknown as { __expenseReceiptFetchPatched?: boolean }
  if (!w.__expenseReceiptFetchPatched) {
    w.__expenseReceiptFetchPatched = true
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
 *  when any descendant throws.
 *
 *  Deliberately styled with inline styles and written in English: this is the
 *  fallback for "something else failed", so it must not depend on the compiled
 *  CSS bundle or on the translation provider — either of which could be the
 *  thing that broke. */
class LayoutErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[expense-receipt-tracker] layout error", error, info)
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
        <div style={{ fontWeight: 700, marginBottom: 6 }}>expense-receipt-tracker crashed</div>
        <div>{(e && (e.message || String(e))) || "unknown error"}</div>
      </div>
    )
  }
}

function ApiFetchBridge({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const fetchFn = (platform as unknown as { apiFetch?: typeof fetch }).apiFetch
  if (fetchFn) registerApiFetch(fetchFn as never)
  return <>{children}</>
}

/**
 * The plugin's root element, carrying the theme it was told to use.
 *
 * The dark palette lives under `.dark`, which only helps if a `.dark` ancestor
 * exists. In the simulator one does; under Palette OS the host signals the
 * theme through `usePlatform().colorMode` instead — so the plugin rendered its
 * LIGHT palette inside a dark host, which is why table rows and cards came out
 * white on a dark page.
 *
 * The class goes on THIS element rather than a wrapper: `.dark`'s custom
 * properties then land on the same box that paints `bg-background`, and
 * `dark:` variants (which need `.dark *`) match everything inside. A wrapper
 * with `display: contents` would also work for the cascade but adds a link to
 * the height chain this element is part of, for nothing.
 */
function AppRoot({ children }: { children: React.ReactNode }) {
  // The ref is what lets the theme search walk up from the plugin's own
  // position, rather than guessing which ancestor the host marked.
  const rootRef = React.useRef<HTMLDivElement>(null)
  const colorMode = useColorMode(rootRef)
  return (
    <div
      ref={rootRef}
      data-expense-receipt-tracker-root
      // These two drive the palette. globals.css keys both themes off
      // [data-erx-root][data-erx-theme], because the platform scopes the
      // stylesheet to the plugin root and a host class can never satisfy the
      // resulting descendant selector. Namespaced rather than a plain
      // `data-theme`, which the host may well style itself.
      data-erx-root=""
      data-erx-theme={colorMode}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground antialiased [scrollbar-gutter:stable]",
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
        <SettingsProvider>
          <CategoriesProvider>
            <ToastProvider>
              {/* Inside AppRoot is wrong for this one: the palette is a Dialog,
                  and it has to render within the themed plugin root — but it
                  also has to wrap the pages so any of them can register an
                  action, so the provider goes outside and mounts the palette
                  as a sibling of the page tree. */}
              <AppRoot>
                <CommandsProvider>{children}</CommandsProvider>
              </AppRoot>
            </ToastProvider>
          </CategoriesProvider>
        </SettingsProvider>
      </ApiFetchBridge>
    </LayoutErrorBoundary>
  )
}
