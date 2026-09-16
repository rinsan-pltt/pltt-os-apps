"use client"

import * as React from "react"
import Link from "next/link"
import {
  FileArchive,
  Image as ImageIcon,
  Lock,
  Plus,
  ScanText,
  Trash2,
  Unlock,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { useT, useRegistryText } from "@/lib/i18n"
import {
  deleteWorkflow,
  isCustomWorkflow,
  listWorkflows,
  NEW_WORKFLOW_HREF,
  workflowHref,
  type Workflow,
} from "@/lib/workflows"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  ScanText,
  FileArchive,
  Unlock,
  Lock,
  Image: ImageIcon,
  Wrench,
}

export default function WorkflowsPage() {
  const t = useT()
  const reg = useRegistryText()
  // `listWorkflows` reads localStorage, so it can only run after mount. The
  // list therefore starts as null, not [] — the old code started empty, which
  // made "still reading" and "you have none" render identically.
  const [workflows, setWorkflows] = React.useState<Workflow[] | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<Workflow | null>(null)
  // Computed once per load instead of calling isCustomWorkflow() inside the
  // render loop, which was a localStorage read + JSON.parse per card per render.
  const [customSlugs, setCustomSlugs] = React.useState<Set<string>>(new Set())

  const load = React.useCallback(() => {
    const all = listWorkflows()
    setWorkflows(all)
    setCustomSlugs(new Set(all.filter((w) => isCustomWorkflow(w.slug)).map((w) => w.slug)))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const handleDelete = () => {
    if (!pendingDelete) return
    deleteWorkflow(pendingDelete.slug)
    load()
  }


  return (
    <AppShell>
      {/* The same band the home page and the Data Room use, so all three
          pages open the same way: heading in a tinted strip closed by a rule,
          content beneath it. This page used to start with a bare <h1> in the
          content area, which read as unfinished beside the rest of the app.
          (An older version rendered the home hero here as well and ended up
          with two <h1>s — hence the band taking the title as a prop.) */}
      <PageHeader
        title={t("workflows.pageTitle")}
        description={t("workflows.pageSubtitle")}
      />
      <div className="w-full min-w-0 max-w-grid px-gutter py-section">
        <div className="grid gap-block auto-rows-[1fr] grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))]">
          <Link
            href={NEW_WORKFLOW_HREF}
            className={cn(
              "flex h-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-surface text-center",
              "transition-[transform,border-color,background-color] duration-[var(--dt-dur-fast)] ease-[var(--dt-ease-out)]",
              "hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plus className="size-6" />
            </span>
            <div className="text-heading text-primary">{t("workflows.create")}</div>
            <p className="text-caption text-muted-foreground">{t("workflows.createHint")}</p>
          </Link>

          {workflows === null
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  aria-hidden
                  className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-surface"
                >
                  <div className="fc-skeleton size-11 rounded-lg" />
                  <div className="fc-skeleton h-4 w-2/3" />
                  <div className="fc-skeleton h-3 w-full" />
                  <div className="fc-skeleton h-3 w-4/5" />
                </div>
              ))
            : workflows.map((wf) => {
            const Icon = ICONS[wf.icon] ?? Wrench
            return (
              <div
                key={wf.slug}
                className={cn(
                  "group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-surface shadow-[var(--dt-shadow-sm)]",
                  "transition-[transform,border-color,box-shadow] duration-[var(--dt-dur-fast)] ease-[var(--dt-ease-out)]",
                  "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--dt-shadow-md)]",
                )}
              >
                <Link
                  href={workflowHref(wf.slug)}
                  className="flex flex-1 flex-col gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn("flex size-11 items-center justify-center rounded-lg", wf.color)}>
                    <Icon className="size-6" />
                  </span>
                  <div>
                    <div className="text-heading group-hover:text-primary">{reg.workflowTitle(wf)}</div>
                    <p className="mt-1 line-clamp-2 min-h-[2lh] text-pretty text-caption text-muted-foreground">{reg.workflowDescription(wf)}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-micro text-muted-foreground">
                    {wf.steps.map((s, i) => (
                      <span key={i} className="rounded-full bg-muted px-2 py-0.5">
                        {i + 1}. {reg.stepLabel(s.label)}
                      </span>
                    ))}
                  </div>
                </Link>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  {customSlugs.has(wf.slug) ? (
                    <span className="text-micro uppercase text-muted-foreground">{t("workflows.custom")}</span>
                  ) : (
                    <span />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive-text hover:bg-destructive-subtle hover:text-destructive-text"
                    onClick={() => setPendingDelete(wf)}
                  >
                    <Trash2 className="size-4" /> {t("common.delete")}
                  </Button>
                </div>
              </div>
            )
              })}
        </div>
        {workflows !== null && (
          <p role="status" className="sr-only">
            {t("workflows.countAnnounce", { count: workflows.length })}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t("workflows.deleteTitle")}
        description={
          pendingDelete
            ? t("workflows.deleteConfirm", { title: reg.workflowTitle(pendingDelete) })
            : ""
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDelete}
      />
    </AppShell>
  )
}
