"use client";

import * as React from "react";
import {
  Inbox,
  Mails,
  FilePlus2,
  Menu,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  SwatchBook,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";

/**
 * The app's chrome. This replaced a 3.5rem top bar that carried the same three
 * destinations as a row of pills: fine at three, but it spent the full width of
 * the window on a row that is mostly empty, and the editor — the one surface
 * that actually wants vertical room — paid for it on every screen.
 *
 * A sidebar at `md`+ that collapses to an icon rail, a top bar plus a
 * focus-trapped drawer below it. The working area owns the scroll so the
 * sidebar stays put: no `sticky` and no viewport-relative `fixed`, either of
 * which can escape the plugin's bounds inside the Palette OS window.
 *
 * Navigation is app state, not routes (this is a single plugin surface), so the
 * items are buttons and `activeView` decides which one reads as current.
 */

/** Square icon button.
 *
 *  Styled explicitly rather than via the `Button` primitive: `cn` is a plain
 *  class join with no tailwind-merge, so overriding the primitive's own
 *  `px-3`/`h-8` from `className` would not reliably win (same reason the export
 *  menu in editor-top-bar.tsx hand-rolls its trigger). Values otherwise mirror
 *  the ghost variant in primitives.tsx.
 *
 *  40px square: comfortably past the 24px WCAG 2.2 AA target minimum, and the
 *  same size in the rail, the mobile top bar and the drawer so the control
 *  feels like one control wherever it appears. */
function IconButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors duration-150",
        "hover:bg-surface-2 hover:text-fg active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        className,
      )}
      {...props}
    />
  );
}

// Create leads: it is the app's primary job and the view the app opens on (see
// the initial `view` state in index.tsx), so it is both the first tab and the
// one already marked current on first paint. It opens the same wizard as the
// "Create newsletter" button in the Dataroom.
const LINKS: { view: string; key: string; icon: LucideIcon }[] = [
  { view: "newsletters-new", key: "nav.create", icon: FilePlus2 },
  { view: "dataroom", key: "nav.dataroom", icon: Inbox },
  { view: "newsletters", key: "nav.newsletters", icon: Newspaper },
  { view: "brand", key: "nav.brand", icon: SwatchBook },
];

const COLLAPSE_KEY = "newsletter:sidebar";

/** Collapsed-rail preference.
 *
 *  Absent means "no opinion", and the view decides: the editor starts collapsed
 *  because that is where the canvas matters. An explicit toggle wins everywhere
 *  and persists. */
function useSidebarCollapsed(dense: boolean) {
  const [pref, setPref] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_KEY);
      if (stored === "collapsed") setPref(true);
      else if (stored === "expanded") setPref(false);
    } catch {
      // Private mode or blocked storage: fall back to the per-view default.
    }
  }, []);

  const collapsed = pref ?? dense;
  const toggle = React.useCallback(() => {
    setPref((prev) => {
      const next = !(prev ?? dense);
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "collapsed" : "expanded");
      } catch {
        // Preference simply won't persist; the toggle still works this session.
      }
      return next;
    });
  }, [dense]);

  return { collapsed, toggle };
}

function BrandMark() {
  const t = useT();
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/25"
      >
        <Mails className="size-[1.05rem]" strokeWidth={2} />
      </span>
      {/* The short name is what fits the column; the full one is the plugin's
          real name and is what a screen reader should hear. */}
      <span aria-hidden className="truncate text-sm font-semibold tracking-tight text-fg">
        {t("nav.appNameShort")}
      </span>
      <span className="sr-only">{t("nav.appName")}</span>
    </span>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  collapsed,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      // Collapsed, the icon is the only label, so the accessible name has to
      // come from the attribute — and `title` gives pointer users a tooltip.
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "flex w-full select-none items-center rounded-lg py-2 text-sm",
        // Padding animates too: the icon has to travel from its inset to the
        // centre of the 4rem rail slot, and a class swap did that in one frame
        // while the sidebar beside it was still sliding.
        "transition-[color,background-color,padding] duration-[var(--nl-dur-slow)] ease-[var(--nl-ease-out)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        collapsed ? "pl-4 pr-0" : "px-2.5",
        active
          ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-400/15 dark:text-brand-300"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      {/* Never unmounted — a label that disappears on the frame the class flips
          is the "sudden" part. It keeps its own `overflow-hidden` so nothing
          spills while it is mid-collapse, and the button's `aria-label` still
          supplies the accessible name in the rail. */}
      <span
        className={cn(
          "overflow-hidden truncate whitespace-nowrap",
          "transition-[max-width,margin-left,opacity] duration-[var(--nl-dur-slow)] ease-[var(--nl-ease-out)]",
          collapsed ? "ml-0 max-w-0 opacity-0" : "ml-2.5 max-w-[11rem] opacity-100",
        )}
      >
        {label}
      </span>
    </button>
  );
}

