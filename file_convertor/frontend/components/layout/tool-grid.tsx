"use client"

import { SearchX } from "lucide-react"

import { useT, useRegistryText } from "@/lib/i18n"
import { CATEGORIES, TOOLS, type Tool } from "@/lib/tools"

import { ToolCard } from "@/components/layout/tool-card"

function matches(tool: Tool, query: string, localized: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  // Match against the English registry text, the slug AND the localized
  // (e.g. Korean) title/description/category, so search works in either language.
  const haystack = [tool.title, tool.description, tool.category, tool.slug.replace(/-/g, " "), localized]
    .join(" ")
    .toLowerCase()
  // Every word of the query must appear somewhere, so "word pdf" and
  // "word to pdf" both find "Word to PDF".
  return q.split(/\s+/).every((word) => haystack.includes(word))
}

export function ToolGrid({ query = "", category = "All" }: { query?: string; category?: string }) {
  const t = useT()
  const reg = useRegistryText()
  const visible = TOOLS.filter(
    (tool) =>
      matches(
        tool,
        query,
        `${reg.toolTitle(tool)} ${reg.toolDescription(tool)} ${reg.category(tool.category)}`,
      ) && (category === "All" || tool.category === category),
  )

  // Two genuinely different empty states, kept as they were: "your search
  // matched nothing" needs a way to widen it, "this category is empty" does not.
  if (visible.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-gutter py-section text-center"
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <SearchX className="size-6" />
        </span>
        <p className="text-heading text-foreground">
          {query.trim()
            ? t("home.noToolsMatch", { query: query.trim() })
            : t("home.noToolsInCategory", { category: reg.category(category) })}
        </p>
        <p className="text-caption text-muted-foreground">{t("home.searchHint")}</p>
      </div>
    )
  }

  // Group only when showing everything. Filtered to one category, a single
  // heading repeating the pill the user just pressed is noise.
  //
  // These headings used to be anchor targets (`id={anchorId(cat)}`) that the
  // hero's pills linked to, so the same seven words were both a filter and a
  // jump link. The rail filters; these are plain headings.
  const grouped = category === "All"

  return (
    <>
      {/* The result count was previously silent: a screen-reader user typing in
          the search box got no feedback that the grid had changed at all. */}
      <p role="status" aria-live="polite" className="sr-only">
        {t("home.resultCount", { count: visible.length })}
      </p>

      {grouped ? (
        <div className="space-y-section">
          {CATEGORIES.map((cat) => {
            const tools = visible.filter((tool) => tool.category === cat)
            if (tools.length === 0) return null
            return (
              <section key={cat} aria-labelledby={`cat-${cat.replace(/\s+/g, "-")}`}>
                <h2
                  id={`cat-${cat.replace(/\s+/g, "-")}`}
                  className="mb-block text-heading tracking-tight"
                >
                  {reg.category(cat)}
                </h2>
                <ToolCards tools={tools} />
              </section>
            )
          })}
        </div>
      ) : (
        <ToolCards tools={visible} />
      )}
    </>
  )
}

function ToolCards({ tools }: { tools: Tool[] }) {
  return (
    // Intrinsic columns, not breakpoints. Viewport breakpoints were the wrong
    // measure twice over: the grid sits inside `main`, which is the viewport
    // minus a 248px sidebar (or a 64px rail), so `xl:grid-cols-4` fired on a
    // width the grid never had — and it stopped at four, so a 2560px display
    // showed the same four columns as a 13" laptop.
    //
    // `auto-fill` adds a track whenever ~15rem more is available and the cards
    // keep their size, so the same declaration gives 1 column at 320px, 4 at a
    // 13" laptop, and 6 on a large display, and reacts to the sidebar
    // collapsing without being told. `auto-fit` would be wrong here: with
    // three cards in a six-track row it collapses the empty tracks and
    // stretches them to 570px each.
    //
    // `min(…, 100%)` is load-bearing — a bare `minmax(14rem, 1fr)` cannot
    // go below 240px and overflows a 320px screen.
    //
    // `auto-rows-[1fr]` makes every ROW the same height, not just the cards
    // within one row, so a card's height no longer depends on which
    // neighbours it happens to sit next to. `1fr` rather than Tailwind's
    // `auto-rows-fr` (`minmax(0,1fr)`) on purpose: a 0 minimum lets content
    // overflow its own cell, while `1fr` resolves to `minmax(auto,1fr)` and
    // keeps the content floor. The card itself needs `h-full` to fill the
    // cell the row hands it.
    <ul className="grid gap-block auto-rows-[1fr] grid-cols-[repeat(auto-fill,minmax(min(var(--dt-card-min),100%),1fr))]">
      {tools.map((tool) => (
        <li key={tool.slug} className="min-w-0">
          <ToolCard tool={tool} />
        </li>
      ))}
    </ul>
  )
}
