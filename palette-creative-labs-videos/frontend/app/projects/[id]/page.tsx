"use client"

import { useEffect, useRef } from "react"
// The palette-app router creates pages via `createElement(route.page)` with
// no props, so the Next 15 `{ params }` promise pattern doesn't apply here.
// Read dynamic segments via the next/navigation compatibility hook instead.
import { useParams } from "@palettelab/sdk/router"
import { VideoControlPanel } from "@/components/layout/video-control-panel"
import { VideoWorkspace } from "@/components/layout/video-workspace"
import { useProjectContext } from "@/components/providers/project-context"
import { GenerationEventsProvider } from "@/components/providers/generation-events-context"
import { PromptComposerProvider } from "@/components/providers/prompt-composer-context"
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
          type: "video",
          key_frames: data.key_frames || [],
          video_refs: data.video_refs ?? null,
          created_at: data.created_at,
          updated_at: data.updated_at,
        })
      })
      .catch(() => {
        setCurrentProject({ id, name: id, type: "video" })
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
    <GenerationEventsProvider projectId={id}>
      <PromptComposerProvider>
        <div className="flex flex-1 overflow-hidden">
          <VideoControlPanel />
          <VideoWorkspace projectId={id} />
        </div>
      </PromptComposerProvider>
    </GenerationEventsProvider>
  )
}
