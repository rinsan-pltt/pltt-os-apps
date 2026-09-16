"use client"

import "./compiled.css"
import * as React from "react"
import { ThemeProvider, useTheme } from "@/components/providers/theme-provider"
import { usePlatform, isSandboxRuntime } from "@palettelab/sdk"

import { registerApiFetch } from "@/lib/api-helper"
import { cn } from "@/lib/utils"
import { ModelProvider } from "@/components/providers/model-context"
import { ProjectProvider } from "@/components/providers/project-context"
import { AuthProvider } from "@/components/providers/auth-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PlttCreativeVideoPortalProvider } from "@/components/ui/app-portal"

// Keep multipart/form-data uploads intact through the OS `apiFetch` bridge.
// The bridge injects `Content-Type: application/json` onto every request; for a
// FormData body that overrides the browser's `multipart/form-data; boundary=...`,
// so the backend's `UploadFile` field parses as missing (HTTP 422
// "body.file required"). Patch `window.fetch` once: for any FormData body,
// delete `Content-Type` and let the browser set it (with the correct boundary).
// Non-FormData (JSON) requests are passed through untouched.
if (typeof window !== "undefined") {
  const w = window as unknown as { __plttFetchPatched?: boolean }
  if (!w.__plttFetchPatched) {
    w.__plttFetchPatched = true
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

/** Renders a visible error panel instead of leaving the iframe blank when
 *  any descendant throws. Without this, a production runtime error from
 *  any provider (theme, sonner, radix, our own contexts) silently
 *  unmounts the whole tree, which is what produced the empty page on
 *  v1.0.7 — the diagnostic v1.0.8 (no providers) rendered fine. */
class LayoutErrorBoundary extends React.Component<
  { label: string; children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[pltt-creative-video] ${this.props.label} threw`, error, info)
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
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>
          pltt-creative-video — {this.props.label} crashed
        </div>
        <div>{(e && (e.message || String(e))) || "unknown error"}</div>
        {e?.stack && (
          <pre
            style={{
              marginTop: 8,
              padding: 8,
              background: "#fff",
              border: "1px solid #fecaca",
              maxHeight: 240,
              overflow: "auto",
              fontSize: 11,
            }}
          >
            {e.stack}
          </pre>
        )}
      </div>
    )
  }
}

type ReportedRuntimeError = {
  label: string
  message: string
  stack?: string
}

// Paints uncaught errors and unhandled promise rejections inside the plugin
// surface so diagnostics cannot overlay or mutate Palette OS chrome.
function useOnScreenErrorReporter(): ReportedRuntimeError | null {
  const [error, setError] = React.useState<ReportedRuntimeError | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const show = (label: string, message: string, stack?: string) => {
      setError({ label, message, stack })
    }

    const onError = (e: ErrorEvent) => {
      show("uncaught error", e.message || String(e.error), (e.error as Error | undefined)?.stack)
    }
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as Error | undefined
      show("unhandled promise rejection", r?.message ?? String(r), r?.stack)
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
    }
  }, [])

  return error
}

function ApiFetchBridge({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const fetchFn = (platform as unknown as { apiFetch?: typeof fetch }).apiFetch
  if (fetchFn) registerApiFetch(fetchFn as never)
  return <>{children}</>
}

function AppThemeRoot({
  children,
  runtimeError,
}: {
  children: React.ReactNode
  runtimeError: ReportedRuntimeError | null
}) {
  const { theme } = useTheme()
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null)
  // Fill the host-provided container (OS window/tab or standalone viewport),
  // not the whole display. `100vh` resolved to the full display inside the OS
  // sandbox, so the prompt area and Generate button overflowed below the
  // window. `height: 100%` sizes the app to its actual container; the local
  // `pltt dev` simulator however mounts the app into a bare `<div id="root">`
  // with no height, where 100% collapses to content height — there the app
  // must fill the viewport with `100dvh` instead.
  //
  // Which case we're in is decided by MEASURING whether `height: 100%` would
  // actually resolve, not by runtime flags and not by the parent's current
  // pixel size. The distinction matters: the `pltt dev` shell has
  // `min-height: 100vh`, so its clientHeight is always > 0 — yet a percentage
  // height on a child resolves against the `height` property only, which is
  // still `auto`, so `100%` collapses to content height there. Drop an empty
  // `height: 100%` probe div into the parent (inside a pre-paint layout
  // effect, so nothing flashes): if it gets real height, the host provides a
  // definite height → `100%` tracks it (including window resizes). If it
  // measures 0 → bare/auto-height mount → fix the app to `100dvh`.
  // `isSandboxRuntime()` only seeds the first-paint guess.
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [fillViewport, setFillViewport] = React.useState(
    () => typeof window !== "undefined" && !isSandboxRuntime(),
  )
  React.useLayoutEffect(() => {
    const el = rootRef.current
    const parent = el?.parentElement
    if (!el || !parent) return
    const probe = () => {
      const probeEl = document.createElement("div")
      probeEl.style.cssText = "height:100%;width:0;position:static;flex:none;margin:0;padding:0;border:0;"
      parent.appendChild(probeEl)
      const percentHeightResolves = probeEl.offsetHeight > 0
      parent.removeChild(probeEl)
      setFillViewport(!percentHeightResolves)
    }
    probe()
    // The host container can be laid out late (or change on window resize) —
    // re-probe then; the synchronous append/measure/remove never reaches the
    // screen.
    window.addEventListener("resize", probe)
    return () => window.removeEventListener("resize", probe)
  }, [])
  const rootHeight = fillViewport ? "100dvh" : "100%"
  const rootStyle: React.CSSProperties = {
    position: "relative",
    height: rootHeight,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    background: "var(--plttbackground, #ffffff)",
    color: "var(--plttforeground, #111111)",
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  }

  return (
    <div
      ref={rootRef}
      style={rootStyle}
      className={cn(
        theme,
        "h-full antialiased font-mono",
        "bg-background text-foreground flex flex-col",
      )}
      data-pltt-creative-video-theme={theme}
      data-pltt-creative-video-root
    >
      <PlttCreativeVideoPortalProvider container={portalContainer}>
        {runtimeError ? (
          <div
            style={{
              flex: "0 0 auto",
              zIndex: 50,
              background: "#fff1f2",
              color: "#9f1239",
              borderBottom: "2px solid #fb7185",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              lineHeight: 1.5,
              padding: "12px 16px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "50%",
              overflow: "auto",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              pltt-creative-video - {runtimeError.label}
            </div>
            <div>{runtimeError.message}</div>
            {runtimeError.stack ? <pre style={{ marginTop: 8 }}>{runtimeError.stack}</pre> : null}
          </div>
        ) : null}
        <LayoutErrorBoundary label="page">{children}</LayoutErrorBoundary>
        <LayoutErrorBoundary label="Toaster">
          <Toaster position="bottom-right" richColors />
        </LayoutErrorBoundary>
        <style>{`
        /* Scope-safe spinner. Tailwind's \`animate-spin\` is
           \`animation: var(--animate-spin)\` (= "spin 1s linear infinite"); the
           CLI's publish-time CSS scoper renames the \`spin\` keyframe and mangles
           the "spin" token inside that var(), so \`animate-spin\` produces NO
           motion in the published build (it works in \`pltt dev\`, which doesn't
           scope). This runtime <style> is never processed by the scoper, so the
           keyframe name stays intact — use \`pltt-animate-spin\` for any spinner
           that must animate in production. */
        @keyframes pltt-spin360 { to { transform: rotate(360deg); } }
        .pltt-animate-spin { animation: pltt-spin360 1s linear infinite; }

        [data-pltt-creative-video-portal-root] {
          isolation: isolate;
        }

        [data-pltt-creative-video-portal-root] > * {
          pointer-events: auto;
          /* No blanket max-width here: this inline <style> is UNLAYERED and
             would override Tailwind's layered max-w-* utilities (cascade
             layers always lose to unlayered rules in Tailwind v4), forcing
             every dialog to the full window width. Each dialog/sheet keeps
             its own sm:max-w-* utility; the portal's overflow:hidden is the
             hard clamp that keeps anything from escaping the app window. */
          max-height: 100%;
        }

        [data-pltt-creative-video-portal-root] [data-slot="dialog-overlay"],
        [data-pltt-creative-video-portal-root] [data-slot="alert-dialog-overlay"],
        [data-pltt-creative-video-portal-root] [data-slot="sheet-overlay"] {
          width: 100%;
          height: 100%;
        }

        [data-pltt-creative-video-portal-root] [role="dialog"],
        [data-pltt-creative-video-portal-root] [aria-modal="true"],
        [data-pltt-creative-video-portal-root] [data-slot="dialog-content"],
        [data-pltt-creative-video-portal-root] [data-slot="alert-dialog-content"],
        [data-pltt-creative-video-portal-root] [data-slot="sheet-content"] {
          max-height: calc(100% - 32px);
          overflow: auto;
        }

        [data-pltt-creative-video-portal-root] [data-radix-popper-content-wrapper] {
          max-width: 100%;
          max-height: 100%;
        }
      `}</style>
        <div
          ref={setPortalContainer}
          data-pltt-creative-video-portal-root
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2147483000,
            overflow: "hidden",
            pointerEvents: "none",
            contain: "layout paint",
            transform: "translateZ(0)",
          }}
        />
      </PlttCreativeVideoPortalProvider>
    </div>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const runtimeError = useOnScreenErrorReporter()

  return (
    <>
      <LayoutErrorBoundary label="root">
        <ApiFetchBridge>
          <LayoutErrorBoundary label="ThemeProvider">
            <ThemeProvider>
              <LayoutErrorBoundary label="TooltipProvider">
                <TooltipProvider>
                  <LayoutErrorBoundary label="ModelProvider">
                    <ModelProvider>
                      <LayoutErrorBoundary label="AuthProvider">
                        <AuthProvider>
                          <LayoutErrorBoundary label="ProjectProvider">
                            <ProjectProvider>
                              <AppThemeRoot runtimeError={runtimeError}>{children}</AppThemeRoot>
                            </ProjectProvider>
                          </LayoutErrorBoundary>
                        </AuthProvider>
                      </LayoutErrorBoundary>
                    </ModelProvider>
                  </LayoutErrorBoundary>
                </TooltipProvider>
              </LayoutErrorBoundary>
            </ThemeProvider>
          </LayoutErrorBoundary>
        </ApiFetchBridge>
      </LayoutErrorBoundary>
    </>
  )
}
