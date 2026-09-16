import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The band at the top of a page: its `<h1>`, optionally a breadcrumb above and
 * a description below it, plus room on the right for one page-level control.
 *
 * It exists because the home page had this treatment — a tinted band closed by
 * a rule, full-bleed across the working area — and Workflows and the Data Room
 * did not, so those two pages began with a bare heading floating in the
 * content and read as unfinished next to the rest of the app. Three copies of
 * the same classes would have drifted the moment one of them was edited, so
 * the band is defined here once and the three pages pass content into it.
 *
 * Full-bleed is the point of the `section`/`div` split: the border and tint
 * span the whole working area (that is what makes it read as chrome rather
 * than as a card), while the text inside lines up with the content below it on
 * the same `--dt-w-grid` measure.
 */
/** The measure the TITLE ROW sits on, so anything trailing (a tool page's
 *  `PDF ->` chip) lands on the same right edge as the content below it.
 *
 *  The row is capped, not the band's container: the container is the same
 *  `--dt-w-grid` on every page so that every page's heading starts at the same
 *  left edge. Capping the container instead centred each narrow page as a
 *  whole, which is why a tool's heading sat 268px to the right of the home
 *  page's — four different left edges across the app depending on which page
 *  you had opened. */
const ROW = {
  grid: "",
  page: "max-w-page",
  panel: "max-w-panel",
  form: "max-w-form",
  full: "",
} as const

export function PageHeader({
  title,
  description,
  breadcrumb,
  below,
  children,
  width = "grid",
  align = "between",
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** Rendered above the title — the Data Room's room/folder path. */
  breadcrumb?: React.ReactNode
  /** A full-width row beneath the title, inside the band. */
  below?: React.ReactNode
  /** Trailing content on the title's row (home's search field, a tool's chips). */
  children?: React.ReactNode
  /** Which measure the title row sits on; must match the page's content. */
  width?: keyof typeof ROW
  /** `between` pins trailing content to the measure's right edge — right when
   *  that edge is where the content ends. `start` keeps it beside the title,
   *  for a full-width page whose content has no such edge. */
  align?: "between" | "start"
  className?: string
}) {
  return (
    <section className={cn("border-b border-border bg-card/60", className)}>
      {/* `full` is the four editors, which run edge to edge; every other page
          shares this one container so their headings line up with each other.

          Left-aligned, not `mx-auto`: centring made the content's distance from
          the sidebar depend on the display. Below ~1920px the container is
          narrower than the space available, so it filled and content sat at the
          32px gutter; past that `max-w-grid` capped it and centring pushed the
          left edge inward — 201px from the sidebar at 2360, 301px at 2560,
          741px at 3440. The same page looked different on two monitors. The
          gutter is now the left edge at every width. */}
      <div className={cn("w-full min-w-0 px-gutter py-5", width !== "full" && "max-w-grid")}>
        {breadcrumb}
        <div
          className={cn(
            "flex flex-wrap items-center gap-block",
            align === "between" ? "justify-between" : "justify-start",
            ROW[width],
          )}
        >
          {/* `basis-full` below `sm` so a trailing control wraps to its own
              line rather than squeezing the heading to a few characters. */}
          <div className="min-w-0 basis-full sm:basis-auto">
            <h1 className="text-title text-balance">{title}</h1>
            {description && (
              /* 76ch is measured, not picked for looks. The window where both
                 of the app's two page descriptions wrap to exactly two lines
                 is 72ch-80ch: the Data Room's needs at least 72ch (68ch spilled
                 it onto a third line and made that band 24px taller than the
                 Workflows band beside it), while Workflows' own collapses to a
                 single line at 84ch and up, which would break the match from
                 the other direction. 76ch sits in the middle of that window.
 
                 Below ~700px of band there is no room for two lines and the
                 text wraps further, which is the intended behaviour — the
                 heights only need to agree where the space exists.
 
                 `min-h-[2lh]` then holds the band's height steady, because the
                 measure alone cannot: Korean is compact enough that the
                 Workflows description fits ONE line while the Data Room's
                 still needs two, so in `ko` the two bands sat 23px apart even
                 though both were right in `en`. Narrowing the measure to force
                 two Korean lines would push the English Data Room text onto a
                 third. Reserving two lines settles both locales, and a page
                 with no description at all (home) never renders this <p>, so
                 its band stays as short as it should be. */
              <p className="mt-1 min-h-[2lh] max-w-[76ch] text-pretty text-body text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {children}
        </div>
        {below}
      </div>
    </section>
  )
}
