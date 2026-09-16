"use client"

import { useEffect, useRef } from "react"
// The palette-app router creates pages via `createElement(route.page)` with
// no props, so the Next 15 `{ params }` promise pattern doesn't apply here.
// Read dynamic segments via the next/navigation compatibility hook instead.
import { useParams } from "@palettelab/sdk/router"
import { AppShell } from "@/components/layout/app-shell"
import { ControlPanel } from "@/components/layout/control-panel"
import { GenerationWorkspace } from "@/components/layout/generation-workspace"
import { useProjectContext } from "@/components/providers/project-context"
import { GenerationEventsProvider } from "@/components/providers/generation-events-context"
import { apiRequest } from "@/lib/api-helper"

export default function ProjectPage() {
  const params = useParams() as { id?: string }
  const id = String(params?.id ?? "")
  const { currentProject, setCurrentProject, activeKeyFrameId, setActiveKeyFrameId } =
    useProjectContext()
  const fetchedRef = useRef<string | null>(null)

  useEffect(() => {
    if (currentProject?.id === id) return
    if (fetchedRef.current === id) return
    fetchedRef.current = id

    apiRequest(`/projects/${id}`)
      .then((data) => {
        setCurrentProject({
          id: data.id || id,
          name: data.name,
          client: data.client,
          type: data.type || "image",
          key_frames: data.key_frames || [],
          created_at: data.created_at,
          updated_at: data.updated_at,
        })
      })
      .catch(() => {
        setCurrentProject({ id, name: id, type: "image" })
      })
  }, [id])

  // Ensure first keyframe is selected when arriving at the project (or when the
  // active keyframe doesn't belong to this project).
  useEffect(() => {
    if (currentProject?.id !== id) return
    const keyFrames = currentProject.key_frames ?? []
    if (keyFrames.length === 0) return
    const belongs = keyFrames.some((kf) => kf.id === activeKeyFrameId)
    if (!belongs) {
      setActiveKeyFrameId(keyFrames[0].id)
    }
  }, [id, currentProject, activeKeyFrameId, setActiveKeyFrameId])

  return (
    <AppShell>
      <GenerationEventsProvider projectId={id}>
        <div className="flex flex-1 overflow-hidden">
          <ControlPanel editData={null} />
          <GenerationWorkspace />
        </div>
      </GenerationEventsProvider>
    </AppShell>
  )
}
