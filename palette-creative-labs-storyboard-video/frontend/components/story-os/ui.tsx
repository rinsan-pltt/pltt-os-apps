"use client"

// Small shared primitives for the Palette OS story UI. Everything reads the
// .pos-root CSS variables, so the components are theme- (dark/light) aware
// without any logic here.

import * as React from "react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/* A textarea that grows to fit its content instead of scrolling internally —
   so a stack of them scrolls as one within the surrounding container. */
export function AutoTextarea({
  value,
  onChange,
  className,
  minRows = 1,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  minRows?: number
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const resize = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])
  React.useLayoutEffect(() => {
    resize()
  }, [value, resize])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      onChange={(e) => {
        onChange(e.target.value)
        resize()
      }}
      className={cn("resize-none overflow-hidden", className)}
    />
  )
}

/* Status dot with optional glow/pulse. */
export function Dot({
  color,
  glow,
  pulse,
  className,
}: {
  color: string
  glow?: boolean
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      className={cn("inline-block size-1.5 rounded-full shrink-0", pulse && "pos-pulse", className)}
      style={{ background: color, boxShadow: glow ? `0 0 8px ${color}` : undefined }}
    />
  )
}

/* Primary action button — violet for storyboard-side actions, orange for
   animate/publish-side, per the reference design's stage accents. */
export function PrimaryBtn({
  accent = "vio",
  className,
  disabled,
  children,
  onClick,
}: {
  accent?: "vio" | "org"
  className?: string
  disabled?: boolean
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-[12.5px] font-semibold text-white rounded-[6px] px-3.5 py-[7px] whitespace-nowrap transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
        accent === "vio"
          ? "bg-[var(--pos-vio)] hover:bg-[#9D74F8]"
          : "bg-[var(--pos-org)] hover:bg-[#FF7A5C]",
        className,
      )}
    >
      {children}
    </button>
  )
}

/* Quiet bordered button. */
export function GhostBtn({
  className,
  disabled,
  children,
  onClick,
  title,
}: {
  className?: string
  disabled?: boolean
  children: React.ReactNode
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "text-xs font-medium text-[var(--pos-t2)] border border-[var(--pos-b2)] rounded-[6px] px-3 py-[5px]",
        "hover:text-[var(--pos-t1)] hover:border-[var(--pos-b3)] whitespace-nowrap transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
        className,
      )}
    >
      {children}
    </button>
  )
}

/* Segmented control (KR/EN, Sheet/Focus, library filters…). */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  mono,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  mono?: boolean
}) {
  return (
    <div className="flex bg-[var(--pos-s3)] rounded-[6px] p-[2px] gap-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "text-[11px] font-medium rounded-[5px] px-2.5 py-[3px] whitespace-nowrap cursor-pointer transition-colors",
            mono && "pos-mono text-[10.5px]",
            o.value === value
              ? "text-[var(--pos-t1)] bg-[var(--pos-seg)]"
              : "text-[var(--pos-t3)] hover:text-[var(--pos-t2)] bg-transparent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface DropItem {
  value: string
  name: string
  sub?: string
  meta?: string
}

/* Pill chip that opens a small dropdown menu — the reference design's core
   settings/model picker. Built on Radix Popover (portaled + collision-aware)
   rather than a hand-rolled absolute-positioned div: a chip sitting near the
   bottom of a scrollable panel (e.g. a CTA footer) would otherwise have its
   menu clipped by that ancestor's own scroll region — Radix instead flips
   the menu to open upward automatically when there's no room below. */
export function DropChip({
  label,
  items,
  value,
  onPick,
  accent = false,
  disabled,
  menuWidth = 260,
  align = "left",
}: {
  label: string
  items: DropItem[]
  value: string
  onPick: (v: string) => void
  accent?: boolean
  disabled?: boolean
  menuWidth?: number
  align?: "left" | "right"
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1 text-[11.5px] font-medium rounded-full px-2.5 py-[4px] whitespace-nowrap cursor-pointer transition-colors border",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            accent
              ? "pos-mono text-[10.5px] text-[var(--pos-vioT)] bg-[var(--pos-vioS)] border-[var(--pos-vioB)]"
              : "text-[var(--pos-t2)] bg-[var(--pos-s3)] border-transparent hover:text-[var(--pos-t1)]",
          )}
        >
          {label} <span className="opacity-70">⌄</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align === "left" ? "start" : "end"}
        sideOffset={6}
        collisionPadding={8}
        className="bg-[var(--pos-s2)] border-[var(--pos-b2)] rounded-[10px] p-[5px] shadow-[0_16px_48px_rgba(0,0,0,.45)] max-h-72 overflow-y-auto"
        style={{ width: menuWidth }}
      >
        {items.map((it) => {
          const active = it.value === value
          return (
            <button
              key={it.value}
              type="button"
              onClick={() => {
                onPick(it.value)
                setOpen(false)
              }}
              className={cn(
                "w-full flex items-start gap-2 rounded-[6px] px-2.5 py-[7px] cursor-pointer text-left transition-colors",
                active ? "bg-[var(--pos-vioS)]" : "hover:bg-[var(--pos-s3)]",
              )}
            >
              <span className="w-3 shrink-0 pt-[2px] text-[10px] text-[var(--pos-vioT)]">
                {active ? "✓" : ""}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className={cn(
                    "block text-xs font-medium whitespace-nowrap",
                    active ? "text-[var(--pos-vioT)]" : "text-[var(--pos-t1)]",
                  )}
                >
                  {it.name}
                </span>
                {it.sub && (
                  <span className="block text-[10.5px] text-[var(--pos-t3)] whitespace-nowrap overflow-hidden text-ellipsis">
                    {it.sub}
                  </span>
                )}
              </span>
              {it.meta && (
                <span className="shrink-0 pos-mono text-[10.5px] text-[var(--pos-t3)]">{it.meta}</span>
              )}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

/* Tiny uppercase section label (JetBrains-mono style). */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("pos-mono text-[10px] font-medium tracking-[.06em] text-[var(--pos-t3)] uppercase", className)}>
      {children}
    </div>
  )
}

/* Thin indeterminate/progress bar. */
export function ProgressBar({ pct, accent = "org" }: { pct: number; accent?: "org" | "vio" }) {
  return (
    <div className="h-1 bg-[var(--pos-s3)] rounded-sm overflow-hidden">
      <div
        className="h-full rounded-sm transition-[width] duration-500"
        style={{
          width: `${Math.max(2, Math.min(100, pct))}%`,
          background: accent === "org" ? "var(--pos-org)" : "var(--pos-vio)",
        }}
      />
    </div>
  )
}

export function aspectStyle(ratio?: string): React.CSSProperties {
  const [w, h] = (ratio || "16:9").split(":")
  return { aspectRatio: w && h ? `${w} / ${h}` : "16 / 9" }
}
