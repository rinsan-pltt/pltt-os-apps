"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { usePlttCreativeVideoPortalContainer } from "@/components/ui/app-portal"

export type MentionGroup = "IMAGES" | "ELEMENTS"

export interface Mention {
  // Text inserted into the prompt (e.g. "@START_IMAGE" or "@Element1").
  token: string
  // Pill text shown in the menu (e.g. "START_IMAGE", "ELEMENT1").
  badge: string
  // Human label next to the pill (e.g. "Start Image", "Element 1").
  name: string
  group: MentionGroup
}

const GROUP_ORDER: MentionGroup[] = ["IMAGES", "ELEMENTS"]

// fal.ai-style colours (applied inline so they hold with the precompiled CSS).
const C = {
  popupBg: "#1c1c1f",
  popupBorder: "#34343a",
  header: "#8b8b90",
  name: "#e6e6e8",
  activeBg: "#2c2c31",
  footer: "#8b8b90",
  keyBg: "#2c2c31",
  keyText: "#c9c9cf",
}
const badgeColors = (g: MentionGroup) =>
  g === "IMAGES"
    ? { backgroundColor: "rgba(244,63,94,0.16)", color: "#fb7185" }
    : { backgroundColor: "rgba(59,130,246,0.18)", color: "#60a5fa" }

// Caret pixel position within a textarea, via a mirror element.
const MIRROR_PROPS = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight",
  "fontFamily", "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing",
] as const

function caretCoordinates(el: HTMLTextAreaElement, position: number) {
  const div = document.createElement("div")
  const computed = window.getComputedStyle(el)
  const s = div.style
  s.position = "absolute"
  s.visibility = "hidden"
  s.whiteSpace = "pre-wrap"
  s.wordWrap = "break-word"
  s.overflow = "hidden"
  for (const p of MIRROR_PROPS) s[p as any] = computed[p as any]
  div.textContent = el.value.slice(0, position)
  const span = document.createElement("span")
  span.textContent = el.value.slice(position) || "."
  div.appendChild(span)
  document.body.appendChild(div)
  const coords = { top: span.offsetTop, left: span.offsetLeft, height: parseInt(computed.lineHeight || "16", 10) }
  document.body.removeChild(div)
  return coords
}

export function PromptInput({
  value,
  onChange,
  placeholder,
  className,
  wrapperClassName,
  mentions,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  wrapperClassName?: string
  mentions: Mention[]
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  // Caret line's viewport (fixed) top/bottom, used to flip the menu above the
  // caret when there isn't enough room below.
  const anchorRef = React.useRef<{ lineTop: number; lineBottom: number; left: number } | null>(null)
  const portalHost = usePlttCreativeVideoPortalContainer()
  const [menu, setMenu] = React.useState<{ query: string; start: number } | null>(null)
  // Viewport (fixed) coordinates so the menu can be portaled out of the panel
  // and never clipped by an overflow-hidden ancestor.
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [active, setActive] = React.useState(0)

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart
    const upto = el.value.slice(0, caret)
    // Trigger on `@` or `#` anywhere (start, after a space, or mid-text),
    // anchored at the caret and followed only by word chars. Selecting an
    // entry replaces the trigger char with the canonical token, so `#` also
    // works as a shortcut for the @-prefixed image tokens.
    const m = upto.match(/[#@](\w*)$/)
    if (m && mentions.length > 0) {
      const start = caret - m[1].length - 1
      const c = caretCoordinates(el, start)
      const rect = el.getBoundingClientRect()
      const lineTop = rect.top + c.top - el.scrollTop
      const lineBottom = lineTop + c.height + 2
      const left = Math.max(8, Math.min(rect.left + c.left, window.innerWidth - 240))
      anchorRef.current = { lineTop, lineBottom, left }
      // Open downward by default; the layout effect below flips it above the
      // caret line once the menu's real height is known.
      setPos({ top: lineBottom, left })
      setMenu({ query: m[1], start })
      setActive(0)
    } else {
      setMenu(null)
    }
  }

  const filtered = menu
    ? mentions.filter((mn) => `${mn.badge} ${mn.name}`.toLowerCase().includes(menu.query.toLowerCase()))
    : []

  // Runs synchronously before paint: measure the menu's actual height and
  // flip it above the caret line when it would otherwise overflow the
  // bottom of the viewport.
  React.useLayoutEffect(() => {
    if (!menu || filtered.length === 0 || !menuRef.current || !anchorRef.current) return
    const { lineTop, lineBottom, left } = anchorRef.current
    const height = menuRef.current.offsetHeight
    const fitsBelow = lineBottom + height <= window.innerHeight - 8
    const top = fitsBelow ? lineBottom : Math.max(8, lineTop - height - 2)
    setPos((prev) => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [menu, filtered.length])

  const insert = (mn: Mention) => {
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const start = menu?.start ?? caret
    const before = value.slice(0, start)
    const after = value.slice(caret)
    const next = `${before}${mn.token} ${after}`
    onChange(next)
    setMenu(null)
    requestAnimationFrame(() => {
      if (el) {
        el.focus()
        const p = before.length + mn.token.length + 1
        el.setSelectionRange(p, p)
      }
    })
  }

  return (
    <div className={cn("relative", wrapperClassName)}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target)
        }}
        onClick={(e) => detect(e.currentTarget)}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) detect(e.currentTarget)
        }}
        onKeyDown={(e) => {
          if (!menu || filtered.length === 0) return
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % filtered.length) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + filtered.length) % filtered.length) }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(filtered[active]) }
          else if (e.key === "Escape") { e.preventDefault(); setMenu(null) }
        }}
        onBlur={() => setTimeout(() => setMenu(null), 120)}
        placeholder={placeholder}
        className={className}
      />

      {menu && filtered.length > 0 && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[220px] rounded-lg overflow-hidden shadow-xl text-sm"
          style={{ top: pos.top, left: pos.left, maxHeight: "min(320px, calc(100vh - 16px))", overflowY: "auto", backgroundColor: C.popupBg, border: `1px solid ${C.popupBorder}` }}
        >
          {GROUP_ORDER.map((group) => {
            const items = filtered.filter((m) => m.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="py-1">
                <div className="px-3 py-1 text-[10px] font-semibold tracking-widest uppercase" style={{ color: C.header }}>
                  {group}
                </div>
                {items.map((mn) => {
                  const idx = filtered.indexOf(mn)
                  return (
                    <button
                      key={mn.token}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); insert(mn) }}
                      onMouseEnter={() => setActive(idx)}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left"
                      style={{ backgroundColor: idx === active ? C.activeBg : "transparent" }}
                    >
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase"
                        style={badgeColors(mn.group)}
                      >
                        {mn.badge}
                      </span>
                      <span style={{ color: C.name }}>{mn.name}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* Keyboard hint footer */}
          <div
            className="flex items-center gap-3 px-3 py-1.5 text-[11px]"
            style={{ color: C.footer, borderTop: `1px solid ${C.popupBorder}` }}
          >
            <span className="flex items-center gap-1">
              <Key>↑</Key><Key>↓</Key> navigate
            </span>
            <span className="flex items-center gap-1"><Key>↵</Key> select</span>
            <span className="flex items-center gap-1"><Key>ESC</Key> close</span>
          </div>
        </div>,
        portalHost ?? document.body,
      )}
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[10px]"
      style={{ backgroundColor: "#2c2c31", color: "#c9c9cf" }}
    >
      {children}
    </span>
  )
}
