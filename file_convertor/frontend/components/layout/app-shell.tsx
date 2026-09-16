"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChevronsLeft,
  ChevronsRight,
  FileOutput,
  Images,
  LayoutGrid,
  Lock,
  FolderOpen,
  Menu,
  Pencil,
  Repeat,
  Sparkles,
  Workflow,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT, useRegistryText } from "@/lib/i18n"
import { CATEGORIES, CATEGORY_SLUG, categoryFromParam, type Category } from "@/lib/tools"
import { cn } from "@/lib/utils"

/**
 * The app's chrome — which did not previously exist. `AppShell` was a seven-line
 * wrapper around `<main>`, so 37 tools across 7 categories were reachable only
 * by browser-back or the one "Workflows" pill buried in the hero.
 *
 * A sidebar at `md`+, a top bar plus a focus-trapped drawer below it, and an
 * icon rail for the routes that need their width (the editor, compare, organize
 * and translate surfaces). The working area owns the scroll so the sidebar
 * stays put — no sticky positioning and no viewport-relative `fixed`, either of
 * which can escape the plugin's bounds inside the OS iframe.
 */

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  "Organize PDF": LayoutGrid,
  "Optimize PDF": Zap,
  "Convert PDF": Repeat,
  "Edit PDF": Pencil,
  "PDF Security": Lock,
  "PDF Intelligence": Sparkles,
  Images: Images,
}

/** Categories are a route, not page state, so the sidebar can drive the grid
 *  from anywhere and the back button behaves.
 *
 *  A path segment and not `/?cat=<slug>`: a query string does not survive an
 *  in-app click inside a Palette OS window — see the long note on `toolHref`
 *  in lib/tools.ts. */
export const categoryHref = (c: Category | "All") =>
  c === "All" ? "/" : `/category/${CATEGORY_SLUG[c]}`

const COLLAPSE_KEY = "document-toolbox:sidebar"

/** Collapsed-rail preference.
 *
 *  Absent means "no opinion", and the route decides: the four wide routes start
 *  collapsed because that is where the canvas matters. An explicit toggle wins
 *  everywhere and persists. */
function useSidebarCollapsed(dense: boolean) {
  const [pref, setPref] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_KEY)
      if (stored === "collapsed") setPref(true)
      else if (stored === "expanded") setPref(false)
    } catch {
      // Private mode or blocked storage: fall back to the route default.
    }
  }, [])

  const collapsed = pref ?? dense
  const toggle = React.useCallback(() => {
    setPref((prev) => {
      const next = !(prev ?? dense)
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "collapsed" : "expanded")
      } catch {
        // Preference simply won't persist; the toggle still works this session.
      }
      return next
    })
  }, [dense])

  return { collapsed, toggle }
}

function BrandMark() {
  const t = useT()
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white"
        style={{ backgroundImage: "var(--dt-brand-gradient)" }}
      >
        <FileOutput className="size-[1.05rem]" />
      </span>
      {/* The short name is what fits the column; the full one is the app's real
          name and is what a screen reader should hear. */}
      <span aria-hidden className="truncate text-heading">
        {t("nav.appNameShort")}
      </span>
      <span className="sr-only">{t("nav.appName")}</span>
    </span>
  )
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  onNavigate,
}: {
  href: string
  icon: LucideIcon
  label: string
  active: boolean
  collapsed?: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={href}
      draggable={false}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      // Collapsed, the icon is the only label, so the accessible name has to
      // come from the attribute — and `title` gives pointer users a tooltip.
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "flex select-none items-center rounded-lg py-2 text-ui",
        // Padding animates too: the icon has to travel from its 10px inset to
        // the centre of the 48px rail slot, and a class swap did that in one
        // frame while the sidebar beside it was still sliding.
        "transition-[color,background-color,padding] duration-[var(--dt-dur-slow)] ease-[var(--dt-ease-out)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        collapsed ? "pl-4 pr-0" : "px-2.5",
        active
          ? "bg-primary font-medium text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {/* Never unmounted — a label that disappears on the frame the class flips
          is the "sudden" part. It keeps its own `overflow-hidden` so nothing
          spills while it is mid-collapse, and the link's `aria-label` still
          supplies the accessible name in the rail. */}
      <span
        className={cn(
          "overflow-hidden truncate whitespace-nowrap",
          "transition-[max-width,margin-left,opacity] duration-[var(--dt-dur-slow)] ease-[var(--dt-ease-out)]",
          collapsed ? "ml-0 max-w-0 opacity-0" : "ml-2.5 max-w-[11rem] opacity-100",
        )}
      >
        {label}
      </span>
    </Link>
  )
}

