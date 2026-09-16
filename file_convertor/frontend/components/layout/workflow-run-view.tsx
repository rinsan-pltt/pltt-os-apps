"use client"

/** One saved workflow, rendered at `/workflows/<slug>` — see workflowHref in
 *  lib/workflows.ts. */


import { AppShell } from "@/components/layout/app-shell"
import { PageHeader } from "@/components/layout/page-header"
import { WorkflowRunner } from "@/components/layout/workflow-runner"
import { useRegistryText } from "@/lib/i18n"
import { type Workflow } from "@/lib/workflows"

export function WorkflowRunView({ workflow }: { workflow: Workflow }) {
  const reg = useRegistryText()

  return (
    <AppShell>
      {/* This page was the one left without the app's structure: no band, no
          rule, and — because the workflow's name lived in a CardTitle — no <h1>
          at all. It also capped at `--dt-w-page` and centred, so its content
          started 215px right of every other page's at 2560. Same band, same
          container, same measure as the tool pages now; the runner's card no
          longer repeats the name the heading states. */}
      <PageHeader
        title={reg.workflowTitle(workflow)}
        description={reg.workflowDescription(workflow)}
        width="form"
      />
      <div className="w-full min-w-0 max-w-grid px-gutter py-section">
        <div className="min-w-0 max-w-form">
          <WorkflowRunner workflow={workflow} />
        </div>
      </div>
    </AppShell>
  )
}
