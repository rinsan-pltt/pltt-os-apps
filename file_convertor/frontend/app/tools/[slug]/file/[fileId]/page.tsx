"use client"

/** `/tools/<slug>/file/<id>` — a tool opened with a Data Room file already
 *  selected, which is how "Use with…" hands a file from the Data Room to a
 *  tool. The id is a path segment rather than `?dataRoomFile=<id>`; see
 *  `toolHref` in lib/tools.ts. */

import { ToolRoute } from "@/components/layout/tool-route"

export default function ToolFilePage() {
  return <ToolRoute />
}
