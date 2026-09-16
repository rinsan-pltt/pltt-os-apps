"use client"

/** `/workflows/<slug>` — one workflow. The app's real workflow URL; see
 *  `workflowHref` in lib/workflows.ts for why it is a path. */

import { useParams } from "next/navigation"

import { NotFoundView } from "@/components/layout/not-found-view"
import { WorkflowRunView } from "@/components/layout/workflow-run-view"
import { getWorkflow } from "@/lib/workflows"

export default function WorkflowPage() {
  const params = useParams<{ slug: string }>()
  const workflow = getWorkflow(String(params?.slug ?? ""))
  // Rendered, not thrown — see the same note in components/layout/tool-route.tsx.
  if (!workflow) return <NotFoundView />
  return <WorkflowRunView workflow={workflow} />
}
