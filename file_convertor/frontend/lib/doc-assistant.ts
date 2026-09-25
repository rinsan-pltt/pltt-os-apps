/**
 * The editor's side of the AI assistant.
 *
 * `buildOutline` turns the live document into a numbered outline — one entry
 * per line, paragraph, heading or cell, each tagged in the DOM with a
 * `data-ai-id` — which is all the model ever sees. The model answers with
 * operations from a fixed vocabulary (validated by backend/api/core/
 * assistant.py), and `applyOperations` performs them on the same DOM with the
 * same mechanisms the toolbox uses: `execCommand` with CSS styling for text,
 * the `<td>`'s own style for spreadsheet cells. Nothing here writes HTML the
 * model produced.
 *
 * Export constraint worth knowing: on positioned (PDF-style) pages the export
 * keeps only a line's INNER markup, so every style lands on inner spans —
 * which is what `execCommand` with `styleWithCSS` produces.
 */

import type { AssistantOperation, AssistantTextStyle } from "@/lib/api"

export interface OutlineBlock {
  id: string
  page: number
  line: number
  para: number
  kind: "heading" | "paragraph" | "list-item" | "cell" | "line"
  text: string
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  align?: string
  /** Where the line sits on its page, in % of the page — "bottom right". */
  x?: number
  y?: number
  /** Inside the user's current selection / holds the caret. */
  selected?: boolean
  cursor?: boolean
}

/** An image, or a drawn shape (signature boxes, stamps, fills) — things that
 *  are not text lines but can still be selected and deleted. */
export interface OutlineObject {
  id: string
  page: number
  kind: "image" | "shape"
  /** Bounding box in % of the page: left, top, right, bottom. */
  box: [number, number, number, number]
  text?: string
  selected?: boolean
}

/** What the user has selected in the document right now. */
export interface EditorSelection {
  range: Range | null
  /** A clicked image or shape group — takes precedence over `range`. */
  objects: HTMLElement[]
}

export interface OutlineCell {
  sheet: string
  ref: string
  value: string
  formula?: string
  bold?: boolean
  color?: string
  fill?: string
  selected?: boolean
}

export interface Outline {
  kind: "document" | "sheet"
  layout: "positioned" | "flowing"
  blocks: OutlineBlock[]
  cells: OutlineCell[]
  objects: OutlineObject[]
  /** The selected text itself, when the selection is text. */
  selection: string
}

export const AI_ID = "data-ai-id"
/** Objects get their own attribute: a shape group includes text lines that
 *  already carry a block id, and one element cannot hold two ids in one. */
export const AI_OBJ = "data-ai-obj"

// ------------------------------------------------------------------ helpers

function pages(editor: HTMLElement): HTMLElement[] {
  return Array.from(editor.querySelectorAll<HTMLElement>("[data-page-content]"))
}

function isEditableText(el: Element): boolean {
  return !el.closest('[contenteditable="false"]')
}

function textNodes(el: Node): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

function toHex(color: string): string | undefined {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/)
  if (!m) return undefined
  if (m[4] !== undefined && Number(m[4]) === 0) return undefined
  return "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")
}

const round = (n: number) => Math.round(n * 2) / 2

/** Style facts about a block, read from the text that dominates it. */
function describe(el: HTMLElement) {
  const nodes = textNodes(el).filter((n) => n.data.trim())
  let size = 0
  let main: Text | null = null
  for (const n of nodes) {
    const px = parseFloat(getComputedStyle(n.parentElement ?? el).fontSize) || 0
    size = Math.max(size, px * 0.75)
    if (!main || n.data.length > main.data.length) main = n
  }
  const host = main?.parentElement ?? el
  const style = getComputedStyle(host)
  // `text-decoration` is not inherited in computed style: an underline set on
  // a <u> or span above the text only shows on that ancestor.
  let underline = false
  for (let a: HTMLElement | null = host; a && a !== el.parentElement; a = a.parentElement) {
    if (getComputedStyle(a).textDecorationLine.includes("underline")) underline = true
  }
  const color = toHex(style.color)
  return {
    size: size ? round(size) : undefined,
    bold: Number(style.fontWeight) >= 600 || undefined,
    italic: style.fontStyle === "italic" || undefined,
    underline: underline || undefined,
    color: color && color !== "#000000" ? color : undefined,
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// ------------------------------------------------------------------ outline

function liveRange(selection: EditorSelection | undefined, editor: HTMLElement): Range | null {
  const range = selection?.range
  if (!range || selection?.objects.length) return null
  return editor.contains(range.commonAncestorContainer) ? range : null
}

function inRange(range: Range | null, el: Element): { selected?: boolean; cursor?: boolean } {
  if (!range) return {}
  if (range.collapsed) return el.contains(range.startContainer) ? { cursor: true } : {}
  return range.intersectsNode(el) ? { selected: true } : {}
}

const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)))

