"use client"

import * as React from "react"
import {
  Columns2,
  Download,
  Layers,
  Loader2,
  Minus,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ProgressBar } from "@/components/ui/progress-bar"
import {
  compareRenderPages,
  compareReport,
  downloadBlob,
  runTool,
  type ComparePage,
  type CompareChange,
  type CompareHighlight,
  type CompareReport,
} from "@/lib/api"
import { useT, useRegistryText } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Tool } from "@/lib/tools"

const ACCEPT = ".pdf"
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3
const ZOOM_STEP = 0.15
// Scroll-container padding (Tailwind p-3 = 12px each edge).
const PANE_PAD = 24
// Highlight fills for changed words: rose on the "old" side, emerald on the "new".
const HL_FILL = {
  a: "rgba(244,63,94,0.28)",
  b: "rgba(16,185,129,0.30)",
} as const

type Side = "a" | "b"

interface PaneState {
  file: File | null
  pages: ComparePage[] | null
  loading: boolean
  error: string | null
}

const EMPTY_PANE: PaneState = { file: null, pages: null, loading: false, error: null }

function isPdf(f: File) {
  return f.name.toLowerCase().endsWith(".pdf")
}

/** Empty-pane dropzone: drag-and-drop or click to select a PDF. */
function PaneDropzone({ onFile }: { onFile: (f: File) => void }) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = Array.from(e.dataTransfer.files).find(isPdf)
        if (f) onFile(f)
      }}
      className={cn(
        "m-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && isPdf(f)) onFile(f)
          e.target.value = ""
        }}
      />
      <span>{t("compare.dragDrop")}</span>
      <span className="text-xs">Or</span>
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        Select file
      </Button>
    </div>
  )
}

