"use client"

import * as React from "react"
import { ArrowLeft, Download, FileUp, ImagePlus, ImageUp, Loader2, Pencil, RotateCw, Trash2, X } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/dialog"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { exportEditedHtml, extractDocumentHtml, type ExtractedPage } from "@/lib/api"
import { useT, useRegistryText } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "extracting" | "ready" | "error"

// PDF points -> CSS px (96 CSS px per inch, 72 points per inch), clamped to a
// usable on-screen width so a huge/tiny page size doesn't break the layout.
const PT_TO_PX = 96 / 72
const MIN_SHEET_WIDTH_PX = 480
const MAX_SHEET_WIDTH_PX = 1000
const DEFAULT_SHEET_WIDTH_PX = 900
const DEFAULT_SHEET_HEIGHT_PX = 1165 // US Letter aspect at the default width
const PAGE_GAP_PX = 28

function sheetWidthPx(widthPt: number | undefined, positioned: boolean): number {
  if (!widthPt || widthPt <= 0) return DEFAULT_SHEET_WIDTH_PX
  const px = Math.round(widthPt * PT_TO_PX)
  // Positioned pages must match the source exactly (their content's real
  // top/left is in the same pt units, auto-converted by the browser using
  // this same 96/72 ratio) -- clamping here would leave the two mismatched.
  if (positioned) return px
  return Math.min(MAX_SHEET_WIDTH_PX, Math.max(MIN_SHEET_WIDTH_PX, px))
}

function sheetHeightPx(heightPt: number | undefined): number {
  if (!heightPt || heightPt <= 0) return DEFAULT_SHEET_HEIGHT_PX
  return Math.round(heightPt * PT_TO_PX)
}

// Each source page becomes its own non-editable "Page N" label plus a
// correctly-sized editable sheet — built as a single HTML string and set
// imperatively (see the mount effect below) since the editable subtree must
// stay uncontrolled by React.
function buildPagesMarkup(pages: ExtractedPage[]): string {
  const list = pages.length > 0 ? pages : [{ html: "<p><br></p>" }]
  return list
    .map((p, i) => {
      const positioned = p.positioned === true
      const width = sheetWidthPx(p.width_pt, positioned)
      const height = sheetHeightPx(p.height_pt)
      // Positioned pages carry real top/left coordinates matching the source
      // exactly — padding would shift everything relative to those
      // coordinates, and a scrollbar would imply content is missing, when
      // it's guaranteed to fit inside the real page bounds. Flowing pages
      // (pdf2docx/LibreOffice reconstruction, or plain text) keep the padded
      // "document" look, with a scrollbar as a safety net only if
      // reconstructed content ever runs longer than the original page.
      const sheetClass = positioned
        ? "doc-sheet doc-page-sheet rounded-sm border bg-white shadow-lg"
        : "doc-sheet doc-page-sheet rounded-sm border bg-white p-10 text-[15px] leading-relaxed text-neutral-900 shadow-lg sm:p-14"
      // `position:relative` makes this div the anchor for every child's
      // `top`/`left;position:absolute` (set server-side in html_edit.py) —
      // without it, those coordinates resolve against whatever positioned
      // ancestor happens to exist further up the DOM, and content lands in
      // the wrong place or spills outside the page entirely.
      const dataAttrs =
        `${p.width_pt ? ` data-w="${p.width_pt}"` : ""}${p.height_pt ? ` data-h="${p.height_pt}"` : ""}`
      const label =
        `<div contenteditable="false" class="mb-1.5 select-none text-center text-xs font-medium text-muted-foreground">Page ${i + 1} of ${list.length}</div>`
      if (positioned) {
        // A positioned page is rendered at its true pixel size (${width}×${height})
        // so its absolute `pt` coordinates stay exact, then the whole page is
        // uniformly SCALED to fit the panel width (see applyDocScale). Shrinking
        // the sheet via `max-width` instead — as flowing pages do — would resize
        // the box without moving its absolute-positioned children, so right-side
        // content (right-aligned header text, etc.) would overflow/land wrong in
        // a narrow panel like the OS app view. `doc-scale-clip` collapses the
        // post-transform layout height so pages still stack tightly.
        return (
          `<div class="doc-page-wrap" data-sheet-w="${width}" data-sheet-h="${height}" style="margin:0 auto ${PAGE_GAP_PX}px auto;">` +
          label +
          `<div class="doc-scale-clip" style="overflow:hidden;">` +
          `<div class="doc-scale" style="width:${width}px;height:${height}px;transform-origin:top left;">` +
          `<div class="${sheetClass}" data-page-content data-positioned="true"${dataAttrs}` +
          ` style="width:${width}px;height:${height}px;overflow:hidden;position:relative;">` +
          p.html +
          `</div></div></div></div>`
        )
      }
      return (
        `<div style="width:${width}px;max-width:100%;margin:0 auto ${PAGE_GAP_PX}px auto;">` +
        label +
        `<div class="${sheetClass}" data-page-content data-positioned="false"${dataAttrs}` +
        ` style="height:${height}px;overflow-y:auto;">` +
        p.html +
        `</div>` +
        `</div>`
      )
    })
    .join("")
}