function SidebarNav({
  activeView,
  collapsed,
  onNavigate,
}: {
  activeView: string;
  collapsed?: boolean;
  onNavigate: (view: string) => void;
}) {
  const t = useT();
  return (
    <nav aria-label={t("nav.primary")} className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scroll-thin">
      <ul className="space-y-0.5">
        {LINKS.map((l) => (
          <li key={l.view}>
            <NavItem
              icon={l.icon}
              label={t(l.key)}
              // Exact match, not `startsWith`: "newsletters-new" begins with
              // "newsletters", so a prefix test would mark both tabs current at
              // the same time. Views that have no tab of their own (the editor)
              // are mapped to the tab they belong under by the caller.
              active={activeView === l.view}
              collapsed={collapsed}
              onSelect={() => onNavigate(l.view)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Theme and language both follow Palette OS (usePlatform().colorMode /
// .language, see lib/theme.tsx and lib/i18n.ts) — no in-app toggle. Both are
// controlled from outside the app, the same way the reference plugins work.
export function AppShell({
  activeView,
  onNavigate,
  /** Start with the sidebar collapsed to a rail — for the views whose canvas
   *  needs the width (the editor). A user toggle still overrides this. */
  dense = false,
  children,
}: {
  activeView: string;
  onNavigate: (view: string) => void;
  dense?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const restoreTo = React.useRef<HTMLElement | null>(null);
  const { collapsed, toggle } = useSidebarCollapsed(dense);

  // Any navigation closes the drawer — otherwise it sits over the view the user
  // just asked for.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [activeView]);

  React.useEffect(() => {
    if (!drawerOpen) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLElement>("a,button")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      // Contain Tab inside the drawer: it is modal, so focus must not walk out
      // into the page behind it.
      const focusables = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      restoreTo.current?.focus?.();
    };
  }, [drawerOpen]);

  return (
    // `h-[100dvh] max-h-full` is the pair that works in both environments and
    // neither does alone: under Palette OS the plugin sits in a host container
    // SHORTER than the viewport, so `max-h-full` clamps to it; in `pltt dev`
    // nothing above has a definite height, so `max-height:100%` is ignored and
    // the shell takes the viewport — which is what gives it a scroll range.
    <div
      className={cn(
        "grid h-[100dvh] max-h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-rows-1",
        // The rail/sidebar swap as a single class change would jump the whole
        // shell 184px in one frame. `grid-template-columns` interpolates
        // between two lengths, so transitioning it slides the sidebar and
        // reflows the working area with it. The duration token is zeroed under
        // `prefers-reduced-motion`, so this costs nothing for anyone who has
        // asked for less movement.
        "transition-[grid-template-columns] duration-[var(--nl-dur-slow)] ease-[var(--nl-ease-out)]",
        collapsed
          ? "md:grid-cols-[var(--nl-rail-w)_minmax(0,1fr)]"
          : "md:grid-cols-[var(--nl-sidebar-w)_minmax(0,1fr)]",
      )}
    >
      <a
        href="#main"
        className="sr-only left-4 top-4 z-50 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[var(--nl-shadow-lg)] focus:not-sr-only focus:absolute focus:outline-2 focus:outline-offset-2 focus:outline-brand-500"
      >
        {t("nav.skipToContent")}
      </a>

      {/* ------------------------------------------------ sidebar (md and up) */}
      <aside className="relative hidden min-h-0 flex-col border-r border-border bg-surface md:flex">
        {/* Brand and the collapse toggle share the top row. The toggle sits in
            the same place in both states, which is what makes it findable
            again after you have used it — a control that moves when you press
            it is a control you have to hunt for.

            `justify-center` in both states, with the brand as the flexible
            child: expanded it fills and pushes the toggle to the right edge;
            collapsed it is zero-width and the toggle centres itself in the
            rail. That is what lets the toggle GLIDE between the two positions
            rather than teleport across the column on a single frame. */}
        <div
          className={cn(
            "flex h-[var(--nl-topbar-h)] shrink-0 items-center justify-center gap-2 border-b border-border",
            "transition-[padding] duration-[var(--nl-dur-slow)] ease-[var(--nl-ease-out)]",
            collapsed ? "px-2" : "px-3",
          )}
        >
          <span
            aria-hidden={collapsed}
            className={cn(
              "min-w-0 flex-1 overflow-hidden",
              "transition-[max-width,opacity] duration-[var(--nl-dur-slow)] ease-[var(--nl-ease-out)]",
              collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
            )}
          >
            <BrandMark />
          </span>
          <IconButton
            onClick={toggle}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[1.15rem]" strokeWidth={2} />
            ) : (
              <PanelLeftClose className="size-[1.15rem]" strokeWidth={2} />
            )}
          </IconButton>
        </div>
        <SidebarNav activeView={activeView} collapsed={collapsed} onNavigate={onNavigate} />
      </aside>

      {/* ------------------------------------------------- top bar (below md) */}
      <header className="flex h-[var(--nl-topbar-h)] items-center gap-2 border-b border-border bg-surface px-3 md:hidden">
        <IconButton
          aria-label={t("nav.openMenu")}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" strokeWidth={2} />
        </IconButton>
        <BrandMark />
      </header>

      {/* -------------------------------------------------- drawer (below md) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.primary")}
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-full w-[17rem] max-w-[85vw] flex-col border-r border-border bg-surface shadow-[var(--nl-shadow-lg)]"
          >
            <div className="flex h-[var(--nl-topbar-h)] shrink-0 items-center gap-2 border-b border-border px-3">
              <BrandMark />
              <IconButton
                aria-label={t("nav.closeMenu")}
                onClick={() => setDrawerOpen(false)}
                className="ml-auto"
              >
                <X className="size-5" strokeWidth={2} />
              </IconButton>
            </div>
            <SidebarNav activeView={activeView} onNavigate={onNavigate} />
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- working area */}
      {/* `relative` is load-bearing, not decoration: Tailwind's `sr-only` is
          `position:absolute`, so without a positioned ancestor every
          screen-reader-only label inside a view resolves against the initial
          containing block, escapes this scroller's clip and stretches the host
          document's scroll height. */}
      <main
        id="main"
        tabIndex={-1}
        className="relative min-w-0 overflow-auto scroll-thin [scrollbar-gutter:stable] focus:outline-none"
      >
        {children}
      </main>
    </div>
  );
}
