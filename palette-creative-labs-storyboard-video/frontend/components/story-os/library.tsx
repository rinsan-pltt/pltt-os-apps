"use client"

// Library — every story run, filterable by status. Runs open at whatever
// stage they've reached; drafts can be deleted.

import * as React from "react"
import type { StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { Seg } from "./ui"
import { RunCard } from "./run-card"

type Filter = "all" | "live" | "rendering" | "draft"

function statusOf(s: StorySession): Exclude<Filter, "all"> {
  if (s.step === "done") return "live"
  if (s.step === "plan") return "draft"
  return "rendering"
}

export function LibraryScreen({
  sessions,
  onOpenRun,
  onDelete,
  onRetryPlan,
}: {
  sessions: StorySession[]
  onOpenRun: (id: string) => void
  onDelete: (id: string) => void
  onRetryPlan?: (id: string) => void
}) {
  const { t } = usePosT()
  const [filter, setFilter] = React.useState<Filter>("all")

  const list = React.useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .filter((s) => filter === "all" || statusOf(s) === filter),
    [sessions, filter],
  )

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--pos-base)]">
      <div className="max-w-[1060px] mx-auto px-8 py-6">
        <div className="flex items-center gap-3.5 mb-4 flex-wrap">
          <span className="text-lg font-semibold tracking-[-0.015em] text-[var(--pos-t1)]">{t("library")}</span>
          <span className="text-[11.5px] text-[var(--pos-t3)]">{t("librarySub")}</span>
          <div className="flex-1" />
          <Seg
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("filterAll") },
              { value: "live", label: t("stLive") },
              { value: "rendering", label: t("stRendering") },
              { value: "draft", label: t("stDraft") },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <div className="flex items-center justify-center border border-dashed border-[var(--pos-b2)] rounded-[10px] py-16 text-sm text-[var(--pos-t3)]">
            {t("noRuns")}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {list.map((s) => (
              <RunCard
                key={s.id}
                session={s}
                onOpen={() => onOpenRun(s.id)}
                onDelete={() => onDelete(s.id)}
                onRetryPlan={onRetryPlan}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