function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const t = useT()
  const reg = useRegistryText()
  const pathname = usePathname()
  // Every destination in this app is a path, so "where am I" is a pathname
  // test and nothing else.
  const activeCat = categoryFromParam(
    pathname?.startsWith("/category/") ? pathname.slice("/category/".length) : null,
  )
  const onHome = pathname === "/" || Boolean(activeCat)

  return (
    <nav aria-label={t("nav.primary")} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <ul className="space-y-0.5">
        <li>
          <NavItem
            href="/"
            icon={Wrench}
            label={t("nav.allTools")}
            active={onHome && !activeCat}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </li>
      </ul>

      {/* Collapses to zero height rather than unmounting, and the rule below
          takes over by fading its colour in — the rail swaps this heading for a
          divider, and doing that on a class made both appear on one frame. */}
      <p
        aria-hidden={collapsed}
        className={cn(
          "overflow-hidden px-2.5 text-micro uppercase text-muted-foreground",
          "transition-[max-height,padding,opacity] duration-[var(--dt-dur-slow)] ease-[var(--dt-ease-out)]",
          collapsed ? "max-h-0 py-0 opacity-0" : "max-h-10 pb-1 pt-4 opacity-100",
        )}
      >
        {t("nav.sectionCategories")}
      </p>
      <ul
        className={cn(
          "space-y-0.5 border-t",
          "transition-[margin-top,padding-top,border-color] duration-[var(--dt-dur-slow)] ease-[var(--dt-ease-out)]",
          collapsed ? "mt-3 border-border pt-3" : "mt-0 border-transparent pt-0",
        )}
      >
        {CATEGORIES.map((c) => (
          <li key={c}>
            <NavItem
              href={categoryHref(c)}
              icon={CATEGORY_ICONS[c]}
              label={reg.category(c)}
              active={onHome && activeCat === c}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>

      <ul className={cn("mt-3 space-y-0.5 border-t border-border pt-3")}>
        <li>
          <NavItem
            href="/data-room"
            icon={FolderOpen}
            label={t("dataRoom.nav")}
            active={pathname?.startsWith("/data-room") ?? false}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </li>
        <li>
          {/* `Workflow`, not `Sparkles`: PDF Intelligence already owns sparkles
              (the conventional "AI" affordance), so the two nav items were the
              same glyph two rows apart, which is exactly the case where an
              icon stops being a shortcut and starts being a misdirection.
              Connected nodes say what a workflow is — tools chained in
              sequence. */}
          <NavItem
            href="/workflows"
            icon={Workflow}
            label={t("home.workflows")}
            active={pathname?.startsWith("/workflows") ?? false}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </li>
      </ul>
    </nav>
  )
}

export function AppShell({
  children,
  /** Start with the sidebar collapsed to a rail — for the routes whose canvas
   *  needs the width (see `wide` in app/tools/[slug]/page.tsx). A user toggle
   *  still overrides this. */
  dense = false,
}: {
  children: React.ReactNode
  dense?: boolean
}) {
  const t = useT()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const drawerRef = React.useRef<HTMLDivElement>(null)
  const restoreTo = React.useRef<HTMLElement | null>(null)
  const { collapsed, toggle } = useSidebarCollapsed(dense)

  // Any navigation closes the drawer — otherwise it sits over the page the user
  // just asked for.
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
        return
      }
      if (e.key !== "Tab") return
      // Contain Tab inside the drawer: it is modal, so focus must not walk out
      // into the page behind it.
      const focusables = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      restoreTo.current?.focus?.()
    }
  }, [drawerOpen])

  return (
    // `h-[100dvh] max-h-full` is the pair that works in both environments and
    // neither does alone: under Palette OS the plugin sits in a host container
    // SHORTER than the viewport, so `max-h-full` clamps to it; in the simulator
    // nothing above has a definite height, so `max-height:100%` is ignored and
    // the shell takes the viewport — which is what gives it a scroll range.
    <div
      className={cn(
        "grid h-[100dvh] max-h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-rows-1",
        // The rail/sidebar swap used to be a single class change, so the whole
        // shell jumped 184px in one frame. `grid-template-columns` interpolates
        // between two lengths, so transitioning it slides the sidebar and
        // reflows the working area with it. The duration token is zeroed under
        // `prefers-reduced-motion`, so this costs nothing for anyone who has
        // asked for less movement.
        "transition-[grid-template-columns] duration-[var(--dt-dur-slow)] ease-[var(--dt-ease-out)]",
        collapsed
          ? "md:grid-cols-[var(--dt-rail-w)_minmax(0,1fr)]"
          : "md:grid-cols-[var(--dt-sidebar-w)_minmax(0,1fr)]",
      )}
    >
      <a
        href="#main"
        className="sr-only left-4 top-4 z-50 rounded-lg bg-primary px-4 py-2 text-ui font-medium text-primary-foreground shadow-[var(--dt-shadow-lg)] focus:not-sr-only focus:absolute focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {t("nav.skipToContent")}
      </a>

      {/* ------------------------------------------------ sidebar (md and up) */}
      <aside className="relative hidden min-h-0 flex-col border-r border-border-strong bg-card md:flex">
        {/* Brand and the collapse toggle share the top row. The toggle sits in
            the same place in both states, which is what makes it findable
            again after you have used it — a control that moves when you press
            it is a control you have to hunt for.

            Collapsed, the 64px rail has room for one 40px target, so the
            toggle keeps it: it is the functional control, "All tools" directly
            below still links home, and Palette OS shows which app you are in
            regardless. */}
        {/* `justify-center` in both states, with the brand as the flexible
            child: expanded it fills and pushes the toggle to the right edge;
            collapsed it is zero-width and the toggle centres itself in the
            rail. That is what lets the toggle GLIDE between the two positions
            — `justify-center` toggling on a class, with the brand unmounted,
            teleported it 196px on a single frame. */}
        <div
          className={cn(
            "flex h-[var(--dt-topbar-h)] shrink-0 items-center justify-center gap-2 border-b border-border",
            "transition-[padding] duration-[var(--dt-dur-slow)] ease-[var(--dt-ease-out)]",
            collapsed ? "px-2" : "px-3",
          )}
        >
          <Link
            href="/"
            draggable={false}
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : undefined}
            className={cn(
              "min-w-0 flex-1 overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "transition-[max-width,opacity] duration-[var(--dt-dur-slow)] ease-[var(--dt-ease-out)]",
              collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
            )}
          >
            <BrandMark />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-expanded={!collapsed}
            className="shrink-0"
          >
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </Button>
        </div>
        <SidebarNav collapsed={collapsed} />
      </aside>

      {/* -------------------------------------------------- top bar (below md) */}
      <header className="flex h-[var(--dt-topbar-h)] items-center gap-2 border-b border-border-strong bg-card px-3 md:hidden">
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
      </header>

      {/* ---------------------------------------------------- drawer (below md) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        >
          <div className="absolute inset-0 bg-black/55" />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.primary")}
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-full w-[17rem] max-w-[85vw] flex-col border-r border-border-strong bg-card shadow-[var(--dt-shadow-lg)]"
          >
            <div className="flex h-[var(--dt-topbar-h)] shrink-0 items-center gap-2 border-b border-border px-3">
              <BrandMark />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("nav.closeMenu")}
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
      {/* `relative` is load-bearing, not decoration: Tailwind's `sr-only` is
          `position:absolute`, so without a positioned ancestor every
          screen-reader-only label inside a page resolves against the initial
          containing block, escapes this scroller's clip and stretches the host
          document's scroll height. */}
      <main
        id="main"
        tabIndex={-1}
        className="relative min-w-0 overflow-auto [scrollbar-gutter:stable] focus:outline-none"
      >
        {children}
      </main>
    </div>
  )
}
