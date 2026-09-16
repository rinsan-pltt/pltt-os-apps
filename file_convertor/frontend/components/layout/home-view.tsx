"use client"

/**
 * The tool list — the whole of `/`, and the whole of `/category/<slug>`.
 *
 * One component for both because a category IS the home page with a filter on
 * it; the category only lives in the route so the sidebar can drive it from
 * anywhere and the back button steps out of it.
 */

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { AppShell } from "@/components/layout/app-shell"
import { HeroSearchBar } from "@/components/layout/hero-search-bar"
import { ToolGrid } from "@/components/layout/tool-grid"
import type { Category } from "@/lib/tools"

export function HomeView({ category = "All" }: { category?: Category | "All" }) {
  // `?q=` is read, never written: a full page load carries a query string fine
  // (a shared or bookmarked search still opens), but nothing inside the app
  // navigates with one — see the note on `toolHref` in lib/tools.ts.
  const searchParams = useSearchParams()
  const [query, setQuery] = React.useState(() => searchParams?.get("q") ?? "")

  const urlQuery = searchParams?.get("q") ?? ""
  React.useEffect(() => {
    if (urlQuery) setQuery(urlQuery)
  }, [urlQuery])

  return (
    <AppShell>
      <HeroSearchBar query={query} onQueryChange={setQuery} category={category} />
      <div className="w-full max-w-grid min-w-0 px-gutter py-section">
        <ToolGrid query={query} category={category} />
      </div>
    </AppShell>
  )
}
