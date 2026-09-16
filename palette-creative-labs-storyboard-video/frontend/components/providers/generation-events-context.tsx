"use client"

import * as React from "react"
import { useGenerationEvents, type GenerationItem } from "@/hooks/useGenerationEvents"
import { useProjectContext } from "@/components/providers/project-context"

// A SINGLE project-scoped generation SSE subscription, shared by everything on
// the project page. The SSE manager keys one queue per (org, channel) with
// competing consumers, so a second `EventSource` on the same channel would
// *steal* events from the first. Hosting the one subscription here lets both
// the workspace canvas and the chat panel read the same live items without
// opening a conflicting connection.
type GenerationEventsValue = {
  // Keyframe-filtered items (what the workspace canvas renders).
  items: GenerationItem[]
  // Project-wide items across every keyframe (used by the chat indicator).
  allItems: GenerationItem[]
}

const GenerationEventsCtx = React.createContext<GenerationEventsValue>({
  items: [],
  allItems: [],
})

export function GenerationEventsProvider({
  projectId,
  children,
}: {
  projectId?: string | null
  children: React.ReactNode
}) {
  const { activeKeyFrameId } = useProjectContext()
  const { items, allItems } = useGenerationEvents("image", projectId, activeKeyFrameId)
  const value = React.useMemo(() => ({ items, allItems }), [items, allItems])
  return (
    <GenerationEventsCtx.Provider value={value}>{children}</GenerationEventsCtx.Provider>
  )
}

/** Live generation items for the current project/keyframe. Returns an empty
 * list when rendered outside a `GenerationEventsProvider` (no throw) so
 * consumers stay safe wherever they're mounted. */
export function useSharedGenerationEvents() {
  return React.useContext(GenerationEventsCtx)
}