/** One PDF pane: header (close + name + zoom) and a scrollable page stack. */
function PdfPane({
  side,
  state,
  zoom,
  highlights,
  onClose,
  onZoom,
  scrollRef,
  onScroll,
}: {
  side: Side
  state: PaneState
  zoom: number
  highlights: CompareHighlight[]
  onClose: () => void
  onZoom: (next: number) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
}) {
  const t = useT()
  // Grab-to-pan (hand tool): hold and drag the page to move it around when it's
  // zoomed past the pane. Adjusting scrollTop/Left also drives scroll-sync.
  const drag = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const canPan = Boolean(state.pages?.length)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (e.button !== 0 || !el || !canPan) return
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    setDragging(true)
    el.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!drag.current || !el) return
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y)
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    const el = scrollRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }

  return (
    <div className="flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-muted/30 max-lg:h-[50vh]">
      <div className="flex items-center gap-2 border-b bg-card px-2 py-1.5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("compare.closeFile")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{state.file?.name}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))}
            aria-label={t("compare.zoomOut")}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))}
            aria-label={t("compare.zoomIn")}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: canPan ? (dragging ? "grabbing" : "grab") : undefined }}
        className="flex-1 select-none overflow-auto bg-muted/40 p-3"
      >
        {state.loading ? (
          <div className="grid gap-2 py-10">
            <span className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Rendering…
            </span>
            <ProgressBar className="mx-auto max-w-xs" />
          </div>
        ) : state.error ? (
          <Alert tone="error">{state.error}</Alert>
        ) : (
          state.pages?.map((pg) => {
            const pageHl = highlights.filter((h) => h.page === pg.index)
            return (
              <div
                key={pg.index}
                style={{ width: `${zoom * 100}%` }}
                className="relative mx-auto mb-3 block max-w-none"
              >
                <img
                  src={pg.src}
                  alt={`Page ${pg.index}`}
                  draggable={false}
                  className="block w-full rounded bg-white shadow"
                />
                {pageHl.map((h, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute rounded-[1px]"
                    style={{
                      left: `${h.x * 100}%`,
                      top: `${h.y * 100}%`,
                      width: `${h.w * 100}%`,
                      height: `${h.h * 100}%`,
                      backgroundColor: HL_FILL[side],
                    }}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function ChangeCard({ change }: { change: CompareChange }) {
  const t = useT()
  const label =
    change.type === "delete"
      ? t("compare.typeDelete")
      : change.type === "insert"
        ? t("compare.typeInsert")
        : t("compare.typeEdit")
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{label}</div>
      {change.type !== "insert" && (
        <div className="mb-2 rounded-md bg-rose-50 p-2 dark:bg-rose-950/40">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            <span>Old</span>
            <span className="tabular-nums">−{change.oldCount}</span>
          </div>
          <div className="whitespace-pre-wrap break-words text-xs text-foreground">{change.old}</div>
        </div>
      )}
      {change.type !== "delete" && (
        <div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/40">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            <span>New</span>
            <span className="tabular-nums">+{change.newCount}</span>
          </div>
          <div className="whitespace-pre-wrap break-words text-xs text-foreground">{change.new}</div>
        </div>
      )}
    </div>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("image load failed"))
    img.src = src
  })
}

/**
 * One overlaid page: the two rendered pages composited on a canvas so shared
 * content reads black, content only in the left file (deletions) reads red, and
 * content only in the right file (additions) reads green — on a white ground.
 * Far more legible than a raw `mix-blend-difference`, which turns matching
 * white/black documents into a near-solid black screen.
 */
function OverlayPage({ srcA, srcB }: { srcA?: string; srcB?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [imgA, imgB] = await Promise.all([
        srcA ? loadImage(srcA) : Promise.resolve(null),
        srcB ? loadImage(srcB) : Promise.resolve(null),
      ])
      if (cancelled) return
      const canvas = canvasRef.current
      const base = imgA ?? imgB
      if (!canvas || !base) return
      const w = base.naturalWidth
      const h = base.naturalHeight
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      if (!ctx) return

      const sample = (img: HTMLImageElement | null): Uint8ClampedArray | null => {
        if (!img) return null
        ctx.clearRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h) // scale both sides onto the same grid
        return ctx.getImageData(0, 0, w, h).data
      }
      const pa = sample(imgA)
      const pb = sample(imgB)

      const out = ctx.createImageData(w, h)
      const po = out.data
      const ink = (p: Uint8ClampedArray | null, i: number) =>
        p ? 1 - (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) / 255 : 0
      for (let i = 0; i < po.length; i += 4) {
        const inkA = ink(pa, i)
        const inkB = ink(pb, i)
        const shared = Math.min(inkA, inkB)
        const onlyA = inkA - shared // red — removed
        const onlyB = inkB - shared // green — added
        po[i] = 255 * (1 - shared - onlyB)
        po[i + 1] = 255 * (1 - shared - onlyA)
        po[i + 2] = 255 * (1 - shared - onlyA - onlyB)
        po[i + 3] = 255
      }
      ctx.putImageData(out, 0, 0)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [srcA, srcB])

  return <canvas ref={canvasRef} className="mx-auto mb-3 block w-full rounded bg-white shadow" />
}

export function CompareWorkspace({ tool }: { tool: Tool }) {
  const t = useT()
  const reg = useRegistryText()
  const [a, setA] = React.useState<PaneState>(EMPTY_PANE)
  const [b, setB] = React.useState<PaneState>(EMPTY_PANE)
  const [zoomA, setZoomA] = React.useState(1)
  const [zoomB, setZoomB] = React.useState(1)
  const [scrollSync, setScrollSync] = React.useState(true)
  const [overlay, setOverlay] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const [report, setReport] = React.useState<CompareReport | null>(null)
  const [reportLoading, setReportLoading] = React.useState(false)
  const [reportError, setReportError] = React.useState<string | null>(null)
  const [downloading, setDownloading] = React.useState(false)

  const refA = React.useRef<HTMLDivElement | null>(null)
  const refB = React.useRef<HTMLDivElement | null>(null)
  const syncing = React.useRef(false)

  const setSide = (side: Side, next: PaneState) => (side === "a" ? setA(next) : setB(next))

  // Zoom that keeps the whole first page completely visible: the largest zoom
  // at which the page's height still fits the pane (capped at 100% width-fit).
  const computeFit = (ref: React.RefObject<HTMLDivElement | null>, page: ComparePage) => {
    const el = ref.current
    if (!el) return 1
    const cw = el.clientWidth - PANE_PAD
    const ch = el.clientHeight - PANE_PAD
    if (cw <= 0 || ch <= 0) return 1
    const heightFit = ch / (cw * (page.h / page.w))
    return Math.max(ZOOM_MIN, Math.min(1, heightFit))
  }

  // On (re)load, fit the first page so it's completely visible initially.
  React.useLayoutEffect(() => {
    if (a.pages?.length) setZoomA(computeFit(refA, a.pages[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.pages])
  React.useLayoutEffect(() => {
    if (b.pages?.length) setZoomB(computeFit(refB, b.pages[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.pages])

  // Zoom while preserving the vertical scroll ratio, so the first page stays
  // anchored/visible instead of the view jumping as the content resizes.
  const zoomSide = (side: Side, next: number) => {
    const ref = side === "a" ? refA : refB
    const el = ref.current
    const denom = el ? el.scrollHeight - el.clientHeight : 0
    const ratio = el && denom > 0 ? el.scrollTop / denom : 0
    ;(side === "a" ? setZoomA : setZoomB)(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
    })
  }

  // Render a newly chosen file's pages; clears the report until both are ready.
  const loadFile = React.useCallback((side: Side, file: File) => {
    setSide(side, { file, pages: null, loading: true, error: null })
    setReport(null)
    setReportError(null)
    let cancelled = false
    compareRenderPages(file)
      .then((res) => {
        if (!cancelled) setSide(side, { file, pages: res.pages, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setSide(side, {
            file,
            pages: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closeSide = (side: Side) => {
    setSide(side, EMPTY_PANE)
    setReport(null)
    setReportError(null)
    setOverlay(false)
    if (side === "a") setZoomA(1)
    else setZoomB(1)
  }

  // Run the text comparison whenever both files are present.
  React.useEffect(() => {
    if (!a.file || !b.file) return
    let cancelled = false
    setReportLoading(true)
    setReportError(null)
    compareReport(a.file, b.file)
      .then((res) => {
        if (!cancelled) setReport(res)
      })
      .catch((err: unknown) => {
        if (!cancelled) setReportError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [a.file, b.file])

  const mirrorScroll = (from: React.RefObject<HTMLDivElement | null>, to: React.RefObject<HTMLDivElement | null>) => {
    if (!scrollSync || syncing.current) return
    const src = from.current
    const dst = to.current
    if (!src || !dst) return
    const denom = src.scrollHeight - src.clientHeight
    const ratio = denom > 0 ? src.scrollTop / denom : 0
    syncing.current = true
    dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight)
    // Release on the next frame so the mirrored scroll doesn't echo back.
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  const downloadReport = async () => {
    if (!a.file || !b.file) return
    setDownloading(true)
    try {
      const res = await runTool("compare-pdf", [a.file, b.file])
      downloadBlob(res.blob, res.filename)
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  const bothLoaded = Boolean(a.file && b.file)

  const filteredChanges = React.useMemo(() => {
    if (!report) return []
    const q = search.trim().toLowerCase()
    if (!q) return report.changes
    return report.changes.filter(
      (c) => c.old.toLowerCase().includes(q) || c.new.toLowerCase().includes(q),
    )
  }, [report, search])

  // Group filtered changes by page for "Page N" headers.
  const grouped = React.useMemo(() => {
    const map = new Map<number, CompareChange[]>()
    for (const c of filteredChanges) {
      const list = map.get(c.page) ?? []
      list.push(c)
      map.set(c.page, list)
    }
    return [...map.entries()].sort((x, y) => x[0] - y[0])
  }, [filteredChanges])

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setScrollSync((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
            scrollSync
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
          aria-pressed={scrollSync}
        >
          <Columns2 className="size-4" aria-hidden /> {t("compare.scrollSync")}
        </button>
      </div>

      {/* Was `flex` with a fixed 78vh height and no breakpoint anywhere in this
          file: a 320px report aside plus two flex-1 panes cannot fit under
          about 700px, so the page overflowed horizontally. Now it stacks below
          `lg` — panes first, report beneath — and the height only applies once
          the row exists. */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-[78vh] lg:flex-row">
        {/* Viewer */}
        {overlay && a.pages && b.pages ? (
          <div className="flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-muted/30 max-lg:h-[50vh]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <span>{t("compare.overlaid")}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-[2px] bg-black" aria-hidden /> {t("compare.unchanged")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-[2px] bg-rose-500" aria-hidden /> {t("compare.removedLeft")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-[2px] bg-emerald-500" aria-hidden /> {t("compare.addedRight")}
              </span>
            </div>
            <div className="flex-1 overflow-auto bg-muted/40 p-3">
              {Array.from({ length: Math.max(a.pages.length, b.pages.length) }).map((_, i) => (
                <OverlayPage key={i} srcA={a.pages?.[i]?.src} srcB={b.pages?.[i]?.src} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {a.file ? (
              <PdfPane
                side="a"
                state={a}
                zoom={zoomA}
                highlights={report?.highlightsA ?? []}
                onClose={() => closeSide("a")}
                onZoom={(next) => zoomSide("a", next)}
                scrollRef={refA}
                onScroll={() => mirrorScroll(refA, refB)}
              />
            ) : (
              <div className="flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-muted/30 max-lg:h-[50vh]">
                <PaneDropzone onFile={(f) => loadFile("a", f)} />
              </div>
            )}
            {b.file ? (
              <PdfPane
                side="b"
                state={b}
                zoom={zoomB}
                highlights={report?.highlightsB ?? []}
                onClose={() => closeSide("b")}
                onZoom={(next) => zoomSide("b", next)}
                scrollRef={refB}
                onScroll={() => mirrorScroll(refB, refA)}
              />
            ) : (
              <div className="flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-muted/30 max-lg:h-[50vh]">
                <PaneDropzone onFile={(f) => loadFile("b", f)} />
              </div>
            )}
          </>
        )}

        {/* Sidebar */}
        <aside className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card max-lg:max-h-96 lg:w-80 lg:shrink-0">
          <div className="px-4 pb-3 pt-4">
            <h2 className="text-lg font-semibold">{reg.toolTitle(tool)}</h2>
          </div>

          <div className="grid grid-cols-2 gap-2 px-4">
            <button
              type="button"
              onClick={() => setOverlay(false)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium",
                !overlay ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
              aria-pressed={!overlay}
            >
              <Columns2 className="size-4" /> Semantic Text
            </button>
            <button
              type="button"
              onClick={() => setOverlay(true)}
              disabled={!bothLoaded}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium disabled:opacity-50",
                overlay ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
              aria-pressed={overlay}
            >
              <Layers className="size-4" /> Content Overlay
            </button>
          </div>

          <div className="mx-4 mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Compare text changes between two PDFs.
          </div>

          <div className="relative mx-4 mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("compare.searchPlaceholder")}
                  aria-label={t("compare.searchLabel")}
                  type="search"
              className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex-1 overflow-auto px-4 py-3">
            {!bothLoaded ? (
              <p className="text-sm text-muted-foreground">
                Load a PDF in each panel to see the change report.
              </p>
            ) : reportLoading ? (
              <div className="grid gap-2 py-6">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Comparing…
                </span>
                <ProgressBar />
              </div>
            ) : reportError ? (
              <Alert tone="error">{reportError}</Alert>
            ) : (
              <>
                <div className="mb-3 text-sm font-medium">
                  {t("compare.report", { count: filteredChanges.length })}
                </div>
                {grouped.length === 0 ? (
                  // Two different facts, previously one sentence: the files
                  // being identical is a result; a search matching nothing is a
                  // filter the user can widen.
                  <p className="text-sm text-muted-foreground">
                    {search.trim()
                      ? t("compare.noSearchMatch", { query: search.trim() })
                      : t("compare.identical")}
                  </p>
                ) : (
                  grouped.map(([page, list]) => (
                    <div key={page} className="mb-4">
                      <div className="mb-2 text-xs text-muted-foreground">{t("compare.page", { page })}</div>
                      <div className="grid gap-3">
                        {list.map((c, i) => (
                          <ChangeCard key={i} change={c} />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>

          <div className="border-t p-4">
            <Button className="w-full" disabled={!bothLoaded || downloading} onClick={downloadReport}>
              {downloading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Preparing…
                </>
              ) : (
                <>
                  <Download className="size-4" /> Download report
                </>
              )}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
