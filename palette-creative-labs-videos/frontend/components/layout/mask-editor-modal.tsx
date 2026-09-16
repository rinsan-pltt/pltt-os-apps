"use client"

import React from "react"
import { createPortal } from "react-dom"
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBrush,
  IconEraser,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { usePlttCreativeVideoPortalContainer } from "@/components/ui/app-portal"
import { cn } from "@/lib/utils"

// A mask editor for the image being edited. Paint (or erase) a mask over the
// image, with undo / redo / clear, then Save to hand back TWO PNG data URLs:
//  - `preview`: the styled overlay (50% blue fill + outline) for showing the
//    mask on top of the staged image in the chat panel.
//  - `mask`: the actual model mask at the image's full resolution — WHITE
//    where the user painted (the area the model may edit) on an opaque BLACK
//    background (the area to preserve).
// Portaled to the plugin root so the fixed overlay isn't re-scoped by
// the OS sandbox wrapper (mirrors the reference-image viewer in control-panel).

// Mask is painted as a solid silhouette on an offscreen canvas, then rendered
// to the visible canvas as a 50% fill plus an outline ring around the region.
const FILL_COLOR = "#60a5fa" // blue-400
const BORDER_COLOR = "#bfdbfe" // blue-200 — light outline
const FILL_ALPHA = 0.5
const BORDER_PX = 3 // outline thickness in canvas pixels
const OUTLINE_STAMPS = 16 // silhouette copies dilated around a circle

type Tool = "brush" | "erase"
type Point = { x: number; y: number }

export type MaskSaveResult = {
  // Styled overlay (fill + outline) for previewing the mask on the staged image.
  preview: string
  // True mask PNG: white = editable area, black = preserved area.
  mask: string
}

