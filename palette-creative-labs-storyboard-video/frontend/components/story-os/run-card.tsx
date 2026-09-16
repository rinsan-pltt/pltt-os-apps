"use client"

// One story-run card: thumbnail, title, meta line, live status — used on the
// Home "recent runs" grid and in the Library.

import * as React from "react"
import { IconRefresh, IconTrash } from "@tabler/icons-react"
import type { StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { Dot, GhostBtn, ProgressBar } from "./ui"
import { runTitle } from "./engine"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function runProgress(s: StorySession): number {
  const total = s.scenes.length || 1
  switch (s.step) {
    case "plan":
      return 0
    case "images":
      return (s.scenes.filter((sc) => sc.imageStatus === "completed").length / total) * 40
    case "video-prompts":
      return 45
    case "videos":
      return 50 + (s.scenes.filter((sc) => sc.videoStatus === "completed").length / total) * 40
    case "merging":
      return 95
    default:
      return 100
  }
}

export function RunCard({
  session,
  onOpen,
  onDelete,
  onRetryPlan,
}: {
  session: StorySession
  onOpen: () => void
  onDelete?: () => void
  onRetryPlan?: (id: string) => void
}) {
  const { t } = usePosT()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const s = session
  const thumb =
    s.finalThumbnailUrl ??
    s.scenes.find((sc) => sc.imageUrl)?.imageUrl ??
    null
  const status =
    s.planningStatus === "generating"
      ? { label: t("stPlanning"), color: "var(--pos-org)", glow: false, pulse: true }
      : s.planningStatus === "failed"
        ? { label: t("stPlanFailed"), color: "var(--pos-red)", glow: false, pulse: false }
        : s.step === "done"
          ? { label: t("stLive"), color: "var(--pos-grn)", glow: true, pulse: false }
          : s.step === "plan"
            ? { label: t("stDraft"), color: "var(--pos-t3)", glow: false, pulse: false }
            : { label: t("stRendering"), color: "var(--pos-org)", glow: false, pulse: true }
  const rendering = s.step !== "done" && s.step !== "plan"
  const title = runTitle(s)

  return (
    <>
    <div
      onClick={onOpen}
      className="group bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] overflow-hidden cursor-pointer hover:border-[var(--pos-b3)] transition-colors"
    >
      <div className="relative pos-stripes" style={{ aspectRatio: "16 / 9" }}>
        {thumb && <img src={thumb} alt="" className="absolute inset-0 size-full object-cover" />}
        <span className="absolute right-2 bottom-2 pos-mono text-[10px] text-[#F5F6F7] bg-black/70 px-1.5 py-[1px] rounded">
          0:{String(s.totalDuration).padStart(2, "0")}
        </span>
        {onDelete && (
          <button
            type="button"
            title={t("deleteRun")}
            onClick={(e) => {
              e.stopPropagation()
              setConfirmOpen(true)
            }}
            className="absolute top-2 right-2 size-6 rounded-[6px] bg-black/60 hover:bg-black/85 text-white/80 hover:text-white items-center justify-center hidden group-hover:flex cursor-pointer"
          >
            <IconTrash className="size-3.5" />
          </button>
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className="text-[12.5px] font-medium text-[var(--pos-t1)] truncate" title={s.prompt}>
          {title}
        </div>
        <div className="flex items-center justify-between mt-1 gap-2">
          <span className="pos-mono text-[11px] text-[var(--pos-t3)] truncate">
            {t("scenesN", { n: s.scenes.length })} · {s.totalDuration}s · {s.aspectRatio}
          </span>
          <span
            className="flex items-center gap-1 text-[11px] font-medium shrink-0"
            style={{ color: status.color }}
          >
            <Dot color={status.color} glow={status.glow} pulse={status.pulse} />
            {status.label}
          </span>
        </div>
        {rendering && (
          <div className="mt-2">
            <ProgressBar pct={runProgress(s)} />
          </div>
        )}
        {s.planningStatus === "failed" && onRetryPlan && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <GhostBtn className="w-full" onClick={() => onRetryPlan(s.id)}>
              <span className="inline-flex items-center gap-1.5">
                <IconRefresh className="size-3" /> {t("retryPlan")}
              </span>
            </GhostBtn>
          </div>
        )}
      </div>
    </div>
    {onDelete && (
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="uppercase tracking-widest text-sm">{t("deleteRunTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("deleteRun")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )}
    </>
  )
}