/** Number every addressable block and describe the document for the model. */
export function buildOutline(editor: HTMLElement, isSheet: boolean, selection?: EditorSelection): Outline {
  editor.querySelectorAll(`[${AI_ID}]`).forEach((el) => el.removeAttribute(AI_ID))
  editor.querySelectorAll(`[${AI_OBJ}]`).forEach((el) => el.removeAttribute(AI_OBJ))
  const range = liveRange(selection, editor)
  const selectedText = range && !range.collapsed ? range.toString().replace(/\s+/g, " ").trim().slice(0, 2000) : ""

  if (isSheet) {
    const cells: OutlineCell[] = []
    for (const page of pages(editor)) {
      const sheet = page.getAttribute("data-sheet-name") || "Sheet1"
      page.querySelectorAll<HTMLTableCellElement>("td[data-cell]").forEach((td) => {
        const value = (td.textContent ?? "").trim()
        if (!value) return
        const style = td.style
        cells.push({
          sheet,
          ref: td.getAttribute("data-cell") ?? "",
          value,
          formula: td.getAttribute("data-t") === "f" ? td.getAttribute("data-v") ?? undefined : undefined,
          bold: Number(style.fontWeight) >= 600 || style.fontWeight === "bold" || undefined,
          color: style.color ? toHex(style.color) ?? style.color : undefined,
          fill: style.backgroundColor ? toHex(style.backgroundColor) ?? style.backgroundColor : undefined,
          ...(inRange(range, td).selected || inRange(range, td).cursor ? { selected: true } : {}),
        })
      })
    }
    return { kind: "sheet", layout: "flowing", blocks: [], cells, objects: [], selection: selectedText }
  }

  const blocks: OutlineBlock[] = []
  const objects: OutlineObject[] = []
  const chosen = new Set(selection?.objects ?? [])
  let nextObj = 1
  let positionedDoc = false
  let line = 0
  let para = 0
  let next = 1

  pages(editor).forEach((page, pageIndex) => {
    const positioned = page.getAttribute("data-positioned") === "true"
    positionedDoc ||= positioned
    const candidates = positioned
      ? Array.from(page.querySelectorAll<HTMLElement>("p"))
      : Array.from(page.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,td,th")).filter(
          // The innermost block only: a <p> inside a <li> is the entry, not both.
          (el) => !el.querySelector("h1,h2,h3,h4,h5,h6,p,li,td,th"),
        )
    const entries = candidates
      .filter((el) => isEditableText(el) && (el.textContent ?? "").trim())
      .map((el) => ({ el, info: describe(el) }))
    const typical = median(entries.map((e) => e.info.size ?? 0).filter(Boolean))

    const pageRect = page.getBoundingClientRect()
    const where = (r: DOMRect): [number, number, number, number] => [
      pct(((r.left - pageRect.left) / (pageRect.width || 1)) * 100),
      pct(((r.top - pageRect.top) / (pageRect.height || 1)) * 100),
      pct(((r.right - pageRect.left) / (pageRect.width || 1)) * 100),
      pct(((r.bottom - pageRect.top) / (pageRect.height || 1)) * 100),
    ]

    // Every image, plus the shape group the user clicked (shapes are listed
    // only when selected — a page can hold hundreds of fills and rules).
    page.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      if (!isEditableText(img)) return
      const id = `o${nextObj++}`
      img.setAttribute(AI_OBJ, id)
      objects.push({
        id,
        page: pageIndex + 1,
        kind: "image",
        box: where(img.getBoundingClientRect()),
        text: img.alt || undefined,
        ...(chosen.has(img) ? { selected: true } : {}),
      })
    })
    const shapes = (selection?.objects ?? []).filter((el) => page.contains(el) && el.tagName !== "IMG")
    if (shapes.length > 0) {
      const id = `o${nextObj++}`
      shapes.forEach((el) => el.setAttribute(AI_OBJ, id))
      const rects = shapes.map((el) => el.getBoundingClientRect())
      const box = new DOMRect(
        Math.min(...rects.map((r) => r.left)),
        Math.min(...rects.map((r) => r.top)),
        Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)),
        Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)),
      )
      const text = shapes.map((el) => (el.tagName === "P" ? el.textContent ?? "" : "")).join(" ").replace(/\s+/g, " ").trim()
      objects.push({ id, page: pageIndex + 1, kind: "shape", box: where(box), text: text || undefined, selected: true })
    }

    let prevTop = -Infinity
    let prevSize = 0
    let prevHeading = false
    for (const { el, info } of entries) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim()
      const tag = el.tagName.toLowerCase()
      let kind: OutlineBlock["kind"]
      if (positioned) {
        const big = !!info.size && !!typical && info.size >= typical * 1.2
        kind = big || (info.bold && text.length <= 80 && (info.size ?? 0) >= typical) ? "heading" : "line"
        // Lines close together form a paragraph; a heading, or a gap wider
        // than ~1.6 line heights, starts a new one.
        const top = parseFloat(el.style.top) || 0
        const lineHeight = (prevSize || info.size || 11) * 1.2
        if (kind === "heading" || prevHeading || top - prevTop > lineHeight * 1.6 || top < prevTop) para++
        prevTop = top
        prevSize = info.size ?? prevSize
        prevHeading = kind === "heading"
      } else {
        kind = /^h[1-6]$/.test(tag) ? "heading" : tag === "li" ? "list-item" : tag === "td" || tag === "th" ? "cell" : "paragraph"
        para++
      }
      line++
      const id = `b${next++}`
      el.setAttribute(AI_ID, id)
      const align = positioned ? undefined : getComputedStyle(el).textAlign.replace("start", "left")
      const [bx, by] = positioned ? where(el.getBoundingClientRect()) : []
      blocks.push({
        id,
        page: pageIndex + 1,
        line,
        para,
        kind,
        text: text.slice(0, 1200),
        ...info,
        align: align && align !== "left" ? align : undefined,
        x: bx,
        y: by,
        ...inRange(range, el),
        ...(chosen.has(el) ? { selected: true } : {}),
      })
    }
  })

  return {
    kind: "document",
    layout: positionedDoc ? "positioned" : "flowing",
    blocks,
    cells: [],
    objects,
    selection: selectedText,
  }
}

