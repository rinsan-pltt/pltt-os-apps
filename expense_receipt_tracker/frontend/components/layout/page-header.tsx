import * as React from "react"

import { ChromeActions } from "@/components/layout/chrome-actions"
import { cn } from "@/lib/utils"

/** The title block every route repeated by hand. One <h1> per page, with room
 *  for page-level actions on the right — a row of pill controls, aligned to
 *  the heading's centre rather than its top so a one-line title and its toolbar
 *  read as a single band. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        // Wrap, don't shrink. As a plain sm:flex-row the title column was
        // whatever was left after the toolbar — at 768px with the sidebar in
        // play that came to ~60px, and a 2rem word overflowed its box and
        // painted straight over the buttons. `flex-wrap` plus a 20rem basis
        // means the toolbar drops to its own line instead of crushing the
        // heading, at whatever width that happens to be.
        "flex flex-wrap items-center justify-between gap-block",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-full sm:basis-80">
        <h1 className="text-page text-balance break-words">{title}</h1>
        {description && (
          <p className="mt-2 max-w-[62ch] text-pretty text-body text-muted-foreground">{description}</p>
        )}
      </div>
      {/* Every page gets the assistant and the command palette, then its own
          actions after them. Rendered here rather than repeated per route, so
          the pair cannot drift out of one page's header — and so a new route
          gets them for free. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ChromeActions />
        {actions}
      </div>
    </div>
  )
}
