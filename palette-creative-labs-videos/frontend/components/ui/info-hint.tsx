"use client"

import React from "react"
import { createPortal } from "react-dom"
import { IconInfoCircle } from "@tabler/icons-react"
import { usePlttCreativeVideoPortalContainer } from "@/components/ui/app-portal"

/** A round "i" icon that reveals a short hint on click (portaled so it isn't
 *  clipped by the scrollable panel). */
export function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0 })
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const host = usePlttCreativeVideoPortalContainer()

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 220) })
    setOpen((o) => !o)
  }

  React.useEffect(() => {
    if (!open) return
    const onDown = () => setOpen(false)
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener("mousedown", onDown)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Info"
        className="text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <IconInfoCircle className="size-3.5" />
      </button>
      {open && host &&
        createPortal(
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-[9999] w-52 rounded-md border border-border bg-card p-2 text-[11px] leading-snug text-foreground shadow-xl normal-case tracking-normal"
          >
            {text}
          </div>,
          host,
        )}
    </>
  )
}
