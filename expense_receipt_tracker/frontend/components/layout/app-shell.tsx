"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChevronRight,
  FileBarChart,
  History,
  ListChecks,
  Menu,
  Receipt,
  ScanLine,
  Tags,
  X,
} from "lucide-react"

import { BaseCurrencyPicker } from "@/components/layout/base-currency-picker"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Left-right app shell: a persistent sidebar beside the content, rather than a
 * horizontal strip of nav above it.
 *
 * Follows the layout vocabulary of the sibling apps in palette-yuyu-apps-suite
 * (see palette-pack-verify's AppShell): a 248px sidebar carrying the brand, one
 * or more labelled nav sections and a footer rule, with the working area to its
 * right owning its own scroll.
 *
 * Below `md` a 248px column would eat most of the screen, so the sidebar
 * becomes an off-canvas drawer behind a menu button — modal while open, with
 * Escape, backdrop dismissal and focus restore.
 */

const NAV = [
  { href: "/", labelKey: "nav.dashboard", icon: Receipt },
  { href: "/expenses/history", labelKey: "nav.expenseHistory", icon: History },
  { href: "/receipts/scan", labelKey: "nav.scanReceipt", icon: ScanLine },
  { href: "/expenses/status", labelKey: "nav.updateStatus", icon: ListChecks },
  { href: "/categories", labelKey: "nav.categories", icon: Tags },
  { href: "/reports", labelKey: "nav.reports", icon: FileBarChart },
] as const

function BrandMark() {
  const t = useT()
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-white"
        style={{ backgroundImage: "var(--erx-brand-gradient)" }}
      >
        <Receipt className="size-4" />
      </span>
      {/* The short name is what fits a 248px column; the full one is the app's
          actual name and belongs to anything that reads the mark rather than
          looks at it. Both are translated, so this follows the OS language —
          which is as far as a plugin can take it: `palette-plugin.json`'s
          `name` is a single string with no locale variants (see the comment on
          `nav.appName` in lib/translations.ts), so the launcher tile and app
          list stay in one language whatever the user picks. */}
      <span className="truncate text-body font-semibold" aria-hidden>
        {t("nav.appNameShort")}
      </span>
      <span className="sr-only">{t("nav.appName")}</span>
    </span>
  )
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const t = useT()

  return (
    <nav aria-label={t("nav.primary")} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
      <p className="px-3 pb-1.5 pt-2 text-overline uppercase text-muted-foreground">
        {t("nav.sectionWorkspace")}
      </p>
      <ul>
        {NAV.map(({ href, labelKey, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname?.startsWith(href)
          return (
            <li key={href}>
              <Link
                href={href}
                draggable={false}
                onClick={onNavigate}
                // Colour alone carried the active state before; aria-current
                // makes it available to assistive tech too.
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mb-1 flex select-none items-center gap-2.5 rounded-full py-2 pl-3 pr-2.5 text-body",
                  "transition-colors duration-[var(--erx-dur-instant)] ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  // A solid pill for the current page, rather than the tinted
                  // one plus a left rail it used to carry. --primary-foreground
                  // on --primary is the 4.97:1 pair the token block certifies,
                  // and aria-current says the same thing without colour.
                  active
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 transition-opacity duration-[var(--erx-dur-instant)]",
                    active ? "opacity-70" : "opacity-40",
                  )}
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function SidebarFooter() {
  const t = useT()
  return (
    <div className="mt-auto shrink-0 border-t border-border px-4 py-4">
      <p className="pb-2 text-overline uppercase text-muted-foreground">
        {t("settings.baseCurrency")}
      </p>
      <BaseCurrencyPicker />
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const drawerRef = React.useRef<HTMLDivElement>(null)
  const restoreTo = React.useRef<HTMLElement | null>(null)

  // Any navigation closes the drawer — otherwise it stays over the page the
  // user just asked for.
  React.useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  React.useEffect(() => {
    if (!drawerOpen) return
    restoreTo.current = document.activeElement as HTMLElement | null
    drawerRef.current?.querySelector<HTMLElement>("a,button")?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        setDrawerOpen(false)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      restoreTo.current?.focus?.()
    }
  }, [drawerOpen])

  return (
    // `h-[100dvh] max-h-full` is the pair that makes this work in both
    // environments, and neither alone does:
    //   - Under Palette OS the plugin sits in a host container SHORTER than the
    //     viewport. `max-h-full` resolves against that container and clamps,
    //     so a viewport height can't overflow the host (the bug the old shell's
    //     comment warned about).
    //   - In the pltt simulator nothing above us has a definite height, so
    //     `max-height:100%` is simply ignored and the shell takes the viewport
    //     height — which is what gives it a scroll range at all.
    // With a bounded shell the working area owns the scroll and the sidebar
    // stays put, with no sticky positioning and no viewport-relative `fixed`
    // that could escape the plugin's bounds.
    <div className="grid h-[100dvh] max-h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
      <a
        href="#main"
        className="sr-only left-4 top-4 z-50 rounded-lg bg-primary px-4 py-2 text-ui font-medium text-primary-foreground shadow-[var(--erx-shadow-lg)] focus:not-sr-only focus:absolute focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {t("nav.skipToContent")}
      </a>

      {/* ------------------------------------------------ sidebar (md and up) */}
      <aside className="relative hidden min-h-0 flex-col border-r border-border-strong bg-card md:flex">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
            <Link
              href="/"
              draggable={false}
              className="min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <BrandMark />
            </Link>
          </div>
          <SidebarNav />
          <SidebarFooter />
        </div>
      </aside>

      {/* -------------------------------------------------- top bar (below md) */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border-strong bg-card/95 px-3 backdrop-blur md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("nav.openMenu")}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <Link href="/" draggable={false} className="min-w-0 rounded-lg">
          <BrandMark />
        </Link>
        <div className="ml-auto">
          <BaseCurrencyPicker />
        </div>
      </header>

      {/* ---------------------------------------------------- drawer (below md) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        >
          <div className="dialog-backdrop absolute inset-0 bg-black/55" data-phase="open" />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.primary")}
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-full w-[17rem] max-w-[85vw] flex-col border-r border-border-strong bg-card shadow-[var(--erx-shadow-lg)]"
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
              <BrandMark />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("common.close")}
                onClick={() => setDrawerOpen(false)}
                className="ml-auto"
              >
                <X className="size-5" />
              </Button>
            </div>
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- working area */}
      {/* `relative` is load-bearing, not decoration. Tailwind's `sr-only` is
          `position:absolute`, so without a positioned ancestor every
          screen-reader-only label inside a page resolved against the initial
          containing block, escaped this scroller's clip, and stretched the
          HOST document's scroll height to wherever it happened to sit. The
          symptom was a second scrollbar running hundreds of pixels past the
          end of the content — worst on /categories, whose "Other is protected"
          label sits low in the tallest page. Making the scroll container its
          own containing block keeps that inside. */}
      <main id="main" tabIndex={-1} className="relative min-w-0 overflow-auto focus:outline-none">
        {children}
      </main>
    </div>
  )
}