// -------------------------------------------------------------- operations

export interface ApplyResult {
  applied: number
  skipped: string[]
}

function selectContents(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

const TOGGLES: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikeThrough",
}

/** Text nodes inside `range`, split at its ends so each one lies wholly
 *  within it — the pieces a partial selection covers, and nothing more. */
function splitTextNodesIn(range: Range): Text[] {
  const { startContainer, startOffset, endContainer, endOffset } = range
  let start = startContainer
  let end = endContainer
  let from = startOffset
  let to = endOffset
  if (end instanceof Text && to < end.length) end.splitText(to)
  if (start instanceof Text && from > 0) {
    const tail = start.splitText(from)
    if (end === start) {
      end = tail
      to -= from
    }
    start = tail
    from = 0
  }
  const out: Text[] = []
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root instanceof Text ? root.parentNode ?? root : root, NodeFilter.SHOW_TEXT)
  const bounds = document.createRange()
  bounds.setStart(start, from)
  bounds.setEnd(end, end instanceof Text ? Math.min(to, end.length) : to)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data && bounds.intersectsNode(n)) out.push(n as Text)
  }
  return out
}

/** Size runs of text. No execCommand exists for a point size, so each run
 *  gets its own inner span — inner, because a positioned line's own box is
 *  not exported. */
function sizeRuns(nodes: Text[], owner: HTMLElement | null, pt: number) {
  for (const node of nodes) {
    if (!node.data.trim()) continue
    let host = node.parentElement
    // A partial selection must not resize the rest of its span: give the
    // selected run a span of its own unless it already fills its parent.
    if (!host || host === owner || host.childNodes.length > 1) {
      const span = document.createElement("span")
      node.parentNode?.insertBefore(span, node)
      span.appendChild(node)
      host = span
    }
    host.style.fontSize = `${pt}pt`
  }
}

/** Apply a style to whatever is selected right now (a whole block or the
 *  user's highlighted characters). */
