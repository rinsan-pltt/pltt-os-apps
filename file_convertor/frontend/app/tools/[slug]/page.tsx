"use client"

/**
 * `/tools/<slug>` — a tool.
 *
 * This is the app's real tool URL: what a card links to, what a refresh
 * reopens, and what a pasted link resolves to. See `toolHref` in lib/tools.ts
 * for why it is a path and not a query param.
 */

import { ToolRoute } from "@/components/layout/tool-route"

export default function ToolPage() {
  return <ToolRoute />
}
