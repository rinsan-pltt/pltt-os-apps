"use client"

// Home — hero prompt box (the design's neon-border card) that plans a story
// via POST /story/plan, plus a "recent runs" grid of existing sessions.

import * as React from "react"
import { IconLoader2, IconPhoto, IconX } from "@tabler/icons-react"
import { apiRequest } from "@/lib/api-helper"
import { uploadReferenceImage } from "@/lib/gcs-upload-helper"
import type {
  AudioMode,
  StoryContinuity,
  StoryLlm,
  StoryScene,
  StorySession,
} from "@/components/providers/story-video-context"
import { audioLabel, AudioSettingsDialog, DEFAULT_NARRATION_LANGUAGE } from "./audio-settings-dialog"
import { usePosT } from "./i18n"
import { DropChip, PrimaryBtn } from "./ui"
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_LLM,
  DEFAULT_VIDEO_MODEL,
  REF_IMAGE_MODEL,
  llmLabel,
  makeGenerationId,
  storyImageModels,
  storyLlmModels,
  storyVideoModels,
} from "./engine"
import { RunCard } from "./run-card"

const DURATIONS = ["20s", "30s", "40s", "50s", "60s"]
const RATIOS = ["16:9", "9:16", "1:1"]
// The image model takes at most 8 reference images; one slot is reserved for
// the previous scene's image during sequential generation, leaving 7 here.
const MAX_REFS = 7

interface RefEntry {
  key: number
  file?: File
  previewUrl: string
  url?: string
  assetId?: string
  analyzing: boolean
  analysis?: { kind?: string; name?: string; description?: string }
  error?: string
}

