"use client"

// Publish stage — covers session steps "merging" and "done".
// Final merged video player, run summary cards, download.

import * as React from "react"
import { IconDownload, IconRefresh } from "@tabler/icons-react"
import { resolveMediaUrl } from "@/lib/api-helper"
import type { StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { GhostBtn, PrimaryBtn, SectionLabel } from "./ui"
import { storyImageModels, storyVideoModels, type SessionActions } from "./engine"
import { YouTubePublishSection } from "./youtube-publish"
import { InstagramPublishSection } from "./instagram-publish"
import { TikTokPublishSection } from "./tiktok-publish"

export function PublishScreen({
  session,
  actions,
  onStartNew,
}: {
  session: StorySession
  actions: SessionActions
  onStartNew: () => void
}) {
  const { t } = usePosT()
  const merging = session.step !== "done"

  // The merged file may be served by the plugin itself in local dev — resolve
  // it against the discovered API base before handing it to <video>.
  const [finalSrc, setFinalSrc] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    if (!session.finalUrl) {
      setFinalSrc(null)
      return
    }
    resolveMediaUrl(session.finalUrl).then((u) => {
      if (!cancelled) setFinalSrc(u)
    })
    return () => {
      cancelled = true
    }
  }, [session.finalUrl])

  // Chromium draws its own buffering spinner over <video controls> while the
  // clip isn't playable yet — withhold `controls` until loadeddata so only
  // the poster/overlay shows (see project verify notes).
  const [videoLoaded, setVideoLoaded] = React.useState(false)

  const imgLabel = storyImageModels.find((m) => m.value === session.imageModel)
  const vidLabel = storyVideoModels.find((m) => m.value === session.videoModel)

  return (
    <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "1fr 300px" }}>
      {/* ── Final player ── */}
      <div className="flex flex-col min-h-0 min-w-0 bg-[var(--pos-base)] p-4 gap-3">
        {/* Fills all height left over by the summary cards; the video
            letterboxes inside via object-contain. */}
        <div className="relative flex-1 min-h-0 rounded-[10px] bg-black overflow-hidden">
          {finalSrc ? (
            <video
              key={finalSrc}
              src={finalSrc}
              poster={session.finalThumbnailUrl ?? undefined}
              controls={videoLoaded}
              onLoadedData={() => setVideoLoaded(true)}
              playsInline
              className="absolute inset-0 size-full object-contain bg-black"
            />
          ) : (
            <div className="absolute inset-0 pos-stripes flex flex-col items-center justify-center gap-3">
              {merging && session.mergeStatus !== "failed" ? (
                <>
                  <span className="pos-mono text-[11px] uppercase tracking-widest text-[var(--pos-t2)] pos-pulse">
                    {t("merging")}
                  </span>
                  <div className="w-56 h-1 bg-[var(--pos-s3)] rounded overflow-hidden">
                    <div className="h-full w-1/3 bg-[var(--pos-org)] animate-bar-loader rounded" />
                  </div>
                </>
              ) : (
                <span className="text-xs text-[var(--pos-red)] max-w-[52ch] text-center px-6">
                  {session.mergeError || t("mergeFailed")}
                </span>
              )}
            </div>
          )}
          <span className="absolute top-2.5 left-3 pos-mono text-[10px] text-[#9C9EA3] bg-black/50 px-1.5 py-[1px] rounded">
            FINAL · {session.aspectRatio} · {session.totalDuration}s
          </span>
          {session.step === "done" && (
            <span
              className="absolute top-2.5 right-3 pos-mono text-[10px] font-medium border px-1.5 py-[1px] rounded"
              style={{ color: "var(--pos-grn)", borderColor: "rgba(62,207,110,.4)", background: "rgba(0,0,0,.45)" }}
            >
              {t("finalVideo")} ✓
            </span>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2.5 shrink-0">
          <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] px-3 py-2.5">
            <SectionLabel className="mb-1">{t("summaryStoryboard")}</SectionLabel>
            <div className="text-[13px] font-medium text-[var(--pos-t1)]">
              {t("scenesN", { n: session.scenes.length })} · {session.totalDuration}s
            </div>
          </div>
          <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] px-3 py-2.5">
            <SectionLabel className="mb-1">{t("summaryAnimate")}</SectionLabel>
            <div className="text-[13px] font-medium text-[var(--pos-t1)]">
              {session.scenes.filter((s) => s.videoStatus === "completed").length} clips · {session.aspectRatio}
            </div>
          </div>
          <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] px-3 py-2.5">
            <SectionLabel className="mb-1">{t("summaryModels")}</SectionLabel>
            <div className="text-[12px] font-medium text-[var(--pos-t1)] truncate">
              {imgLabel ? imgLabel.label : session.imageModel} + {vidLabel ? `${vidLabel.label} ${vidLabel.version}`.trim() : session.videoModel}
            </div>
          </div>
        </div>

        {/* Prompt recap */}
        <p className="text-[11.5px] leading-relaxed text-[var(--pos-t3)] max-w-[90ch] shrink-0">{session.prompt}</p>
      </div>

      {/* ── Right rail ── */}
      <div className="border-l border-[var(--pos-b1)] bg-[var(--pos-s2)] flex flex-col p-3.5 gap-3 overflow-y-auto">
        <SectionLabel>{t("finalVideo")}</SectionLabel>
        {/* Scene strip */}
        <div className="flex flex-col gap-1.5">
          {session.scenes.map((s) => (
            <div
              key={s.index}
              className="flex items-center gap-2 bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[6px] px-2 py-1.5"
            >
              <div className="w-12 shrink-0 pos-stripes rounded overflow-hidden" style={{ aspectRatio: "16/9" }}>
                {s.imageUrl && <img src={s.imageUrl} alt="" className="size-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-[var(--pos-t1)] truncate">
                  {String(s.index + 1).padStart(2, "0")} · {s.title}
                </div>
                <div className="pos-mono text-[9.5px] text-[var(--pos-t3)]">{s.duration}s</div>
              </div>
            </div>
          ))}
        </div>

        {session.step === "done" && (
          <>
            <SectionLabel>{t("publishTo")}</SectionLabel>
            <YouTubePublishSection session={session} actions={actions} />
            <InstagramPublishSection session={session} actions={actions} />
            <TikTokPublishSection session={session} actions={actions} />
          </>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-3">
          {session.mergeStatus === "failed" && (
            <GhostBtn onClick={() => void actions.runMerge()}>
              <span className="inline-flex items-center gap-1.5">
                <IconRefresh className="size-3" /> {t("mergeRetry")}
              </span>
            </GhostBtn>
          )}
          {/* mergeStatus stays "completed" once a merge succeeds, and
              onGoPublish (app.tsx) only re-kicks a merge when mergeStatus is
              unset/failed — so once a video's already merged (e.g. before a
              narration/music/audio-settings change), there was no way to
              force a fresh merge attempt short of an Animate-side edit. This
              button always re-runs the merge on demand while on this page. */}
          {session.step === "done" && (
            <GhostBtn onClick={() => void actions.runMerge()} disabled={merging}>
              <span className="inline-flex items-center gap-1.5">
                <IconRefresh className="size-3" /> {merging ? t("mergeRegenerating") : t("mergeRegenerate")}
              </span>
            </GhostBtn>
          )}
          {finalSrc && (
            <a
              href={finalSrc}
              download={`story-video-${session.id.slice(0, 8)}.mp4`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <PrimaryBtn accent="org" className="w-full">
                <span className="inline-flex items-center gap-1.5">
                  <IconDownload className="size-3.5" /> {t("download")}
                </span>
              </PrimaryBtn>
            </a>
          )}
          <GhostBtn onClick={onStartNew}>+ {t("startNew")}</GhostBtn>
        </div>
      </div>
    </div>
  )
}
