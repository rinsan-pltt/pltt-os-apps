"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The sheet — this app's one signature surface, and it means exactly one thing:
 * **this is your document**.
 *
 * Warm paper white with a hairline edge and a grounded shadow, so it reads as
 * paper resting on a desk rather than another card in a UI. It appears only
 * where the app is actually holding a file: the dropzone, the result, the
 * editor page, the compare panes. Nothing else gets this treatment — the
 * restraint is what makes it a signature rather than a theme.
 *
 * It stays paper-white in dark mode, deliberately. A document *is* white paper;
 * inverting it would misrepresent what the user is about to print or send, and
 * the darkened desk around it is what makes it read as an object. That was
 * already the de-facto behaviour — `bg-white` was hardcoded in nine places
 * across six workspaces — but as a literal rather than a decision.
 */
export function Sheet({
  children,
  /** A document with more than one page: two more sheets peek out behind it. */
  stacked = false,
  /**
   * No padding at all.
   *
   * Required for pages the backend returns with `positioned: true` — when
   * `pdf2docx` is unavailable on the host, elements arrive carrying absolute
   * `top`/`left` from the source PDF (see `ExtractedPage` in lib/api.ts, and
   * `test_split_into_pages_positioned_html_fallback`). Padding shifts every one
   * of them and silently destroys the original layout.
   */
  flush = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { stacked?: boolean; flush?: boolean }) {
  return (
    <div
      className={cn(
        "dt-sheet rounded-md",
        stacked && "dt-sheet-stack",
        !flush && "p-surface",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