function styleSelected(op: AssistantTextStyle) {
  document.execCommand("styleWithCSS", false, "true")
  if (op.color) document.execCommand("foreColor", false, op.color)
  if (op.highlight) document.execCommand("hiliteColor", false, op.highlight)
  for (const [key, command] of Object.entries(TOGGLES)) {
    const want = op[key as keyof AssistantTextStyle]
    if (typeof want !== "boolean") continue
    // Toggles, so only fire when the state differs: "make it bold" on text
    // that is already bold must not un-bold it.
    if (document.queryCommandState(command) !== want) document.execCommand(command)
  }
}

function styleRange(range: Range, op: AssistantTextStyle) {
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  styleSelected(op)
  if (op.fontSize) {
    const current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : range
    sizeRuns(splitTextNodesIn(current), null, op.fontSize)
  }
}

function styleBlock(el: HTMLElement, op: AssistantTextStyle) {
  selectContents(el)
  styleSelected(op)
  if (op.fontSize) sizeRuns(textNodes(el), el, op.fontSize)
}

/** Replace text inside a block, keeping the formatting around it. */
function replaceText(el: HTMLElement, find: string | undefined, replace: string): boolean {
  const nodes = textNodes(el)
  if (nodes.length === 0) {
    el.textContent = replace
    return true
  }
  const full = nodes.map((n) => n.data).join("")
  let start = 0
  let end = full.length
  if (find) {
    start = full.indexOf(find)
    if (start < 0) {
      // The model quotes with collapsed whitespace; try that too.
      const collapsed = full.replace(/\s+/g, " ")
      const at = collapsed.indexOf(find.replace(/\s+/g, " "))
      if (at < 0) return false
      // Map the collapsed index back onto the original string.
      let seen = 0
      let i = 0
      for (; i < full.length && seen < at; i++) {
        if (!(/\s/.test(full[i]) && i > 0 && /\s/.test(full[i - 1]))) seen++
      }
      start = i
    }
    end = start + find.length
  }
  let offset = 0
  let written = false
  for (const node of nodes) {
    const nodeStart = offset
    const nodeEnd = offset + node.data.length
    offset = nodeEnd
    if (nodeEnd <= start || nodeStart >= end) continue
    const from = Math.max(start, nodeStart) - nodeStart
    const to = Math.min(end, nodeEnd) - nodeStart
    node.data = node.data.slice(0, from) + (written ? "" : replace) + node.data.slice(to)
    written = true
  }
  return written
}

function retag(el: HTMLElement, tag: string): HTMLElement {
  const next = document.createElement(tag)
  for (const attr of Array.from(el.attributes)) next.setAttribute(attr.name, attr.value)
  while (el.firstChild) next.appendChild(el.firstChild)
  el.replaceWith(next)
  return next
}

function cellIn(editor: HTMLElement, sheet: string, ref: string): HTMLTableCellElement | null {
  const page = pages(editor).find((p) => (p.getAttribute("data-sheet-name") || "Sheet1") === sheet)
  return page?.querySelector<HTMLTableCellElement>(`td[data-cell="${ref}"]`) ?? null
}

function setOrClear(td: HTMLTableCellElement, property: string, value: string, on: boolean | undefined) {
  if (on === undefined) return
  if (on) td.style.setProperty(property, value)
  else td.style.removeProperty(property)
}

/**
 * Perform the model's operations on the live editor. Anything that no longer
 * matches (a block the user deleted meanwhile, a cell outside the loaded grid,
 * a heading on a positioned page) is skipped with a reason rather than failing
 * the batch.
 */
