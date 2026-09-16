"use client"

/**
 * Resolve `<slug>` to a tool and render it, or the not-found screen.
 *
 * Shared by `/tools/<slug>` and `/tools/<slug>/file/<id>`, which differ only in
 * whether a Data Room file comes pre-selected — and `ToolView` reads that id
 * from the route itself, so the two pages are the same component.
 */

import { useParams } from "next/navigation"

import { NotFoundView } from "@/components/layout/not-found-view"
import { ToolView } from "@/components/layout/tool-view"
import { getTool } from "@/lib/tools"

export function ToolRoute() {
  const params = useParams<{ slug: string }>()
  const tool = getTool(String(params?.slug ?? ""))
  // Rendered, not thrown. `notFound()` from the Palette router unwinds into the
  // root layout's error boundary before it reaches the route's own handler, so
  // an unknown slug showed the red crash panel instead of this screen.
  if (!tool) return <NotFoundView />
  return <ToolView tool={tool} />
}
