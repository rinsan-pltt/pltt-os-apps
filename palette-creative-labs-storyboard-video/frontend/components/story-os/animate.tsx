"use client"

// Animate stage — covers session steps "video-prompts" and "videos".
// Center: selected-shot preview above a proportional clip timeline.
// Right: motion-prompt inspector with continuity/model pickers and the CTA.

import * as React from "react"
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react"
import type { StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { DropChip, GhostBtn, PrimaryBtn, ProgressBar, SectionLabel, Seg } from "./ui"
import { DEFAULT_LLM, storyVideoModels, supportsBridge, type SessionActions } from "./engine"
import { SceneChat } from "./scene-chat"

export function AnimateScreen({
  session,
  actions,
  sel,
  setSel,
  writingPrompts,
  canGoPublish,
  onGoPublish,
  tab,
  onTabChange,
}: {
  session: StorySession
  actions: SessionActions
  sel: number
  setSel: (i: number) => void
  writingPrompts: boolean
  // Forward navigation — enabled once the run has reached Publish (all clips
  // done, merge started); before that there is no final video to show.
  canGoPublish: boolean
  onGoPublish: () => void
  // Inspector mode: edit the motion prompt directly, or talk to the agent —
  // one at a time, never both open together. Lifted to the URL (see
  // app.tsx's `view`) so refreshing on the Agent tab stays on the Agent tab,
  // same for Prompt.
  tab: "prompt" | "agent"
  onTabChange: (t: "prompt" | "agent") => void
}) {
  const { t } = usePosT()
  const [addingScene, setAddingScene] = React.useState(false)
  const addSceneFileRef = React.useRef<HTMLInputElement>(null)
  const scene = session.scenes.find((s) => s.index === sel) ?? session.scenes[0]
  const editing = session.step === "video-prompts"
  const videosDone = session.scenes.filter((s) => s.videoStatus === "completed").length
  const videosGenerating = session.scenes.some((s) => s.videoStatus === "generating")
  const anyVideoFailed = session.scenes.some((s) => s.videoStatus === "failed")
  const vidLabel = storyVideoModels.find((m) => m.value === session.videoModel)

  const continuityItems = [
    ...(supportsBridge(session)
      ? [{ value: "bridge", name: t("contBridge"), sub: t("contBridgeSub") }]
      : []),
    { value: "cinematic", name: t("contCinematic"), sub: t("contCinematicSub") },
    { value: "independent", name: t("contIndependent"), sub: t("contIndependentSub") },
  ]
  const continuity = session.continuity ?? "bridge"
  const contLabel = continuityItems.find((c) => c.value === continuity)?.name ?? continuity

  const clipStatusLabel = (s: (typeof session.scenes)[number]) =>
    s.videoStatus === "completed"
      ? t("clipDone")
      : s.videoStatus === "generating"
        ? t("clipRendering")
        : s.videoStatus === "failed"
          ? t("clipFailed")
          : t("clipWaiting")

  // ---- Timeline playhead (drag-to-scrub, as in the reference design) ------
  // Scene order isn't guaranteed to match array order — every cumulative-time
  // calculation below (playhead %, seek target, "what plays next") walks this
  // sorted copy instead of `session.scenes` directly.
  const orderedScenes = React.useMemo(
    () => [...session.scenes].sort((a, b) => a.index - b.index),
    [session.scenes],
  )
  const total = orderedScenes.reduce((a, s) => a + s.duration, 0) || session.totalDuration
  const [ph, setPh] = React.useState(0) // 0–100 across the track
  const draggingRef = React.useRef(false)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const phSec = (ph / 100) * total
  const fmtTime = (sec: number) =>
    `0:${String(Math.floor(sec)).padStart(2, "0")}.${Math.floor((sec % 1) * 10)}`
  // Start of a scene, in seconds / as a % of the whole track.
  const sceneStartSec = (index: number) => {
    let acc = 0
    for (const s of orderedScenes) {
      if (s.index === index) break
      acc += s.duration
    }
    return acc
  }
  // ---- Continuous playback across scene boundaries ------------------------
  // One <video> element renders at a time (the selected scene's), so "seek to
  // a global second" means: pick the scene that second falls in, select it
  // (remounting the <video> since its key is the scene's videoUrl), and queue
  // the in-scene offset to apply once that new element reports its duration.
  const [isPlaying, setIsPlaying] = React.useState(false)
  const isPlayingRef = React.useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const seekOffsetRef = React.useRef(0)

  const seekTo = (targetSec: number) => {
    const t = Math.max(0, Math.min(total, targetSec))
    setPh(total > 0 ? (t / total) * 100 : 0)
    let acc = 0
    let target = orderedScenes[orderedScenes.length - 1] ?? scene
    for (const s of orderedScenes) {
      if (t < acc + s.duration) {
        target = s
        break
      }
      acc += s.duration
    }
    const localOffset = Math.max(0, t - acc)
    if (target.index === scene.index) {
      if (videoRef.current) videoRef.current.currentTime = localOffset
    } else {
      seekOffsetRef.current = localOffset
      setSel(target.index)
    }
  }
  const scrubTo = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const pct = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100))
    seekTo((pct / 100) * total)
  }
  // isPlaying is driven explicitly by these two, not by the video's native
  // "pause" event — switching scenes remounts the <video> (its key is the
  // scene's videoUrl), and the outgoing element fires a native "pause" as it
  // gets detached, which would otherwise stop the auto-advance chain right
  // as the next scene's clip is about to start.
  const play = () => {
    setIsPlaying(true)
    void videoRef.current?.play().catch(() => {})
  }
  const pause = () => {
    setIsPlaying(false)
    videoRef.current?.pause()
  }

  // A session opened right after clicking "Generate" (from Home's Recent
  // Runs) can still be mid-plan — scenes stays [] until /story/plan resolves
  // — so `scene` above is undefined. Render a wait state instead of the rest
  // of this screen, which assumes a scene always exists.
  if (!scene) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-[var(--pos-t3)]">
        <IconLoader2 className="size-5 pltt-animate-spin" />
        {t("planningInProgress")}
      </div>
    )
  }

  return (
    <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "1fr 320px" }}>
      {/* ── Player + timeline ── */}
      <div className="flex flex-col min-h-0 min-w-0 bg-[var(--pos-base)] p-4 gap-3">
        {/* Preview of the selected shot — fills all height left over by the
            timeline; the media letterboxes inside via object-contain. */}
        <div className="relative flex-1 min-h-0 rounded-[10px] bg-black overflow-hidden">
          {scene.videoUrl ? (
            <video
              key={scene.videoUrl}
              ref={videoRef}
              src={scene.videoUrl}
              poster={scene.imageUrl}
              playsInline
              controls
              onClick={() => (isPlaying ? pause() : play())}
              onPlay={() => setIsPlaying(true)}
              onLoadedMetadata={(e) => {
                if (seekOffsetRef.current) {
                  e.currentTarget.currentTime = seekOffsetRef.current
                  seekOffsetRef.current = 0
                }
                if (isPlayingRef.current) e.currentTarget.play().catch(() => setIsPlaying(false))
              }}
              onTimeUpdate={(e) => {
                if (draggingRef.current) return
                setPh(total > 0 ? ((sceneStartSec(scene.index) + e.currentTarget.currentTime) / total) * 100 : 0)
              }}
              onEnded={() => {
                const pos = orderedScenes.findIndex((s) => s.index === scene.index)
                const next = orderedScenes[pos + 1]
                if (next?.videoUrl && next.videoStatus === "completed") {
                  seekOffsetRef.current = 0
                  setSel(next.index)
                } else {
                  // Run finished (or stalled) — reset to the very start and
                  // stop, rather than sitting paused at the end of the clip.
                  setIsPlaying(false)
                  setPh(0)
                  const first = orderedScenes[0]
                  if (first && first.index !== scene.index) {
                    seekOffsetRef.current = 0
                    setSel(first.index)
                  } else if (videoRef.current) {
                    videoRef.current.currentTime = 0
                  }
                }
              }}
              className="absolute inset-0 size-full object-contain bg-black cursor-pointer"
            />
          ) : scene.imageUrl ? (
            <img src={scene.imageUrl} alt={scene.title} className="absolute inset-0 size-full object-contain" />
          ) : (
            <div className="absolute inset-0 pos-stripes" />
          )}
          <span className="absolute top-2.5 left-3 pos-mono text-[10px] text-[#9C9EA3] bg-black/50 px-1.5 py-[1px] rounded">
            {session.aspectRatio} · {total}s · {session.videoModel}
          </span>
          <span
            className="absolute top-2.5 right-3 pos-mono text-[10px] font-medium border px-1.5 py-[1px] rounded"
            style={{ color: "var(--pos-orgT)", borderColor: "var(--pos-orgB)", background: "rgba(0,0,0,.45)" }}
          >
            {t("sceneN", { n: String(scene.index + 1).padStart(2, "0") }).toUpperCase()} · {scene.title.toUpperCase()}
          </span>
          {scene.videoStatus === "generating" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
              <IconLoader2 className="size-[3.75rem] text-white/90 pltt-animate-spin" />
              <span className="pos-mono text-[10px] uppercase tracking-widest text-white/90 pos-pulse">
                {t("clipRendering")}…
              </span>
            </div>
          )}
          {scene.videoStatus === "failed" && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <IconAlertTriangle className="size-5 text-[var(--pos-red)]" strokeWidth={1.5} />
              <span className="text-[11px] text-white/80 line-clamp-2 max-w-[48ch]">
                {scene.videoError || t("clipFailed")}
              </span>
              <PrimaryBtn accent="org" onClick={() => void actions.retryVideo(scene)}>
                {t("retryClip")}
              </PrimaryBtn>
            </div>
          )}
        </div>

        {/* Timeline — drag the track (or the playhead line) to scrub; the
            scene under the line becomes the selected shot. */}
        <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] px-3.5 py-3 shrink-0">
          <div className="flex justify-between items-baseline mb-2">
            <span className="pos-mono text-[10.5px] text-[var(--pos-t3)]">{fmtTime(0)}</span>
            <span className="pos-mono text-[11px] font-medium text-[var(--pos-orgT)]">▶ {fmtTime(phSec)}</span>
            <span className="pos-mono text-[10.5px] text-[var(--pos-t3)]">{fmtTime(total)}</span>
          </div>
          <div
            ref={trackRef}
            className="relative cursor-ew-resize select-none"
            onMouseDown={(e) => {
              // Prevent native image/text drag from hijacking the scrub.
              e.preventDefault()
              draggingRef.current = true
              scrubTo(e.clientX)
            }}
            onMouseMove={(e) => {
              if (draggingRef.current) scrubTo(e.clientX)
            }}
            onMouseUp={() => {
              draggingRef.current = false
            }}
            onMouseLeave={() => {
              draggingRef.current = false
            }}
          >
          <div className="flex gap-[3px] h-14">
            {orderedScenes.map((s) => {
              const active = s.index === scene.index
              // Only ever show the actual clip once it's genuinely done —
              // every other state (idle/generating/failed) shows the still
              // frame instead, never a half-loaded or stale video element.
              const hasClip = s.videoStatus === "completed" && !!s.videoUrl
              const generating = s.videoStatus === "generating"
              return (
                <button
                  key={s.index}
                  type="button"
                  className="relative rounded-[5px] overflow-hidden border cursor-pointer transition-colors"
                  style={{
                    flex: s.duration,
                    background: active ? "var(--pos-orgS)" : "var(--pos-s3)",
                    borderColor: active ? "var(--pos-orgB)" : "var(--pos-b1)",
                  }}
                  title={`${s.title} · ${s.duration}s · ${clipStatusLabel(s)}`}
                >
                  {hasClip ? (
                    // Static — poster is the exact start frame the clip was
                    // generated from. Only the main preview above plays.
                    <video
                      src={s.videoUrl}
                      poster={s.imageUrl}
                      muted
                      playsInline
                      draggable={false}
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    s.imageUrl && (
                      <img
                        src={s.imageUrl}
                        alt=""
                        draggable={false}
                        className="absolute inset-0 size-full object-cover opacity-40"
                      />
                    )
                  )}
                  {generating && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center px-1">
                      <span className="pos-mono text-[7.5px] uppercase tracking-widest text-white/90 pos-pulse text-center leading-tight">
                        {t("clipRendering")}
                      </span>
                    </div>
                  )}
                  <span
                    className="absolute left-1.5 bottom-1 pos-mono text-[9px] whitespace-nowrap"
                    style={{ color: active ? "var(--pos-orgT)" : "var(--pos-t3)" }}
                  >
                    {String(s.index + 1).padStart(2, "0")} · {total}s
                  </span>
                  {hasClip && active && (
                    <span className="absolute top-1 right-1 size-3.5 rounded-full bg-emerald-600/90 flex items-center justify-center text-white">
                      <IconCheck className="size-2.5" strokeWidth={3} />
                    </span>
                  )}
                  {generating && (
                    <span className="absolute top-1 right-1 size-2 rounded-full bg-[var(--pos-org)] pos-pulse" />
                  )}
                  {s.videoStatus === "failed" && (
                    <span className="absolute top-1 right-1 size-2 rounded-full bg-[var(--pos-red)]" />
                  )}
                </button>
              )
            })}
          </div>
          {/* Playhead — the draggable duration line. Only meaningful once
              there's actual clip footage to scrub through; during prompt
              editing (before "Generate Videos") every scene is just a still
              image, so the scrubber has nothing to seek within yet. */}
          {!editing && (
            <div
              className="absolute top-0 bottom-0 w-[2px] pointer-events-none z-10"
              style={{ left: `${ph}%`, background: "var(--pos-org)", boxShadow: "0 0 8px rgba(255,92,56,.6)" }}
            >
              <span
                className="absolute -top-px -left-[4px] w-0 h-0"
                style={{
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: "6px solid var(--pos-org)",
                }}
              />
            </div>
          )}
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-[11px] text-[var(--pos-t3)]">{t("timelineNote")}</span>
            <span className="pos-mono text-[10.5px] text-[var(--pos-t3)]">
              {session.scenes.length} shots · {vidLabel ? `${vidLabel.label} ${vidLabel.version}`.trim() : session.videoModel}
            </span>
          </div>
          {/* Scene position + add-scene controls — deliberately OUTSIDE the
              scrub track above (that div's onMouseDown/onMouseMove would
              otherwise hijack clicks meant for these buttons). Move acts on
              whichever scene is currently selected. */}
          <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-[var(--pos-b1)]">
            <div className="flex items-center gap-1">
              <GhostBtn
                disabled={orderedScenes.length === 0 || scene.index === orderedScenes[0].index}
                onClick={() => {
                  // moveScene swaps with the immediate neighbor, so the
                  // moved scene's new position is always index - 1 — follow
                  // it there instead of leaving the selection sitting on
                  // whatever scene now occupies the OLD position.
                  const newIndex = scene.index - 1
                  actions.moveScene(scene.index, "left")
                  setSel(newIndex)
                }}
                title={t("moveSceneLeft")}
              >
                <IconChevronLeft className="size-3.5" />
              </GhostBtn>
              <GhostBtn
                disabled={
                  orderedScenes.length === 0 || scene.index === orderedScenes[orderedScenes.length - 1].index
                }
                onClick={() => {
                  const newIndex = scene.index + 1
                  actions.moveScene(scene.index, "right")
                  setSel(newIndex)
                }}
                title={t("moveSceneRight")}
              >
                <IconChevronRight className="size-3.5" />
              </GhostBtn>
            </div>
            <input
              ref={addSceneFileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ""
                if (!file) return
                setAddingScene(true)
                void actions.addUploadedScene(file).finally(() => setAddingScene(false))
              }}
            />
            <GhostBtn disabled={addingScene} onClick={() => addSceneFileRef.current?.click()}>
              <span className="inline-flex items-center gap-1.5">
                {addingScene ? (
                  <IconLoader2 className="size-3.5 pltt-animate-spin" />
                ) : (
                  <IconPlus className="size-3.5" />
                )}
                {addingScene ? t("addingScene") : t("addScene")}
              </span>
            </GhostBtn>
          </div>
        </div>
      </div>

      {/* ── Inspector ── */}
      <div className="border-l border-[var(--pos-b1)] bg-[var(--pos-s2)] flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3.5">
          {/* Grows to use whatever inspector height is free, so long motion
              prompts show without scrolling when space allows. */}
          <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="pos-mono text-[11px] font-medium text-[var(--pos-orgT)] truncate">
                {t("sceneN", { n: String(scene.index + 1).padStart(2, "0") })} · {total}s
              </span>
              <Seg
                value={tab}
                onChange={onTabChange}
                options={[
                  { value: "prompt", label: t("tabPrompt") },
                  { value: "agent", label: t("tabAgent") },
                ]}
              />
            </div>
            {/* Video model — visible in both Prompt and Chat once clips
                already exist (while `editing`, the footer below already has
                this same picker before "Generate N clips"). Regenerating a
                clip (the "Regenerate clip" button, or a chat request) always
                uses whatever's picked here. */}
            {!editing && (
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <SectionLabel>{t("videoModel")}</SectionLabel>
                <DropChip
                  label={`◆ ${vidLabel ? `${vidLabel.label} ${vidLabel.version}`.trim() : session.videoModel}`}
                  value={session.videoModel}
                  onPick={(v) => actions.patchSession({ videoModel: v })}
                  items={storyVideoModels.map((m) => ({
                    value: m.value,
                    name: `${m.label} ${m.version}`.trim(),
                    sub: m.description,
                  }))}
                  menuWidth={280}
                  align="right"
                />
              </div>
            )}
            {tab === "prompt" ? (
              <>
                <SectionLabel className="mb-1">
                  {t("motionPromptLabel")}
                  <span className="normal-case tracking-normal text-[var(--pos-t4)]"> — {t("motionPromptHint")}</span>
                </SectionLabel>
                <textarea
                  value={scene.videoPrompt}
                  readOnly={!editing}
                  onChange={(e) => actions.updateScene(scene.index, { videoPrompt: e.target.value })}
                  rows={9}
                  className="w-full flex-1 min-h-[160px] resize-none text-xs leading-relaxed text-[var(--pos-t1)] bg-[var(--pos-s3)] border border-[var(--pos-b2)] rounded-[6px] p-2.5 outline-none focus:border-[var(--pos-org)] read-only:opacity-70"
                />
                {scene.videoError && (
                  <p className="text-[11px] text-[var(--pos-red)] mt-1.5 line-clamp-2" title={scene.videoError}>
                    {scene.videoError}
                  </p>
                )}
                {!editing && scene.videoStatus === "failed" && (
                  <PrimaryBtn accent="org" className="w-full mt-2" onClick={() => void actions.retryVideo(scene)}>
                    {t("retryClip")}
                  </PrimaryBtn>
                )}
                {/* Same idea as the storyboard's "Regenerate image": redo this
                    scene's clip even after it completed. A regen after merge
                    steps back to Animate and re-merges automatically. Hidden
                    for an untouched uploaded scene — there's no motion
                    prompt to regenerate FROM until the user writes one. */}
                {!editing &&
                  scene.videoStatus === "completed" &&
                  !(scene.sceneKind === "uploaded" && !scene.videoPrompt.trim()) && (
                    <GhostBtn className="w-full mt-2" onClick={() => void actions.retryVideo(scene)}>
                      <span className="inline-flex items-center gap-1.5">
                        <IconRefresh className="size-3" /> {t("regenClip")}
                      </span>
                    </GhostBtn>
                  )}
              </>
            ) : (
              <SceneChat
                accent="org"
                title={t("chatTitleAN")}
                context={`@${t("sceneN", { n: String(scene.index + 1).padStart(2, "0") })}`}
                hasContent={scene.videoStatus === "completed" && !!scene.videoUrl}
                messages={session.animateChatMessages ?? []}
                onMessagesChange={(msgs) => actions.patchSession({ animateChatMessages: msgs })}
                llmModel={session.llmModel ?? DEFAULT_LLM}
                onLlmChange={(v) => actions.patchSession({ llmModel: v })}
                scenes={session.scenes.map((s) => ({ index: s.index, title: s.title }))}
                onMentionSelect={setSel}
              />
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--pos-t3)] shrink-0">{t("autoMergeNote")}</p>
        </div>

        {/* CTA footer */}
        <div className="border-t border-[var(--pos-b1)] p-3.5 flex flex-col gap-2.5">
          {editing ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>{t("continuity")}</SectionLabel>
                <DropChip
                  label={contLabel}
                  value={continuity}
                  onPick={(v) => actions.patchSession({ continuity: v as StorySession["continuity"] })}
                  items={continuityItems}
                  menuWidth={260}
                  align="right"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>{t("videoModel")}</SectionLabel>
                <DropChip
                  label={`◆ ${vidLabel ? `${vidLabel.label} ${vidLabel.version}`.trim() : session.videoModel}`}
                  value={session.videoModel}
                  onPick={(v) => actions.patchSession({ videoModel: v })}
                  items={storyVideoModels.map((m) => ({
                    value: m.value,
                    name: `${m.label} ${m.version}`.trim(),
                    sub: m.description,
                  }))}
                  menuWidth={280}
                  align="right"
                />
              </div>
              {writingPrompts && <span className="text-xs pos-shimmer-text">{t("writingPrompts")}</span>}
              <PrimaryBtn
                accent="org"
                className="w-full"
                disabled={writingPrompts}
                onClick={() => void actions.generateVideos()}
              >
                ➤ {t("generateVideos", { n: session.scenes.length })}
              </PrimaryBtn>
            </>
          ) : (
            <>
              {/* Progress only while clips are actually rendering/failed —
                  no permanent status block on finished runs. */}
              {videosGenerating && (
                <>
                  <span className="text-xs text-[var(--pos-t2)]">
                    {t("videosProgress", { done: videosDone, total: session.scenes.length })}
                  </span>
                  <ProgressBar pct={(videosDone / Math.max(1, session.scenes.length)) * 100} accent="org" />
                </>
              )}
              {anyVideoFailed && (
                <>
                  <span className="text-[11px] text-[var(--pos-red)]">{t("videoFailedHint")}</span>
                  <PrimaryBtn accent="org" onClick={() => void actions.retryAllFailedVideos()}>
                    <span className="inline-flex items-center gap-1.5">
                      <IconRefresh className="size-3" /> {t("retryAllClips")}
                    </span>
                  </PrimaryBtn>
                </>
              )}
              {session.mergeStatus === "failed" && (
                <GhostBtn onClick={() => void actions.runMerge()}>
                  <span className="inline-flex items-center gap-1.5">
                    <IconRefresh className="size-3" /> {t("mergeRetry")}
                  </span>
                </GhostBtn>
              )}
            </>
          )}
          <GhostBtn
            className="w-full"
            disabled={!canGoPublish}
            onClick={onGoPublish}
            title={canGoPublish ? t("toPublish") : t("toPublishLocked")}
          >
            {t("toPublish")} →
          </GhostBtn>
        </div>
      </div>
    </div>
  )
}