/** Shown once the open document is closed: drop a new one in (or pick one)
 *  without leaving the editor — the same shape as the Compare tool's empty
 *  pane. Any file is handed straight to the caller, which reports an
 *  unsupported type the same way it does for the initial upload. */
function DocumentPicker({
  accept,
  busy,
  onFile,
}: {
  accept: string
  busy: boolean
  onFile: (file: File) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const exts = accept.split(",").map((ext) => ext.trim().toLowerCase()).filter(Boolean)

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
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={cn(
        "flex min-h-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border bg-card/40",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.currentTarget.value = ""
        }}
      />
      {busy ? (
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> {t("edit.opening")}
        </span>
      ) : (
        <>
          <FileUp className="size-6" />
          <span>{t("dropzone.dropFile")}</span>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {t("dropzone.selectFiles")}
          </Button>
          <span className="text-xs">{t("dropzone.accepted", { exts: exts.join(", ") })}</span>
        </>
      )}
    </div>
  )
}

export function EditWorkspace({ tool }: { tool: Tool }) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = React.useState<File[]>([])
  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const editorRef = React.useRef<HTMLDivElement>(null)
  const pagesRef = React.useRef<HTMLDivElement>(null)
  const pendingPages = React.useRef<ExtractedPage[] | null>(null)
  // A 0×0 `position:fixed` sentinel pinned to (0,0). The selection overlays are
  // also `position:fixed`, so they share this element's containing block. In
  // `pltt dev` that block IS the viewport and the sentinel sits at (0,0). Inside
  // the OS the app runs under an ancestor with a `transform` (app-window chrome),
  // which makes `position:fixed` resolve against THAT ancestor instead of the
  // viewport — so the sentinel reports the ancestor's on-screen origin. Every
  // overlay subtracts this origin from its viewport-space `getBoundingClientRect`
  // coordinates, so the frame stays glued to the object in BOTH environments.
  const fixedOriginRef = React.useRef<HTMLDivElement>(null)
  const fixedOrigin = (): { ox: number; oy: number } => {
    const r = fixedOriginRef.current?.getBoundingClientRect()
    return { ox: r?.left ?? 0, oy: r?.top ?? 0 }
  }

  // --- Image editing (select an image to delete / replace / resize) ---
  const [selectedImg, setSelectedImg] = React.useState<HTMLImageElement | null>(null)
  // Overlay geometry: the image's UN-rotated on-screen box (x,y,w,h) + rotation,
  // plus its axis-aligned bbox (bx,by) for the (non-rotating) Replace/Delete bar.
  const [imgRect, setImgRect] = React.useState<
    { x: number; y: number; w: number; h: number; rot: number; bx: number; by: number; visible: boolean } | null
  >(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const fileMode = React.useRef<"replace" | "add">("replace")
  // The document was closed (toolbar X) but the editor is still open, showing
  // the picker so another file can be uploaded in its place.
  const [closed, setClosed] = React.useState(false)
  // Closing or leaving throws the edited markup away, so a dirty document asks
  // first; this remembers which of the two to run once it is confirmed.
  const [pendingExit, setPendingExit] = React.useState<"close" | "back" | null>(null)
  const resizeState = React.useRef<{ startX: number; startY: number; wPt: number; pxPerPt: number; aspect: number; rot: number } | null>(null)
  const rotateState = React.useRef<{ cx: number; cy: number; startAngle: number; startRot: number } | null>(null)
  const moveState = React.useRef<{ startX: number; startY: number; leftPt: number; topPt: number; pxPerPt: number } | null>(null)

  // --- Shape editing (a shape is a group of overlapping fill/stroke/text/shadow
  // elements). Selecting one groups them for move / resize / delete. ---
  const [shapeEls, setShapeEls] = React.useState<HTMLElement[]>([])
  const [shapeRect, setShapeRect] = React.useState<{ x: number; y: number; w: number; h: number; visible: boolean } | null>(null)
  const shapeMove = React.useRef<{ startX: number; startY: number; pxPerPt: number; origins: { el: HTMLElement; left: number; top: number }[] } | null>(null)
  const shapeResize = React.useRef<{
    startX: number
    pxPerPt: number
    originLeft: number
    originTop: number
    groupW: number
    items: { el: HTMLElement; left: number; top: number; w: number; h: number; spans: { s: HTMLElement; size: number }[] }[]
  } | null>(null)

  // Move the given elements to the end of their sheet (= on top of everything),
  // so the LAST-selected object always renders over the others.
  const bringToFront = (els: HTMLElement[]) => {
    const ordered = [...els].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    ordered.forEach((el) => el.parentElement?.appendChild(el))
  }

  // Points-per-pixel for the sheet an image lives on (positioned sheets carry
  // their real width in `data-w`); falls back to the 96/72 ratio.
  const sheetPxPerPt = (img: HTMLImageElement): number => {
    const sheet = img.closest<HTMLElement>("[data-page-content]")
    const wpt = sheet ? parseFloat(sheet.dataset.w || "") : NaN
    if (sheet && wpt > 0) return sheet.getBoundingClientRect().width / wpt
    return PT_TO_PX
  }

  const imgRotation = (img: HTMLImageElement): number => parseFloat(img.dataset.rotate || "0") || 0

  const setImgRotation = (img: HTMLImageElement, deg: number): void => {
    img.dataset.rotate = String(deg)
    img.style.transform = deg ? `rotate(${deg}deg)` : ""
    img.style.transformOrigin = "center"
  }

  const refreshImgRect = React.useCallback((img: HTMLImageElement | null) => {
    if (!img) {
      setImgRect(null)
      return
    }
    const sheet = img.closest<HTMLElement>("[data-page-content]")
    const bbox = img.getBoundingClientRect() // rotated → axis-aligned bbox
    const pages = pagesRef.current?.getBoundingClientRect()
    const visible = !pages || (bbox.bottom > pages.top + 4 && bbox.top < pages.bottom - 4)
    const rot = imgRotation(img)
    const wpt = sheet ? parseFloat(sheet.dataset.w || "") : NaN
    // Subtract the fixed containing-block origin so the `position:fixed` overlay
    // lands on the object in the OS iframe (transformed ancestor) too, not only
    // in `pltt dev`. In dev this origin is (0,0), so the math is unchanged there.
    const { ox, oy } = fixedOrigin()
    // A ROTATED image's bbox is its enlarged axis-aligned bounding box, not its
    // real rectangle, so reconstruct the un-rotated box from the image's pt
    // geometry. An UN-rotated image's bbox already IS its exact on-screen box —
    // use it directly. Recomputing pt→px from `sr.width / wpt` assumes the sheet
    // renders at the nominal 96/72 scale, but a positioned sheet is capped by
    // `max-width:100%` (narrow panels/the OS app view render it smaller), so that
    // assumed scale drifts and the frame lands below/beside the object.
    if (rot !== 0 && sheet && wpt > 0 && img.style.left) {
      // Real un-rotated box from the image's pt geometry within its sheet.
      const sr = sheet.getBoundingClientRect()
      const pxPerPt = sr.width / wpt
      setImgRect({
        x: sr.left + parseFloat(img.style.left) * pxPerPt - ox,
        y: sr.top + parseFloat(img.style.top) * pxPerPt - oy,
        w: parseFloat(img.style.width) * pxPerPt,
        h: parseFloat(img.style.height) * pxPerPt,
        rot,
        bx: bbox.left - ox,
        by: bbox.top - oy,
        visible,
      })
    } else {
      setImgRect({ x: bbox.left - ox, y: bbox.top - oy, w: bbox.width, h: bbox.height, rot: 0, bx: bbox.left - ox, by: bbox.top - oy, visible })
    }
  }, [])

  const selectImage = (img: HTMLImageElement | null) => {
    if (img) {
      setShapeEls([])
      setShapeRect(null)
      bringToFront([img]) // last selected renders on top
    }
    setSelectedImg(img)
    refreshImgRect(img)
  }

  const deleteImage = () => {
    if (!selectedImg) return
    selectedImg.remove()
    selectImage(null)
    setDirty(true)
  }

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error("Could not read image"))
      reader.readAsDataURL(file)
    })

  const imageAspect = (dataUrl: string): Promise<number> =>
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1)
      img.onerror = () => resolve(1)
      img.src = dataUrl
    })

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return
    const dataUrl = await readAsDataUrl(file)
    const aspect = await imageAspect(dataUrl)
    if (fileMode.current === "replace" && selectedImg) {
      // Keep position + width; adjust height to the new image's aspect.
      const wPt = parseFloat(selectedImg.style.width) || 120
      selectedImg.src = dataUrl
      selectedImg.style.height = `${(wPt * aspect).toFixed(2)}pt`
      refreshImgRect(selectedImg)
    } else {
      // Add a new image to the currently most-visible page.
      const sheet = mostVisibleSheet()
      if (!sheet) return
      const pageWpt = parseFloat(sheet.dataset.w || "") || 612
      const wPt = Math.min(pageWpt * 0.5, 260)
      const img = document.createElement("img")
      img.src = dataUrl
      img.setAttribute(
        "style",
        `position:absolute;left:36.00pt;top:36.00pt;width:${wPt.toFixed(2)}pt;height:${(wPt * aspect).toFixed(2)}pt;`,
      )
      sheet.appendChild(img)
      selectImage(img)
    }
    setDirty(true)
  }

  const mostVisibleSheet = (): HTMLElement | null => {
    const sheets = editorRef.current?.querySelectorAll<HTMLElement>("[data-page-content]")
    if (!sheets || sheets.length === 0) return null
    const mid = (pagesRef.current?.getBoundingClientRect().top ?? 0) + (pagesRef.current?.clientHeight ?? 0) / 2
    let best = sheets[0]
    let bestDist = Infinity
    sheets.forEach((s) => {
      const r = s.getBoundingClientRect()
      const dist = Math.abs((r.top + r.bottom) / 2 - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = s
      }
    })
    return best
  }

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedImg) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const pxPerPt = sheetPxPerPt(selectedImg)
    const wPt = parseFloat(selectedImg.style.width) || selectedImg.getBoundingClientRect().width / pxPerPt
    const hPt = parseFloat(selectedImg.style.height) || selectedImg.getBoundingClientRect().height / pxPerPt
    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      wPt,
      pxPerPt,
      aspect: wPt > 0 ? hPt / wPt : 1,
      rot: imgRotation(selectedImg),
    }
  }
  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only resize while the button is actually held — a stray move (or a move
    // after the pointer was released outside) must never change the size.
    if (e.buttons !== 1) {
      resizeState.current = null
      return
    }
    const st = resizeState.current
    if (!st || !selectedImg) return
    // Project the screen delta onto the image's local (un-rotated) x-axis.
    const rad = (st.rot * Math.PI) / 180
    const dx = e.clientX - st.startX
    const dy = e.clientY - st.startY
    const localDx = dx * Math.cos(rad) + dy * Math.sin(rad)
    const newW = Math.max(12, st.wPt + localDx / st.pxPerPt)
    selectedImg.style.width = `${newW.toFixed(2)}pt`
    selectedImg.style.height = `${(newW * st.aspect).toFixed(2)}pt`
    refreshImgRect(selectedImg)
  }
  const onResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return
    resizeState.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    setDirty(true)
  }

  const onRotatePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedImg) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = selectedImg.getBoundingClientRect() // bbox center == image center
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    rotateState.current = {
      cx,
      cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
      startRot: imgRotation(selectedImg),
    }
  }
  const onRotatePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) {
      rotateState.current = null
      return
    }
    const st = rotateState.current
    if (!st || !selectedImg) return
    const angle = Math.atan2(e.clientY - st.cy, e.clientX - st.cx)
    let deg = st.startRot + ((angle - st.startAngle) * 180) / Math.PI
    if (e.shiftKey) deg = Math.round(deg / 15) * 15 // hold Shift to snap to 15°
    setImgRotation(selectedImg, Math.round(deg))
    refreshImgRect(selectedImg)
  }
  const onRotatePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rotateState.current) return
    rotateState.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    setDirty(true)
  }

  // Drag inside the image to MOVE it anywhere on the page. Translation is
  // rotation-independent, so the screen delta maps straight onto left/top (pt).
  const onMovePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedImg) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    moveState.current = {
      startX: e.clientX,
      startY: e.clientY,
      leftPt: parseFloat(selectedImg.style.left) || 0,
      topPt: parseFloat(selectedImg.style.top) || 0,
      pxPerPt: sheetPxPerPt(selectedImg),
    }
  }
  const onMovePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) {
      moveState.current = null
      return
    }
    const st = moveState.current
    if (!st || !selectedImg) return
    selectedImg.style.left = `${(st.leftPt + (e.clientX - st.startX) / st.pxPerPt).toFixed(2)}pt`
    selectedImg.style.top = `${(st.topPt + (e.clientY - st.startY) / st.pxPerPt).toFixed(2)}pt`
    refreshImgRect(selectedImg)
  }
  const onMovePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!moveState.current) return
    moveState.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    setDirty(true)
  }

  // ---- Shape group selection / move / resize / delete ----

  const refreshShapeRect = React.useCallback((els: HTMLElement[]) => {
    if (els.length === 0) {
      setShapeRect(null)
      return
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    els.forEach((el) => {
      const r = el.getBoundingClientRect()
      x0 = Math.min(x0, r.left)
      y0 = Math.min(y0, r.top)
      x1 = Math.max(x1, r.right)
      y1 = Math.max(y1, r.bottom)
    })
    const pages = pagesRef.current?.getBoundingClientRect()
    const visible = !pages || (y1 > pages.top + 4 && y0 < pages.bottom - 4)
    // Offset into the fixed containing block so the overlay is glued to the
    // shape inside the OS iframe (transformed ancestor); (0,0) in `pltt dev`.
    const { ox, oy } = fixedOrigin()
    setShapeRect({ x: x0 - ox, y: y0 - oy, w: x1 - x0, h: y1 - y0, visible })
  }, [])

  // A shape is the connected cluster of fills/strokes/shadow/text overlapping
  // the clicked fill — grouped so it moves/resizes/deletes as one object.
  const collectShapeGroup = (start: HTMLElement): HTMLElement[] => {
    const sheet = start.closest<HTMLElement>("[data-page-content]")
    if (!sheet) return [start]
    const sr = sheet.getBoundingClientRect()
    const sheetArea = Math.max(1, sr.width * sr.height)
    const candidates = Array.from(sheet.querySelectorAll<HTMLElement>(".fc-shape, img, p")).filter(
      (el) => !el.classList.contains("fc-shape-bg"),
    )
    const rects = new Map<HTMLElement, DOMRect>()
    candidates.forEach((el) => rects.set(el, el.getBoundingClientRect()))
    const pad = 2
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left <= b.right + pad && b.left <= a.right + pad && a.top <= b.bottom + pad && b.top <= a.bottom + pad
    const group = new Set<HTMLElement>([start])
    const queue: HTMLElement[] = [start]
    while (queue.length) {
      const cur = queue.shift()!
      const cr = rects.get(cur)
      if (!cr) continue
      for (const el of candidates) {
        if (!group.has(el) && overlap(cr, rects.get(el)!)) {
          group.add(el)
          queue.push(el)
        }
      }
    }
    const arr = Array.from(group)
    const gx0 = Math.min(...arr.map((e) => rects.get(e)!.left))
    const gy0 = Math.min(...arr.map((e) => rects.get(e)!.top))
    const gx1 = Math.max(...arr.map((e) => rects.get(e)!.right))
    const gy1 = Math.max(...arr.map((e) => rects.get(e)!.bottom))
    // Guard against a runaway group swallowing (nearly) the whole page.
    if ((gx1 - gx0) * (gy1 - gy0) > 0.85 * sheetArea || arr.length > 600) return [start]
    return arr
  }

  const selectShape = (start: HTMLElement) => {
    const group = collectShapeGroup(start)
    setSelectedImg(null)
    setImgRect(null)
    bringToFront(group) // last selected renders on top
    setShapeEls(group)
    refreshShapeRect(group)
  }

  const clearShape = () => {
    setShapeEls([])
    setShapeRect(null)
  }

  const deleteShape = () => {
    shapeEls.forEach((el) => el.remove())
    clearShape()
    setDirty(true)
  }

  const onShapeMoveDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (shapeEls.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    shapeMove.current = {
      startX: e.clientX,
      startY: e.clientY,
      pxPerPt: sheetPxPerPt(shapeEls[0] as HTMLImageElement),
      origins: shapeEls.map((el) => ({ el, left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 })),
    }
  }
  const onShapeMoveMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) {
      shapeMove.current = null
      return
    }
    const st = shapeMove.current
    if (!st) return
    const dx = (e.clientX - st.startX) / st.pxPerPt
    const dy = (e.clientY - st.startY) / st.pxPerPt
    st.origins.forEach((o) => {
      o.el.style.left = `${(o.left + dx).toFixed(2)}pt`
      o.el.style.top = `${(o.top + dy).toFixed(2)}pt`
    })
    refreshShapeRect(shapeEls)
  }
  const onShapeMoveUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!shapeMove.current) return
    shapeMove.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    setDirty(true)
  }

  const onShapeResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (shapeEls.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const pxPerPt = sheetPxPerPt(shapeEls[0] as HTMLImageElement)
    const items = shapeEls.map((el) => ({
      el,
      left: parseFloat(el.style.left) || 0,
      top: parseFloat(el.style.top) || 0,
      w: parseFloat(el.style.width) || 0,
      h: parseFloat(el.style.height) || 0,
      spans: Array.from(el.querySelectorAll<HTMLElement>("span, font"))
        .map((s) => ({ s, size: parseFloat(s.style.fontSize) || 0 }))
        .filter((x) => x.size > 0),
    }))
    const originLeft = Math.min(...items.map((i) => i.left))
    const originTop = Math.min(...items.map((i) => i.top))
    const groupW = Math.max(...items.map((i) => i.left + i.w)) - originLeft
    shapeResize.current = { startX: e.clientX, pxPerPt, originLeft, originTop, groupW: groupW || 1, items }
  }
  const onShapeResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) {
      shapeResize.current = null
      return
    }
    const st = shapeResize.current
    if (!st) return
    const scale = Math.max(0.1, Math.min(10, (st.groupW + (e.clientX - st.startX) / st.pxPerPt) / st.groupW))
    st.items.forEach((it) => {
      it.el.style.left = `${(st.originLeft + (it.left - st.originLeft) * scale).toFixed(2)}pt`
      it.el.style.top = `${(st.originTop + (it.top - st.originTop) * scale).toFixed(2)}pt`
      if (it.w) it.el.style.width = `${(it.w * scale).toFixed(2)}pt`
      if (it.h) it.el.style.height = `${(it.h * scale).toFixed(2)}pt`
      it.spans.forEach((sp) => {
        sp.s.style.fontSize = `${(sp.size * scale).toFixed(2)}pt`
      })
    })
    refreshShapeRect(shapeEls)
  }
  const onShapeResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!shapeResize.current) return
    shapeResize.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    setDirty(true)
  }

  // Keep the overlays glued to their target while the pages scroll / resize.
  React.useEffect(() => {
    if (!selectedImg && shapeEls.length === 0) return
    const onScrollOrResize = () => {
      if (selectedImg) refreshImgRect(selectedImg)
      if (shapeEls.length) refreshShapeRect(shapeEls)
    }
    const pages = pagesRef.current
    pages?.addEventListener("scroll", onScrollOrResize)
    window.addEventListener("resize", onScrollOrResize)
    return () => {
      pages?.removeEventListener("scroll", onScrollOrResize)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [selectedImg, shapeEls, refreshImgRect, refreshShapeRect])

  const basename = (files[0]?.name ?? "document").replace(/\.[^.]+$/, "")
  // Download in the SAME format the file was uploaded in (pdf→pdf, docx→docx,
  // pptx→pptx, …), defaulting to pdf when the extension is unknown.
  const originalExt = (files[0]?.name.match(/\.([^.]+)$/)?.[1] ?? "pdf").toLowerCase()
  // Nothing can write the legacy binary .hwp, so a .hwp original downloads as
  // .hwpx (which Hancom Office / 한글 opens natively) — see api/core/hwpx_ops.py.
  const downloadExt = originalExt === "hwp" ? "hwpx" : originalExt

  // Scale every positioned page down to fit the current panel width, so its
  // absolute-`pt` content stays faithful (right-aligned text on the right, etc.)
  // no matter how narrow the panel is — the OS app view is much narrower than a
  // full Letter page. Never scales up past 1 (a page never grows beyond its real
  // size). `.doc-scale-clip` is sized to the post-scale height so pages stack
  // without transform-induced gaps.
  const applyDocScale = React.useCallback(() => {
    const root = editorRef.current
    const pages = pagesRef.current
    if (!root || !pages) return
    const cs = window.getComputedStyle(pages)
    const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0")
    const avail = pages.clientWidth - padX
    if (avail <= 0) return
    root.querySelectorAll<HTMLElement>(".doc-page-wrap").forEach((wrap) => {
      const sw = parseFloat(wrap.dataset.sheetW || "")
      const sh = parseFloat(wrap.dataset.sheetH || "")
      const scale = wrap.querySelector<HTMLElement>(".doc-scale")
      const clip = wrap.querySelector<HTMLElement>(".doc-scale-clip")
      if (!sw || !sh || !scale || !clip) return
      const s = Math.min(1, avail / sw)
      scale.style.transform = s < 1 ? `scale(${s})` : ""
      clip.style.height = `${Math.round(sh * s)}px`
      wrap.style.width = `${Math.round(sw * s)}px`
    })
    // The overlay geometry is width-dependent, so keep any active selection glued.
    if (selectedImg) refreshImgRect(selectedImg)
    if (shapeEls.length) refreshShapeRect(shapeEls)
  }, [selectedImg, shapeEls, refreshImgRect, refreshShapeRect])

  // The editable region is uncontrolled: React must never re-render its
  // children or the caret/edits would be lost. Build the per-page markup
  // and set it imperatively, once, right after extraction.
  React.useEffect(() => {
    if (status === "ready" && editorRef.current && pendingPages.current) {
      editorRef.current.innerHTML = buildPagesMarkup(pendingPages.current)
      pendingPages.current = null
      applyDocScale()
    }
  }, [status, applyDocScale])

  // Re-fit the pages whenever the panel resizes (OS window resize, sidebar
  // toggles, dev viewport changes).
  React.useEffect(() => {
    if (status !== "ready") return
    const pages = pagesRef.current
    if (!pages || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => applyDocScale())
    ro.observe(pages)
    return () => ro.disconnect()
  }, [status, applyDocScale])

  const loadFile = async (next: File[]) => {
    setFiles(next)
    setError(null)
    setDirty(false)
    selectImage(null)
    clearShape()
    if (next.length === 0) {
      setStatus("idle")
      return
    }
    setStatus("extracting")
    try {
      const result = await extractDocumentHtml(next[0])
      pendingPages.current = result.pages
      setStatus("ready")
      setClosed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("edit.couldNotOpen"))
      setStatus("error")
    }
  }

  // Toolbar X: close the document but stay in the editor, so another file can
  // be uploaded straight into it.
  const closeDocument = () => {
    pendingPages.current = null
    setClosed(true)
    void loadFile([])
  }

  // Toolbar Back: leave the editor for this tool's upload screen.
  const goBack = () => {
    setClosed(false)
    void loadFile([])
  }

  const requestExit = (kind: "close" | "back") => {
    if (dirty) {
      setPendingExit(kind)
      return
    }
    if (kind === "close") closeDocument()
    else goBack()
  }

  const onDocumentPicked = (file: File) => {
    const allowed = tool.accept
      .split(",")
      .map((ext) => ext.trim().toLowerCase())
      .filter(Boolean)
    if (allowed.length > 0 && !allowed.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setError(t("edit.unsupportedFile", { types: tool.accept }))
      return
    }
    void loadFile([file])
  }

  const doExport = async () => {
    const sheets = editorRef.current?.querySelectorAll<HTMLElement>("[data-page-content]")
    // Wrap each page's edited content with its real size + positioning flag so
    // the backend can rebuild positioned (PDF-sourced) pages coordinate-for-
    // coordinate — keeping tables, cells and ruled lines intact on export.
    const html = sheets
      ? Array.from(sheets)
          .map((el) => {
            const positioned = el.getAttribute("data-positioned") === "true"
            const w = el.getAttribute("data-w")
            const h = el.getAttribute("data-h")
            const style = positioned && w && h
              ? ` style="position:relative;width:${w}pt;height:${h}pt;overflow:hidden;margin:0 auto;"`
              : ""
            const attrs =
              `data-positioned="${positioned}"${w ? ` data-w="${w}"` : ""}${h ? ` data-h="${h}"` : ""}`
            return `<div class="fc-page" ${attrs}${style}>${el.innerHTML}</div>`
          })
          .join("")
      : ""
    if (!html.trim()) return
    setExporting(true)
    setError(null)
    try {
      await exportEditedHtml(html, downloadExt, `${basename}_edited`)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.exportFailed"))
    } finally {
      setExporting(false)
    }
  }

  if (status !== "ready" && !closed) {
    return (
      <div className="w-full max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
            <CardDescription>{reg.toolDescription(tool)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FileDropzone
              accept={tool.accept}
              multiple={false}
              files={files}
              onFilesChange={loadFile}
              disabled={status === "extracting"}
            />
            {/* Opening a document is the longest operation in the app and used
                to show a bare spinner with no progress bar at all. */}
            {status === "extracting" && <BusyPanel label={t("edit.opening")} />}
            {error && <Alert tone="error">{error}</Alert>}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    // A self-contained, viewport-bounded column: the toolbar is a non-scrolling
    // header and ONLY the pages scroll inside it — so the download bar (and the
    // page's "All tools" link above) stay put no matter how long the document
    // is, regardless of which ancestor would otherwise own the scroll.
    <div className="-mx-4 flex flex-col overflow-hidden" style={{ height: "calc(100dvh - 6.5rem)" }}>
      {/* Origin sentinel for the fixed selection overlays — see fixedOriginRef.
          Reports the containing block's on-screen (0,0), which is the viewport
          in dev but a transformed app-window ancestor inside the OS. */}
      <div
        ref={fixedOriginRef}
        aria-hidden
        style={{ position: "fixed", left: 0, top: 0, width: 0, height: 0, pointerEvents: "none" }}
      />
      {/* Toolbar — always visible */}
      <div className="z-30 shrink-0 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <Pencil className="size-4 shrink-0 text-indigo-500" />
            <span className="truncate">{closed ? reg.toolTitle(tool) : files[0]?.name}</span>
            {dirty && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {t("common.edited")}
              </span>
            )}
            {!closed && (
              <button
                type="button"
                onClick={() => requestExit("close")}
                aria-label={t("edit.closeFile")}
                title={t("edit.closeFile")}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!closed && (
              <>
                <Button size="sm" variant="outline" disabled={exporting} onClick={() => { fileMode.current = "add"; fileInputRef.current?.click() }}>
                  <ImagePlus className="size-4" /> Add image
                </Button>
                <Button size="sm" disabled={exporting} onClick={doExport}>
                  {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Download {downloadExt.toUpperCase()}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={exporting} onClick={() => requestExit("back")}>
              <ArrowLeft className="size-4" /> {t("common.back")}
            </Button>
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0])
          e.currentTarget.value = ""
        }}
      />

      <ConfirmDialog
        open={pendingExit !== null}
        onOpenChange={(open) => {
          if (!open) setPendingExit(null)
        }}
        title={t("edit.discardTitle")}
        description={t("edit.discardBody")}
        confirmLabel={t("edit.discardConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (pendingExit === "close") closeDocument()
          else goBack()
        }}
      />

      {/* Document canvas — the only scrolling region; each source page is its
          own separate, real-sized sheet, like a PDF/Word page view. Clicking an
          image selects it (delete / replace / resize via the overlay below). */}
      <div
        ref={pagesRef}
        className="flex-1 overflow-y-auto bg-muted/60 px-4 py-8"
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.tagName === "IMG") {
            selectImage(target as HTMLImageElement)
          } else if (target.classList.contains("fc-shape")) {
            selectShape(target)
          } else {
            // Text or empty space: drop any selection; if it's text, still bring
            // that paragraph to the front (last selected on top).
            selectImage(null)
            clearShape()
            const para = target.closest("p")
            if (para && getComputedStyle(para).position === "absolute") bringToFront([para as HTMLElement])
          }
        }}
      >
        {closed ? (
          <DocumentPicker
            accept={tool.accept}
            busy={status === "extracting"}
            onFile={onDocumentPicked}
          />
        ) : (
          <>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck
              role="textbox"
              aria-multiline="true"
              aria-label="Document editor"
              onInput={() => setDirty(true)}
              className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-6 text-center text-xs text-muted-foreground">{t("edit.note")}</p>
          </>
        )}
      </div>

      {/* Floating controls for the selected image (fixed, tracks the image). */}
      {selectedImg && imgRect && imgRect.visible && (
        <>
          {/* Rotated frame: outline + resize handles + rotate handle, rotated
              with the image so the box hugs it (like PowerPoint). */}
          <div
            data-img-overlay
            className="pointer-events-none fixed z-50"
            style={{
              left: imgRect.x,
              top: imgRect.y,
              width: imgRect.w,
              height: imgRect.h,
              transform: `rotate(${imgRect.rot}deg)`,
              transformOrigin: "center",
            }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-sm border-2 border-primary" />
            {/* Move layer — hold anywhere inside the image and drag to move it. */}
            <div
              aria-label="Move image"
              onPointerDown={onMovePointerDown}
              onPointerMove={onMovePointerMove}
              onPointerUp={onMovePointerUp}
              onPointerCancel={onMovePointerUp}
              className="pointer-events-auto absolute inset-0 touch-none"
              style={{ cursor: "move" }}
            />
            {/* Resize handles — top-right and bottom-right corners. */}
            {[
              { left: "100%", top: "0%", cursor: "nesw-resize" },
              { left: "100%", top: "100%", cursor: "nwse-resize" },
            ].map((h, i) => (
              <div
                key={i}
                role="slider"
                aria-label="Resize image"
                tabIndex={0}
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
                className="pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-primary shadow"
                style={{ left: h.left, top: h.top, cursor: h.cursor }}
              />
            ))}
            {/* Rotate handle above the top-center. */}
            <div
              role="slider"
              aria-label="Rotate image"
              tabIndex={0}
              onPointerDown={onRotatePointerDown}
              onPointerMove={onRotatePointerMove}
              onPointerUp={onRotatePointerUp}
              onPointerCancel={onRotatePointerUp}
              className="pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow"
              style={{ left: "50%", top: -28, cursor: "grab" }}
            >
              <RotateCw className="size-3" />
            </div>
          </div>
          {/* Replace / Delete bar — axis-aligned (never rotates), above the
              image's bounding box. */}
          <div
            data-img-overlay
            className="fixed z-40 flex items-center gap-1 rounded-md border bg-background p-1 shadow-lg"
            style={{ left: imgRect.bx, top: Math.max(6, imgRect.by - 42) }}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                fileMode.current = "replace"
                fileInputRef.current?.click()
              }}
            >
              <ImageUp className="size-4" /> Replace
            </Button>
            <Button size="sm" variant="outline" onClick={deleteImage}>
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
        </>
      )}

      {/* Selected-shape overlay: move (drag inside), resize (corner), delete. */}
      {shapeEls.length > 0 && shapeRect && shapeRect.visible && (
        <>
          <div
            data-img-overlay
            className="fixed z-50"
            style={{ left: shapeRect.x, top: shapeRect.y, width: shapeRect.w, height: shapeRect.h }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-sm border-2 border-primary" />
            <div
              aria-label="Move shape"
              onPointerDown={onShapeMoveDown}
              onPointerMove={onShapeMoveMove}
              onPointerUp={onShapeMoveUp}
              onPointerCancel={onShapeMoveUp}
              className="pointer-events-auto absolute inset-0 touch-none"
              style={{ cursor: "move" }}
            />
            {[
              { left: "100%", top: "0%", cursor: "nesw-resize" },
              { left: "100%", top: "100%", cursor: "nwse-resize" },
            ].map((h, i) => (
              <div
                key={i}
                role="slider"
                aria-label="Resize shape"
                tabIndex={0}
                onPointerDown={onShapeResizeDown}
                onPointerMove={onShapeResizeMove}
                onPointerUp={onShapeResizeUp}
                onPointerCancel={onShapeResizeUp}
                className="pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-primary shadow"
                style={{ left: h.left, top: h.top, cursor: h.cursor }}
              />
            ))}
          </div>
          <div
            data-img-overlay
            className="fixed z-40 flex items-center gap-1 rounded-md border bg-background p-1 shadow-lg"
            style={{ left: shapeRect.x, top: Math.max(6, shapeRect.y - 42) }}
          >
            <Button size="sm" variant="outline" onClick={deleteShape}>
              <Trash2 className="size-4" /> Delete shape
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
