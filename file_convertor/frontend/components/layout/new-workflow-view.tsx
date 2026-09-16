"use client"

/** The workflow builder, rendered at `/workflows/new` — see NEW_WORKFLOW_HREF
 *  in lib/workflows.ts. */

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Plus, Workflow as WorkflowIcon, X } from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT, useRegistryText } from "@/lib/i18n"
import { CATEGORIES, getTool } from "@/lib/tools"
import { chainableTools, createWorkflow, workflowHref } from "@/lib/workflows"
import { cn } from "@/lib/utils"

export function NewWorkflowView() {
  const router = useRouter()
  const t = useT()
  const reg = useRegistryText()
  const [title, setTitle] = React.useState("")
  const [steps, setSteps] = React.useState<string[]>([])

  const groups = React.useMemo(() => {
    const tools = chainableTools()
    return CATEGORIES.map((cat) => ({ cat, tools: tools.filter((t) => t.category === cat) })).filter(
      (g) => g.tools.length > 0,
    )
  }, [])

  const addStep = (slug: string) => setSteps((prev) => [...prev, slug])
  const removeStep = (index: number) => setSteps((prev) => prev.filter((_, i) => i !== index))
  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const canCreate = steps.length >= 2

  const create = () => {
    if (!canCreate) return
    const workflow = createWorkflow(title, steps)
    router.push(workflowHref(workflow.slug))
  }

  return (
    <AppShell>
      {/* Full viewport height, flex column: header/name (shrink-0) → the tool
       *  picker (flex-1, fills whatever height is actually available) →
       *  action bar (shrink-0). Only the two card bodies scroll internally. */}
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-10">
          <h1 className="text-2xl font-bold tracking-tight">{t("workflows.create")}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t("workflows.createSubtitle")}</p>

          <div className="mt-6 grid gap-1.5">
            <Label htmlFor="wf-title">{t("workflows.nameLabel")}</Label>
            <Input
              id="wf-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("workflows.namePlaceholder")}
            />
          </div>
        </div>

        <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 px-4 py-6">
          <div className="grid h-full grid-cols-2 gap-4 sm:gap-6">
            <Card className="flex h-full flex-col overflow-hidden">
              <CardHeader className="shrink-0">
                <CardTitle className="text-base">{t("workflows.availableTools")}</CardTitle>
                <CardDescription>{t("workflows.availableHint")}</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                {groups.map(({ cat, tools }) => (
                  <div key={cat}>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {reg.category(cat)}
                    </p>
                    <div className="grid gap-1.5">
                      {tools.map((tool) => (
                        <button
                          key={tool.slug}
                          type="button"
                          onClick={() => addStep(tool.slug)}
                          className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                        >
                          {reg.toolTitle(tool)}
                          <Plus className="size-4 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="flex h-full flex-col overflow-hidden">
              <CardHeader className="shrink-0">
                <CardTitle className="text-base">
                  {t("workflows.yourWorkflow", { count: steps.length })}
                </CardTitle>
                <CardDescription>{t("workflows.atLeast2")}</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {steps.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("workflows.noSteps")}</p>
                )}
                {steps.map((slug, i) => {
                  const tool = getTool(slug)
                  return (
                    <div key={`${slug}-${i}`} className="flex items-center gap-2 rounded-lg border p-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-sm">{tool ? reg.toolTitle(tool) : slug}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={i === 0}
                        onClick={() => moveStep(i, -1)}
                        aria-label={t("workflows.moveUp")}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={i === steps.length - 1}
                        onClick={() => moveStep(i, 1)}
                        aria-label={t("workflows.moveDown")}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                        onClick={() => removeStep(i)}
                        aria-label={t("workflows.removeStep")}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="shrink-0 border-t bg-background">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-4">
            <Button size="lg" disabled={!canCreate} onClick={create}>
              <WorkflowIcon className="size-4" /> {t("workflows.createButton")}
            </Button>
            <Link href="/workflows" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              {t("common.cancel")}
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