export function HomeScreen({
  sessions,
  loaded,
  prefill,
  onPrefillConsumed,
  pendingRefs,
  onPendingRefsConsumed,
  onOpenRun,
  onOpenLibrary,
  onRetryPlan,
  addSession,
  updateSession,
  onError,
}: {
  sessions: StorySession[]
  loaded: boolean
  // "Reuse this brief" hands the idea back here as the prompt box content.
  prefill?: string | null
  onPrefillConsumed?: () => void
  // Brand Kit's selection bar hands a batch of already-categorized assets
  // here as ready references — no upload/analyze round-trip needed, they're
  // added as-is (all at once, since Home is a fresh mount every visit).
  pendingRefs?: Array<{ url: string; name?: string; description?: string; kind?: string }> | null
  onPendingRefsConsumed?: () => void
  onOpenRun: (id: string) => void
  onOpenLibrary: () => void
  onRetryPlan?: (id: string) => void
  addSession: (s: StorySession) => void
  updateSession: (id: string, updater: StorySession | ((prev: StorySession) => StorySession)) => void
  onError: (title: string, err: unknown) => void
}) {
  const { t } = usePosT()
  const [prompt, setPrompt] = React.useState("")
  React.useEffect(() => {
    if (prefill) {
      setPrompt(prefill)
      onPrefillConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])
  const [duration, setDuration] = React.useState("30s")
  const [ratio, setRatio] = React.useState("16:9")
  const [continuity, setContinuity] = React.useState<StoryContinuity>("bridge")
  const [quality, setQuality] = React.useState("1080p")
  const [llmModel, setLlmModel] = React.useState<StoryLlm>(DEFAULT_LLM)
  const [audio, setAudio] = React.useState<AudioMode>("silent")
  const [musicPrompt, setMusicPrompt] = React.useState("")
  const [narrationText, setNarrationText] = React.useState("")
  const [narrationVoiceId, setNarrationVoiceId] = React.useState("")
  const [narrationLanguage, setNarrationLanguage] = React.useState(DEFAULT_NARRATION_LANGUAGE)
  const [captionsEnabled, setCaptionsEnabled] = React.useState(true)
  // Opens the settings dialog for a picked ElevenLabs-backed mode before it's
  // committed to `audio` — Cancel leaves the previous mode in place.
  const [audioSettingsMode, setAudioSettingsMode] = React.useState<AudioMode | null>(null)
  const [imageModel, setImageModel] = React.useState(DEFAULT_IMAGE_MODEL)
  const [videoModel, setVideoModel] = React.useState(DEFAULT_VIDEO_MODEL)
  const [planning, setPlanning] = React.useState(false)
  const [refs, setRefs] = React.useState<RefEntry[]>([])
  const refSeq = React.useRef(0)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const patchRef = (key: number, patch: Partial<RefEntry>) =>
    setRefs((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const addFiles = (files: File[]) => {
    const images = files.filter((f) => ["image/jpeg", "image/png", "image/webp"].includes(f.type))
    for (const file of images) {
      if (refs.length >= MAX_REFS) break
      const entry: RefEntry = {
        key: ++refSeq.current,
        file,
        previewUrl: URL.createObjectURL(file),
        analyzing: true,
      }
      setRefs((prev) => (prev.length >= MAX_REFS ? prev : [...prev, entry]))
      void (async () => {
        try {
          const uploaded = await uploadReferenceImage(null, file)
          patchRef(entry.key, { url: uploaded.url, assetId: uploaded.id })
          const res = await apiRequest("/story/reference/analyze", {
            method: "POST",
            body: JSON.stringify({ url: uploaded.url, asset_id: uploaded.id }),
          })
          patchRef(entry.key, { analyzing: false, analysis: res?.analysis })
        } catch (err) {
          patchRef(entry.key, { analyzing: false, error: err instanceof Error ? err.message : String(err) })
          onError(t("analyzeFailed"), err)
        }
      })()
    }
  }

  const removeRef = (key: number) =>
    setRefs((prev) => {
      const target = prev.find((r) => r.key === key)
      if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((r) => r.key !== key)
    })

  React.useEffect(() => {
    if (!pendingRefs || pendingRefs.length === 0) return
    setRefs((prev) => {
      const room = MAX_REFS - prev.length
      if (room <= 0) {
        onError(t("refsMaxReached", { n: MAX_REFS }), null)
        return prev
      }
      const toAdd = pendingRefs.slice(0, room)
      if (toAdd.length < pendingRefs.length) {
        onError(t("refsMaxReached", { n: MAX_REFS }), null)
      }
      const added: RefEntry[] = toAdd.map((r) => ({
        key: ++refSeq.current,
        previewUrl: r.url,
        url: r.url,
        analyzing: false,
        analysis: { kind: r.kind, name: r.name, description: r.description },
      }))
      return [...prev, ...added]
    })
    onPendingRefsConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRefs])

  const readyRefs = refs.filter((r) => r.url && r.analysis && !r.error)
  const anyAnalyzing = refs.some((r) => r.analyzing)

  const startPipeline = async () => {
    const idea = prompt.trim()
    if (!idea) {
      onError(t("emptyPrompt"), null)
      return
    }
    setPlanning(true)
    const references = readyRefs.map((r, i) => ({ index: i + 1, url: r.url!, analysis: r.analysis }))
    const id = makeGenerationId()
    const totalDuration = parseInt(duration, 10)
    // Registered in shared session state BEFORE the plan call resolves, and
    // updated in place once it does — the /story/plan request keeps running
    // on the server regardless of what the user does in the UI meanwhile, so
    // its result must land somewhere durable rather than only existing in
    // this component's local variables (which are discarded if HomeScreen
    // unmounts, e.g. because the user opened a different run while waiting).
    addSession({
      id,
      createdAt: new Date().toISOString(),
      keyFrameId: null,
      prompt: idea,
      totalDuration,
      aspectRatio: ratio,
      story: "",
      step: "plan",
      references: readyRefs.map((r, i) => ({
        index: i + 1,
        url: r.url ?? "",
        previewUrl: r.previewUrl,
        kind: r.analysis?.kind,
        name: r.analysis?.name,
        description: r.analysis?.description,
      })),
      llmModel,
      imageModel: references.length
        ? storyImageModels.find((m) => m.value === imageModel && m.reference)
          ? imageModel
          : REF_IMAGE_MODEL
        : imageModel,
      videoModel,
      continuity,
      quality,
      audio,
      musicPrompt: musicPrompt.trim() || undefined,
      narrationText: narrationText.trim() || undefined,
      narrationVoiceId: narrationVoiceId || undefined,
      narrationLanguage,
      captionsEnabled,
      scenes: [],
      planningStatus: "generating",
    })
    try {
      // /story/plan runs as a background job and returns almost immediately
      // — the actual story/scenes land later via the shared sync mechanism
      // (SSE, the reliability-net poll, or — if the browser reloads before
      // it finishes — the next /story/session fetch on mount), the same way
      // scene/merge generations already work. See engine.ts's syncSession/
      // applyPlanResult and backend/api/routes/story_video.py's plan_story.
      const res = await apiRequest("/story/plan", {
        method: "POST",
        body: JSON.stringify({
          prompt: idea,
          duration: totalDuration,
          aspect_ratio: ratio,
          llm: llmModel,
          ...(references.length ? { references } : {}),
        }),
      })
      updateSession(id, (prev) => ({ ...prev, planGenId: res?.generation_id }))
    } catch (err) {
      updateSession(id, (prev) => ({
        ...prev,
        planningStatus: "failed",
        planningError: err instanceof Error ? err.message : String(err),
      }))
      onError(t("planFailed"), err)
    } finally {
      setPlanning(false)
    }
  }

  const recent = React.useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .slice(0, 6),
    [sessions],
  )

  const imgItems = storyImageModels.map((m) => ({
    value: m.value,
    name: `${m.label} ${m.version}`.trim(),
    sub: m.description,
  }))
  const vidItems = storyVideoModels.map((m) => ({
    value: m.value,
    name: `${m.label} ${m.version}`.trim(),
    sub: m.description,
  }))
  const imgLabel = storyImageModels.find((m) => m.value === imageModel)
  const vidLabel = storyVideoModels.find((m) => m.value === videoModel)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[880px] mx-auto px-8 pt-16 pb-12">
        <h1 className="text-center font-semibold text-[40px] leading-[1.15] tracking-[-0.03em] text-[var(--pos-t1)]">
          {t("heroTitle1")}
          <br />
          {t("heroTitle2")}
        </h1>
        <p className="text-center text-sm leading-relaxed text-[var(--pos-t2)] mt-3.5 mb-8">{t("heroSub")}</p>

        {/* Neon glow prompt card — the page signature, exactly once. */}
        <div
          className="p-[2px] rounded-[18px]"
          style={{
            background: "linear-gradient(135deg,#6E4AFF 0%,#2E6BFF 45%,#9F6FFF 100%)",
            boxShadow:
              "0 0 24px rgba(78,92,255,.45),0 0 64px rgba(110,74,255,.30),0 0 120px rgba(46,107,255,.18)",
          }}
        >
          <div className="bg-[var(--pos-base)] rounded-2xl p-5 flex flex-col gap-3.5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder={t("promptPh")}
              className="w-full resize-none bg-transparent border-none outline-none text-[15px] leading-relaxed text-[var(--pos-t1)] placeholder:text-[var(--pos-t3)]"
            />

            {/* Reference images */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []))
                  e.target.value = ""
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={refs.length >= MAX_REFS}
                title={t("attachHint", { n: MAX_REFS })}
                className="text-xs text-[var(--pos-t3)] border border-dashed border-[var(--pos-b3)] rounded-[6px] px-2.5 py-[5px] hover:text-[var(--pos-t2)] cursor-pointer disabled:opacity-40"
              >
                + {t("attach")}
              </button>
              {refs.map((r) => (
                <span
                  key={r.key}
                  className="flex items-center gap-1.5 pos-mono text-[10.5px] rounded px-2 py-[3px] border"
                  style={{
                    color: r.error ? "var(--pos-red)" : "var(--pos-vioT)",
                    background: "var(--pos-vioS)",
                    borderColor: r.error ? "rgba(240,82,77,.4)" : "var(--pos-vioB)",
                  }}
                  title={r.error ?? r.analysis?.description}
                >
                  <img src={r.previewUrl} alt="" className="size-4 object-cover rounded-[2px]" />
                  {r.analyzing ? (
                    <span className="flex items-center gap-1">
                      <IconLoader2 className="size-3 pltt-animate-spin" />
                      {t("analyzing")}
                    </span>
                  ) : (
                    <span>
                      {r.analysis?.name ?? r.file?.name ?? "ref"}
                      {r.analysis?.kind ? ` · ${r.analysis.kind}` : ""}
                    </span>
                  )}
                  <button
                    type="button"
                    className="cursor-pointer text-[var(--pos-t3)] hover:text-[var(--pos-t2)]"
                    onClick={() => removeRef(r.key)}
                  >
                    <IconX className="size-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* Settings chips */}
            <div className="flex flex-wrap gap-1.5">
              <DropChip
                label={`${t("duration")} · ${duration}`}
                value={duration}
                onPick={setDuration}
                items={DURATIONS.map((d) => ({
                  value: d,
                  name: d,
                  sub: parseInt(d) <= 30 ? "short-form" : "long-form",
                }))}
                menuWidth={200}
              />
              <DropChip
                label={`${t("ratio")} · ${ratio}`}
                value={ratio}
                onPick={setRatio}
                items={[
                  { value: "16:9", name: "16:9", sub: "YouTube · landscape" },
                  { value: "9:16", name: "9:16", sub: "Reels / Shorts / TikTok" },
                  { value: "1:1", name: "1:1", sub: "feed square" },
                ]}
                menuWidth={220}
              />
              <DropChip
                label={`${t("continuity")} · ${
                  continuity === "bridge"
                    ? t("contBridge")
                    : continuity === "cinematic"
                      ? t("contCinematic")
                      : t("contIndependent")
                }`}
                value={continuity}
                onPick={(v) => setContinuity(v as StoryContinuity)}
                items={[
                  { value: "bridge", name: t("contBridge"), sub: t("contBridgeSub") },
                  { value: "cinematic", name: t("contCinematic"), sub: t("contCinematicSub") },
                  { value: "independent", name: t("contIndependent"), sub: t("contIndependentSub") },
                ]}
                menuWidth={280}
              />
              <DropChip
                label={`${t("quality")} · ${quality}`}
                value={quality}
                onPick={setQuality}
                items={[
                  { value: "720p", name: "720p", sub: t("quality720Sub") },
                  { value: "1080p", name: "1080p", sub: t("quality1080Sub") },
                ]}
                menuWidth={200}
              />
              <DropChip
                label={`${t("audio")} · ${audioLabel(audio, t)}`}
                value={audio}
                onPick={(v) => {
                  const mode = v as AudioMode
                  if (mode === "generated" || mode === "silent") {
                    setAudio(mode)
                  } else {
                    // Music/voiceover modes always open the settings dialog
                    // first — including re-picking the already-active one,
                    // which doubles as "edit its settings".
                    setAudioSettingsMode(mode)
                  }
                }}
                items={[
                  { value: "generated", name: t("audioGenerated"), sub: t("audioGeneratedSub") },
                  { value: "silent", name: t("audioSilent"), sub: t("audioSilentSub") },
                  { value: "music", name: t("audioMusic"), sub: t("audioMusicSub") },
                  { value: "voiceover_music", name: t("audioVoiceoverMusic"), sub: t("audioVoiceoverMusicSub") },
                ]}
                menuWidth={280}
              />
              {audioSettingsMode && (
                <AudioSettingsDialog
                  open
                  onOpenChange={(o) => !o && setAudioSettingsMode(null)}
                  mode={audioSettingsMode}
                  initial={{ musicPrompt, narrationText, narrationVoiceId, narrationLanguage, captionsEnabled }}
                  onSave={(v) => {
                    setMusicPrompt(v.musicPrompt)
                    setNarrationText(v.narrationText)
                    setNarrationVoiceId(v.narrationVoiceId)
                    setNarrationLanguage(v.narrationLanguage)
                    setCaptionsEnabled(v.captionsEnabled)
                    setAudio(audioSettingsMode)
                    setAudioSettingsMode(null)
                  }}
                />
              )}
            </div>

            {/* Model chips + start */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <DropChip
                label={`✦ ${llmLabel(llmModel)}`}
                value={llmModel}
                onPick={(v) => setLlmModel(v as StoryLlm)}
                items={storyLlmModels.map((m) => ({
                  value: m.value,
                  name: `${m.label} ${m.version}`.trim(),
                }))}
                menuWidth={220}
              />
              <DropChip
                label={`◇ ${imgLabel ? `${imgLabel.label} ${imgLabel.version}`.trim() : imageModel}`}
                value={imageModel}
                onPick={setImageModel}
                items={imgItems}
                menuWidth={280}
              />
              <DropChip
                label={`◆ ${vidLabel ? `${vidLabel.label} ${vidLabel.version}`.trim() : videoModel}`}
                value={videoModel}
                onPick={setVideoModel}
                items={vidItems}
                menuWidth={280}
              />
              <div className="flex-1" />
              <PrimaryBtn onClick={startPipeline} disabled={planning || anyAnalyzing || !prompt.trim()}>
                {planning ? (
                  <span className="flex items-center gap-2">
                    <IconLoader2 className="size-3.5 pltt-animate-spin" />
                    {t("planning")}
                  </span>
                ) : (
                  <>➤ {t("start")}</>
                )}
              </PrimaryBtn>
            </div>
          </div>
        </div>

        {/* Recent runs */}
        <div className="flex items-baseline justify-between mt-11 mb-3.5">
          <span className="text-[15px] font-semibold text-[var(--pos-t1)]">{t("recent")}</span>
          <span className="text-[11.5px] text-[var(--pos-t3)]">{t("recentHint")}</span>
        </div>
        {loaded && recent.length === 0 ? (
          <div className="flex items-center justify-center border border-dashed border-[var(--pos-b2)] rounded-[10px] py-12 text-sm text-[var(--pos-t3)]">
            <IconPhoto className="size-4 mr-2 opacity-60" />
            {t("noRuns")}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recent.map((s) => (
              <RunCard key={s.id} session={s} onOpen={() => onOpenRun(s.id)} onRetryPlan={onRetryPlan} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