export function applyOperations(
  editor: HTMLElement,
  ops: AssistantOperation[],
  labels: { missing: string; positioned: string; notFound: string; noSelection: string },
  selection?: EditorSelection,
): ApplyResult {
  const byId = (id: string) => editor.querySelector<HTMLElement>(`[${AI_ID}="${id}"]`)
  const everyWithId = (id: string) =>
    Array.from(editor.querySelectorAll<HTMLElement>(`[${AI_ID}="${id}"], [${AI_OBJ}="${id}"]`))
  // The selection is acted on first, while its range still points at the
  // text it was made on; deletions go last so ids stay resolvable meanwhile.
  const rank = (op: AssistantOperation) =>
    op.op === "style_selection" || op.op === "delete_selection" || op.op === "replace_selection"
      ? 0
      : op.op === "delete"
        ? 2
        : 1
  ops = [...ops].sort((a, b) => rank(a) - rank(b))
  const result: ApplyResult = { applied: 0, skipped: [] }
  const onPositioned = (el: HTMLElement) =>
    el.closest("[data-page-content]")?.getAttribute("data-positioned") === "true"

  // Styling works by selecting each target, which would leave the LAST target
  // as "the selection". Put the user's own selection back afterwards, so the
  // next prompt still means what they highlighted.
  const userRange = liveRange(selection, editor)
  editor.focus({ preventScroll: true })
  for (const op of ops) {
    switch (op.op) {
      case "style_selection":
      case "delete_selection":
      case "replace_selection": {
        const range = liveRange(selection, editor)
        if (!range || range.collapsed) {
          result.skipped.push(labels.noSelection)
          break
        }
        if (op.op === "style_selection") {
          const { op: _name, ...style } = op
          styleRange(range, style)
          result.applied++
          break
        }
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        if (op.op === "delete_selection") document.execCommand("delete")
        else document.execCommand("insertText", false, op.text)
        result.applied++
        break
      }
      case "delete": {
        let removed = 0
        for (const id of op.ids) {
          const els = everyWithId(id)
          els.forEach((el) => el.remove())
          removed += els.length ? 1 : 0
        }
        if (removed < op.ids.length) result.skipped.push(labels.missing)
        if (removed) result.applied++
        break
      }
      case "style":
      case "clear_format":
      case "align":
      case "heading":
      case "list": {
        const targets = op.ids.map((id) => byId(id)).filter((el): el is HTMLElement => !!el)
        if (targets.length < op.ids.length) result.skipped.push(labels.missing)
        if (op.op === "list") {
          if (targets.length === 0) break
          if (targets.some(onPositioned)) {
            result.skipped.push(labels.positioned)
            break
          }
          const list = document.createElement(op.ordered ? "ol" : "ul")
          targets[0].before(list)
          for (const el of targets) list.appendChild(el.tagName === "LI" ? el : retag(el, "li"))
          result.applied++
          break
        }
        for (const el of targets) {
          if (op.op === "style") styleBlock(el, op)
          else if (op.op === "clear_format") {
            selectContents(el)
            document.execCommand("removeFormat")
          } else if (op.op === "align") {
            if (onPositioned(el)) {
              result.skipped.push(labels.positioned)
              continue
            }
            el.style.textAlign = op.align
          } else {
            if (onPositioned(el) || ["LI", "TD", "TH"].includes(el.tagName)) {
              result.skipped.push(labels.positioned)
              continue
            }
            retag(el, op.level === 0 ? "p" : `h${op.level}`)
          }
          result.applied++
        }
        break
      }
      case "replace_text": {
        const el = byId(op.id)
        if (!el) result.skipped.push(labels.missing)
        else if (replaceText(el, op.find, op.replace)) result.applied++
        else result.skipped.push(labels.notFound.replace("{text}", op.find ?? ""))
        break
      }
      case "cell_value": {
        const td = cellIn(editor, op.sheet, op.ref)
        if (!td) {
          result.skipped.push(labels.missing)
          break
        }
        td.textContent = op.value
        td.removeAttribute("data-d")
        if (op.value.startsWith("=")) {
          // The export writes the formula back when the shown text IS the
          // formula (sheet_grid._cell_value).
          td.setAttribute("data-t", "f")
          td.setAttribute("data-v", op.value)
        } else {
          td.removeAttribute("data-t")
          td.removeAttribute("data-v")
        }
        result.applied++
        break
      }
      case "cell_style": {
        const cells = op.refs.map((ref) => cellIn(editor, op.sheet, ref)).filter((td): td is HTMLTableCellElement => !!td)
        if (cells.length === 0) {
          result.skipped.push(labels.missing)
          break
        }
        for (const td of cells) {
          setOrClear(td, "font-weight", "700", op.bold)
          setOrClear(td, "font-style", "italic", op.italic)
          setOrClear(td, "text-decoration", "underline", op.underline)
          if (op.color) td.style.setProperty("color", op.color)
          if (op.fill) td.style.setProperty("background-color", op.fill)
          if (op.align) td.style.setProperty("text-align", op.align)
        }
        result.applied++
        break
      }
    }
  }
  const sel = window.getSelection()
  sel?.removeAllRanges()
  if (userRange && editor.contains(userRange.startContainer) && editor.contains(userRange.endContainer)) {
    sel?.addRange(userRange)
  }
  result.skipped = Array.from(new Set(result.skipped))
  return result
}

/** The editor HTML without the assistant's ids — for export. */
export function stripAiIds(html: string): string {
  return html.replace(/ data-ai-(?:id|obj)="[^"]*"/g, "")
}