export function MaskEditorModal({
  imageUrl,
  initialMask,
  onSave,
  onCancel,
}: {
  imageUrl: string
  // A previously saved mask PNG (white = editable on black) for this image —
  // loaded onto the canvas so reopening the editor continues from the saved
  // mask instead of starting blank. Undo/Clear can still remove it.
  initialMask?: string | null
  onSave: (result: MaskSaveResult) => void
  onCancel: () => void
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)
  const drawingRef = React.useRef(false)
  const lastPointRef = React.useRef<Point | null>(null)

  const [tool, setTool] = React.useState<Tool>("brush")
  const [brushSize, setBrushSize] = React.useState(36)
  const [ready, setReady] = React.useState(false)

  // The app's themed portal container (inside AppThemeRoot) — render target so
  // the modal inherits the theme variables (see the `host` resolution below).
  const portalContainer = usePlttCreativeVideoPortalContainer()

  // The stage's available size and the image's natural size drive a computed
  // "contain" box so the image keeps its exact aspect within the fixed modal
  // dimensions, and the mask canvas overlays it precisely.
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = React.useState({ w: 0, h: 0 })
  const [nat, setNat] = React.useState({ w: 0, h: 0 })

  // Offscreen canvases: `shape` holds the painted mask silhouette (solid white);
  // tmpA/tmpB are scratch buffers used to recolor + outline it on render.
  const shapeRef = React.useRef<HTMLCanvasElement | null>(null)
  const tmpARef = React.useRef<HTMLCanvasElement | null>(null)
  const tmpBRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)

  // Undo/redo: snapshots live in a ref; `idx` (state) drives re-render + the
  // apply effect. idx === -1 is the blank mask. Committing sets skipApplyRef so
  // the just-drawn canvas isn't redundantly repainted.
  const historyRef = React.useRef<ImageData[]>([])
  const [idx, setIdx] = React.useState(-1)
  const skipApplyRef = React.useRef(false)

  const canUndo = idx >= 0
  const canRedo = idx < historyRef.current.length - 1

  const shapeCtx = () => shapeRef.current?.getContext("2d") ?? null

  // Composite the shape silhouette onto the visible canvas: a 50% fill plus an
  // outline ring (dilate the silhouette in the border color, then punch out the
  // interior so only the edge remains).
  const render = React.useCallback(() => {
    const c = canvasRef.current
    const g = c?.getContext("2d")
    const shape = shapeRef.current
    const a = tmpARef.current
    const b = tmpBRef.current
    if (!c || !g || !shape || !a || !b) return
    const w = c.width
    const h = c.height
    g.clearRect(0, 0, w, h)

    // Fill: recolor the silhouette, draw it at 50% opacity.
    const ag = a.getContext("2d")!
    ag.clearRect(0, 0, w, h)
    ag.globalCompositeOperation = "source-over"
    ag.drawImage(shape, 0, 0)
    ag.globalCompositeOperation = "source-in"
    ag.fillStyle = FILL_COLOR
    ag.fillRect(0, 0, w, h)
    g.globalAlpha = FILL_ALPHA
    g.drawImage(a, 0, 0)
    g.globalAlpha = 1

    // Outline: dilate the silhouette in the border color, then remove the
    // original area to leave a ring.
    const bg = b.getContext("2d")!
    bg.clearRect(0, 0, w, h)
    bg.globalCompositeOperation = "source-over"
    for (let i = 0; i < OUTLINE_STAMPS; i++) {
      const ang = (Math.PI * 2 * i) / OUTLINE_STAMPS
      bg.drawImage(shape, Math.cos(ang) * BORDER_PX, Math.sin(ang) * BORDER_PX)
    }
    bg.globalCompositeOperation = "source-in"
    bg.fillStyle = BORDER_COLOR
    bg.fillRect(0, 0, w, h)
    bg.globalCompositeOperation = "destination-out"
    bg.drawImage(shape, 0, 0)
    g.drawImage(b, 0, 0)
  }, [])

  const scheduleRender = React.useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      render()
    })
  }, [render])

  // Apply a shape snapshot on undo/redo (not after a commit), then re-render.
  React.useEffect(() => {
    if (skipApplyRef.current) {
      skipApplyRef.current = false
      return
    }
    const shape = shapeRef.current
    const sg = shape?.getContext("2d")
    if (!shape || !sg) return
    sg.clearRect(0, 0, shape.width, shape.height)
    const snap = historyRef.current[idx]
    if (snap) sg.putImageData(snap, 0, 0)
    render()
  }, [idx, render])

  const commit = React.useCallback(() => {
    const shape = shapeRef.current
    const sg = shape?.getContext("2d")
    if (!shape || !sg) return
    const snap = sg.getImageData(0, 0, shape.width, shape.height)
    historyRef.current = historyRef.current.slice(0, idx + 1)
    historyRef.current.push(snap)
    skipApplyRef.current = true
    setIdx(historyRef.current.length - 1)
  }, [idx])

  const onImageLoad = () => {
    const img = imgRef.current
    const c = canvasRef.current
    if (!img || !c) return
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    c.width = w
    c.height = h
    // (Re)create the offscreen buffers at the image's resolution.
    for (const ref of [shapeRef, tmpARef, tmpBRef]) {
      if (!ref.current) ref.current = document.createElement("canvas")
      ref.current.width = w
      ref.current.height = h
      ref.current.getContext("2d")?.clearRect(0, 0, w, h)
    }
    setNat({ w, h })
    historyRef.current = []
    setIdx(-1)
    setReady(true)
    render()

    // Seed the canvas with the previously saved mask, if any. The saved mask
    // is opaque white-on-black; the editor's silhouette needs alpha instead —
    // convert luminance → alpha (white stays solid white, black becomes
    // transparent). Pushed as the first history entry so Undo/Clear works.
    if (initialMask) {
      const maskImg = new Image()
      maskImg.onload = () => {
        const shape = shapeRef.current
        const sg = shape?.getContext("2d")
        if (!shape || !sg) return
        sg.clearRect(0, 0, shape.width, shape.height)
        sg.drawImage(maskImg, 0, 0, shape.width, shape.height)
        const d = sg.getImageData(0, 0, shape.width, shape.height)
        const px = d.data
        for (let i = 0; i < px.length; i += 4) {
          const lum = px[i] // grayscale mask — red channel is the luminance
          px[i] = 255
          px[i + 1] = 255
          px[i + 2] = 255
          px[i + 3] = lum
        }
        sg.putImageData(d, 0, 0)
        // Seed history directly (not via commit) — this runs from an async
        // image decode, where commit's captured `idx` could be stale.
        historyRef.current = [sg.getImageData(0, 0, shape.width, shape.height)]
        skipApplyRef.current = true
        setIdx(0)
        render()
      }
      maskImg.src = initialMask
    }
  }

  // Cursor: a circle whose diameter equals the brush size (in screen pixels,
  // matching the painted stroke's on-screen footprint). Drawn as an SVG data
  // URL with a white ring over a darker ring so it reads on any image. The
  // hotspot is the circle's center. Browsers cap custom cursors at 128px —
  // the brush slider tops out at 120, within the cap.
  const brushCursor = React.useMemo(() => {
    const s = Math.max(brushSize, 4)
    const half = s / 2
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">` +
      `<circle cx="${half}" cy="${half}" r="${Math.max(half - 1.5, 1)}" fill="none" stroke="rgba(0,0,0,0.8)" stroke-width="2.5"/>` +
      `<circle cx="${half}" cy="${half}" r="${Math.max(half - 1.5, 1)}" fill="none" stroke="#fff" stroke-width="1.25"/>` +
      `</svg>`
    return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') ${half} ${half}, crosshair`
  }, [brushSize])

  // Map a pointer event to canvas-pixel coordinates + brush radius. `inside`
  // reports whether the pointer is actually over the image (the canvas exactly
  // overlays it) — used to refuse strokes that begin in the letterbox margins
  // and to clamp a captured drag that wanders outside, so the mask can only be
  // painted on the image, never in the surrounding box.
  const toCanvas = (
    e: React.PointerEvent,
  ): { p: Point; radius: number; inside: boolean } | null => {
    const c = canvasRef.current
    if (!c) return null
    const rect = c.getBoundingClientRect()
    const sx = c.width / rect.width
    const sy = c.height / rect.height
    const x = (e.clientX - rect.left) * sx
    const y = (e.clientY - rect.top) * sy
    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    return {
      // Clamp into the image so a drag that leaves the image paints up to the
      // edge rather than stopping short or escaping it.
      p: {
        x: Math.max(0, Math.min(c.width, x)),
        y: Math.max(0, Math.min(c.height, y)),
      },
      radius: (brushSize / 2) * sx,
      inside,
    }
  }

  const stroke = (from: Point | null, to: Point, radius: number) => {
    const g = shapeCtx()
    if (!g) return
    // Paint the mask silhouette as solid white; erase removes coverage.
    g.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over"
    g.strokeStyle = "#fff"
    g.fillStyle = "#fff"
    g.lineCap = "round"
    g.lineJoin = "round"
    g.lineWidth = radius * 2
    g.beginPath()
    g.arc(to.x, to.y, radius, 0, Math.PI * 2)
    g.fill()
    if (from) {
      g.beginPath()
      g.moveTo(from.x, from.y)
      g.lineTo(to.x, to.y)
      g.stroke()
    }
    g.globalCompositeOperation = "source-over"
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const m = toCanvas(e)
    // Only begin a stroke when the press lands on the image itself — never in
    // the surrounding letterbox.
    if (!m || !m.inside) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastPointRef.current = m.p
    stroke(null, m.p, m.radius)
    scheduleRender()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const m = toCanvas(e)
    if (!m) return
    stroke(lastPointRef.current, m.p, m.radius)
    lastPointRef.current = m.p
    scheduleRender()
  }

  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    render()
    commit()
  }

  const undo = () => {
    if (idx >= 0) setIdx(idx - 1)
  }
  const redo = () => {
    if (idx < historyRef.current.length - 1) setIdx(idx + 1)
  }
  const clearMask = () => {
    const shape = shapeRef.current
    const sg = shape?.getContext("2d")
    if (!shape || !sg) return
    sg.clearRect(0, 0, shape.width, shape.height)
    render()
    commit()
  }

  const save = () => {
    const c = canvasRef.current
    const shape = shapeRef.current
    if (!c || !shape) {
      onCancel()
      return
    }
    render() // ensure the outline is drawn (not just the live fill)
    // The model mask: the painted silhouette (already solid white) composited
    // onto an opaque black background at the image's natural resolution —
    // white = editable, black = preserved.
    const m = document.createElement("canvas")
    m.width = shape.width
    m.height = shape.height
    const mg = m.getContext("2d")!
    mg.fillStyle = "#000"
    mg.fillRect(0, 0, m.width, m.height)
    mg.drawImage(shape, 0, 0)
    onSave({
      preview: c.toDataURL("image/png"),
      mask: m.toDataURL("image/png"),
    })
  }

  // Escape cancels.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  // Track the stage's available content size so the contain box can be computed.
  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStageSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Contain the image within the stage (minus padding) at its exact aspect.
  const STAGE_PAD = 24
  const availW = Math.max(0, stageSize.w - STAGE_PAD)
  const availH = Math.max(0, stageSize.h - STAGE_PAD)
  const fitScale =
    nat.w && nat.h && availW && availH ? Math.min(availW / nat.w, availH / nat.h) : 0
  const dispW = fitScale ? Math.round(nat.w * fitScale) : undefined
  const dispH = fitScale ? Math.round(nat.h * fitScale) : undefined

  // Portal into the app's THEMED portal container (inside AppThemeRoot). The
  // plugin's CSS — including the `:root`/`.dark` theme variables — is scoped to
  // the plugin root, so portaling to the OS sandbox wrapper
  // (`[data-palette-plugin-root]`, which is OUTSIDE that scope) left
  // `bg-background` with no variable to resolve → black in both light and dark.
  // The themed container is within the scope and under the theme class, so the
  // modal now tracks light/dark like the rest of the app.
  const host =
    portalContainer ??
    (typeof document !== "undefined"
      ? ((document.querySelector("[data-pltt-creative-video-portal-root]") as HTMLElement | null) ??
        (document.querySelector("[data-pltt-creative-video-root]") as HTMLElement | null) ??
        (document.querySelector("[data-palette-plugin-root]") as HTMLElement | null) ??
        document.body)
      : null)
  if (!host) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] font-mono text-muted-foreground flex items-center justify-center bg-black/10 backdrop-blur-sm p-6"
    >
      <div
        className="flex flex-col w-full max-w-[1400px] h-full max-h-[800px] bg-background border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header: label pinned left, close pinned right, all editor tools
            centered between them. */}
        <div className="relative flex items-center justify-center gap-2 px-3 py-2 border-b border-border50">
          <span className="absolute left-3 text-xs font-semibold tracking-widest uppercase text-muted-foreground">
            Mask Editor
          </span>

          {/* Centered editor tools */}
          <div className="flex items-center gap-2">
            <div className="flex items-center">
              <Button
                type="button"
                size="xs"
                variant={tool === "brush" ? "default" : "outline"}
                className="[&:not(:first-child)]:-ml-px"
                onClick={() => setTool("brush")}
                title="Brush"
              >
                <IconBrush />
              </Button>
              <Button
                type="button"
                size="xs"
                variant={tool === "erase" ? "default" : "outline"}
                className="[&:not(:first-child)]:-ml-px"
                onClick={() => setTool("erase")}
                title="Erase"
              >
                <IconEraser />
              </Button>
            </div>
            <div className="w-24">
              <Slider
                min={8}
                max={120}
                step={1}
                value={[brushSize]}
                onValueChange={(v) => setBrushSize(v[0] ?? brushSize)}
                title="Brush size"
              />
            </div>
            <div className="flex items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon" onClick={undo} disabled={!canUndo} title="Undo">
                <IconArrowBackUp />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={redo} disabled={!canRedo} title="Redo">
                <IconArrowForwardUp />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={clearMask} disabled={idx < 0} title="Clear mask">
                <IconTrash />
              </Button>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="iconSm"
            className="absolute right-3"
            onClick={onCancel}
            title="Close"
          >
            <IconX />
          </Button>
        </div>

        {/* Body: the stage sizes to the image's exact aspect ratio (the wrapper
            shrinks to the image); the canvas tracks the image exactly. */}
        <div
          ref={stageRef}
          className="flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-background p-3"
        >
          <div className="relative leading-none" style={{ width: dispW, height: dispH }}>
            <img
              ref={imgRef}
              src={imageUrl}
              alt=""
              onLoad={onImageLoad}
              draggable={false}
              className="block w-full h-full select-none"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ cursor: brushCursor }}
              className={cn(
                "absolute inset-0 w-full h-full touch-none",
                !ready && "pointer-events-none",
              )}
            />
          </div>
        </div>

        {/* Footer: Cancel / Save */}
        <div className="flex items-center justify-end gap-2 px-3 py-3 border-t border-border50">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="default" size="sm" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>,
    host,
  )
}
