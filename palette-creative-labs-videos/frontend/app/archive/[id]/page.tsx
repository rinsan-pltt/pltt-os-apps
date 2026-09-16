"use client"

// The palette-app router creates pages via `createElement(route.page)` with
// no props, so the Next 15 `{ params }` promise pattern doesn't apply here.
// Read dynamic segments via the next/navigation compatibility hook instead.
import { useParams } from "@palettelab/sdk/router"
import { ProjectArchivePage } from "@/components/layout/project-archive-page"

export default function ProjectArchive() {
  const params = useParams() as { id?: string }
  const id = String(params?.id ?? "")
  return (
    <div className="flex flex-1 overflow-hidden">
      <ProjectArchivePage projectId={id} />
    </div>
  )
}
