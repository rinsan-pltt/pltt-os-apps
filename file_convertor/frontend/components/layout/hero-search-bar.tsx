"use client"

import * as React from "react"
import Link from "next/link"
import { Search, X } from "lucide-react"

import { categoryHref } from "@/components/layout/app-shell"
import { PageHeader } from "@/components/layout/page-header"
import { useT, useRegistryText } from "@/lib/i18n"
import { CATEGORIES } from "@/lib/tools"
import { cn } from "@/lib/utils"

/**
 * The home page's one band: the current scope, and search.
 *
 * It used to be a `py-14` centred hero — a marketing title, a subtitle, search
 * and *two* rows of pills: about 14rem before the first tool card, on a page
 * whose entire job is "find a tool fast". Search stays prominent (37 tools;
 * typing is the shortest path) but the fold now shows tools.
 *
 * The heading is the active scope ("All tools", or the category), not a pitch.
 * The pitch belonged to an app-store listing, not to a tool the user has
 * already chosen and opened — and as an `<h1>` it never changed, so pressing a
 * category filtered the grid while the page still claimed to show everything.
 *
 * The rail is also the only taxonomy now. Previously these pills filtered while
 * the grid's section headings anchor-linked — the same seven words with two
 * different behaviours. Category is a URL param so the sidebar drives the same
 * state from any route.
 *
 * The old `variant="workflows"` mode is gone: that page rendered this band for
 * its navigation and ended up with two `<h1>`s. The sidebar covers navigation
 * now, so this belongs to the home page alone.
 */
export function HeroSearchBar({
  query,
  onQueryChange,
  category,
}: {
  query: string
  onQueryChange: (value: string) => void
  category: string
}) {
  const t = useT()
  const reg = useRegistryText()
  const inputId = React.useId()
  const pillLabel = (c: string) => (c === "All" ? t("home.all") : reg.category(c))

  return (
    // The band itself is `PageHeader`, shared with Workflows and the Data Room;
    // what belongs to the home page is the search field and the narrow-width
    // category rail passed into it.
    <PageHeader
      title={category === "All" ? t("nav.allTools") : reg.category(category)}
      below={
        /* Below `md` only. At wider widths the sidebar lists these same seven
           categories two inches to the left, and the grid repeats them again as
           section headings — the same word three times. Below `md` the sidebar
           is behind a drawer, so here the rail is the only way to see them.

           Real links, not `<a href>`: this renders in a sandboxed iframe, where
           a bare href reloads the whole plugin. */
        <ul
          className="mt-4 flex flex-wrap items-center gap-1.5 md:hidden"
          aria-label={t("nav.sectionCategories")}
        >
          {(["All", ...CATEGORIES] as const).map((c) => {
            const active = category === c
            return (
              <li key={c}>
                <Link
                  href={categoryHref(c)}
                  draggable={false}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "block rounded-full border px-3 py-1.5 text-caption font-medium",
                    "transition-colors duration-[var(--dt-dur-instant)] ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {pillLabel(c)}
                </Link>
              </li>
            )
          })}
        </ul>
      }
    >
      <div className="relative min-w-0 basis-full sm:max-w-sm sm:basis-80">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor={inputId} className="sr-only">
          {t("home.searchAria")}
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("home.searchPlaceholder")}
          className="h-10 w-full rounded-full border border-input bg-card pl-10 pr-10 text-ui shadow-[var(--dt-shadow-sm)] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {query && (
          <button
            type="button"
            aria-label={t("home.clearSearch")}
            onClick={() => onQueryChange("")}
            className="absolute right-2.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </PageHeader>
  )
}
