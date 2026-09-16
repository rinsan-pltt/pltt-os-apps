"use client"

// Brief view — the run's overall concept, as opposed to the scene-by-scene
// storyboard: the user's idea, the planner's concept summary, the production
// settings, the style bible (mood/look) and the cast references.
//
// EDITABLE: idea, concept/story, the generation settings (models, continuity,
// quality, audio) and every style-bible field save straight onto the session
// and apply from the next generation onward. Duration and ratio stay locked —
// the scenes were already cut to them at planning time.

import * as React from "react"
import { IconArrowRight, IconCopy, IconLoader2, IconPlus, IconRefresh, IconX } from "@tabler/icons-react"
import type { AudioMode, StoryContinuity, StoryLlm, StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { AutoTextarea, DropChip, GhostBtn, PrimaryBtn, SectionLabel } from "./ui"
import { useLightbox } from "./image-lightbox"
import { audioLabel, AudioSettingsDialog, DEFAULT_NARRATION_LANGUAGE } from "./audio-settings-dialog"
import {
  DEFAULT_LLM,
  llmLabel,
  MAX_INPUT_REFS,
  masterImageUrls,
  storyImageModels,
  storyLlmModels,
  storyVideoModels,
  supportsEndFrame,
  type SessionActions,
} from "./engine"

const BIBLE_FIELDS = ["characters", "environment", "lighting", "camera", "grading"] as const
const DURATIONS = [20, 30, 40, 50, 60]
const RATIOS = ["16:9", "9:16", "1:1"]
// Per-clip bounds the backend enforces (3–15s), used to derive the feasible
// scene-count range for a given total duration.
const SCENE_MIN_S = 3
const SCENE_MAX_S = 15

export function BriefScreen({
  session,
  actions,
  onReuse,
  onGoStoryboard,
}: {
  session: StorySession
  actions: SessionActions
  onReuse: () => void
  onGoStoryboard: () => void
}) {
  const { t } = usePosT()
  const enlarge = useLightbox()
  const s = session
  // Opens the settings dialog for a picked ElevenLabs-backed mode before it's
  // committed — Cancel leaves the session's previous audio mode untouched.
  const [audioSettingsMode, setAudioSettingsMode] = React.useState<AudioMode | null>(null)

  const refFileRef = React.useRef<HTMLInputElement>(null)
  const refsAtCap = (s.references?.length ?? 0) >= MAX_INPUT_REFS

  const anchored = (s.references?.length ?? 0) > 0 || masterImageUrls(s).length > 0
  const availableImageModels = anchored ? storyImageModels.filter((m) => m.reference) : storyImageModels
  const imgLabel = storyImageModels.find((m) => m.value === s.imageModel)
  const vidLabel = storyVideoModels.find((m) => m.value === s.videoModel)

  const continuity = s.continuity ?? "bridge"
  const continuityItems = [
    ...(supportsEndFrame(s.videoModel)
      ? [{ value: "bridge", name: t("contBridge"), sub: t("contBridgeSub") }]
      : []),
    { value: "cinematic", name: t("contCinematic"), sub: t("contCinematicSub") },
    { value: "independent", name: t("contIndependent"), sub: t("contIndependentSub") },
  ]
  const contLabel = continuityItems.find((c) => c.value === continuity)?.name ?? continuity

  // Feasible scene-count range for the (possibly edited) duration.
  const sceneMin = Math.ceil(s.totalDuration / SCENE_MAX_S)
  const sceneMax = Math.max(1, Math.floor(s.totalDuration / SCENE_MIN_S))
  const sceneOptions = Array.from({ length: sceneMax - sceneMin + 1 }, (_, i) => sceneMin + i)
  const currentSceneCount = s.targetSceneCount ?? s.scenes.length

  // Structural edits (idea, concept, duration, ratio, scene count) need a
  // re-plan; models/quality/audio/bible apply forward without one.
  const b = s.planBaseline
  const dirty =
    !!b &&
    (s.prompt !== b.prompt ||
      s.story !== b.story ||
      s.totalDuration !== b.totalDuration ||
      s.aspectRatio !== b.aspectRatio ||
      currentSceneCount !== b.sceneCount)

  const [regenning, setRegenning] = React.useState(false)
  const doRegenerate = async () => {
    setRegenning(true)
    try {
      await actions.regeneratePlan()
      onGoStoryboard()
    } catch {
      // error toast already shown by the engine
    } finally {
      setRegenning(false)
    }
  }

  const settingCard = (label: string, control: React.ReactNode) => (
    <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] px-3 py-2.5 flex flex-col gap-1.5">
      <div className="pos-mono text-[9.5px] uppercase tracking-[.06em] text-[var(--pos-t3)]">{label}</div>
      {control}
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--pos-base)]">
      {/* Scrollable content — the action footer below stays pinned. */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-[760px] mx-auto px-8 py-8 flex flex-col gap-5">
          {/* Idea — the brief itself, editable */}
          <div>
            <SectionLabel className="mb-2">{t("briefIdea")}</SectionLabel>
            <textarea
              value={s.prompt}
              onChange={(e) => actions.patchSession({ prompt: e.target.value })}
              rows={3}
              className="w-full resize-none bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-4 text-[15px] leading-relaxed text-[var(--pos-t1)] outline-none focus:border-[var(--pos-vio)]"
            />
          </div>

          {/* Concept — what the planner made of it, editable */}
          <div>
            <SectionLabel className="mb-2">{t("briefConcept")}</SectionLabel>
            <textarea
              value={s.story}
              onChange={(e) => actions.patchSession({ story: e.target.value })}
              rows={5}
              className="w-full resize-none bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-4 text-[13px] leading-relaxed text-[var(--pos-t2)] outline-none focus:border-[var(--pos-vio)] focus:text-[var(--pos-t1)]"
            />
          </div>

          {/* Settings — models/continuity/quality/audio editable; duration
              and ratio locked (the scenes were planned to them). */}
          <div>
            <SectionLabel className="mb-2">{t("briefSettings")}</SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {settingCard(
                t("duration"),
                <DropChip
                  label={`${s.totalDuration}s`}
                  value={String(s.totalDuration)}
                  onPick={(v) => actions.patchSession({ totalDuration: parseInt(v, 10) })}
                  items={DURATIONS.map((d) => ({ value: String(d), name: `${d}s` }))}
                  menuWidth={160}
                />,
              )}
              {settingCard(
                t("ratio"),
                <DropChip
                  label={s.aspectRatio}
                  value={s.aspectRatio}
                  onPick={(v) => actions.patchSession({ aspectRatio: v })}
                  items={[
                    { value: "16:9", name: "16:9", sub: "landscape" },
                    { value: "9:16", name: "9:16", sub: "Reels / Shorts" },
                    { value: "1:1", name: "1:1", sub: "square" },
                  ]}
                  menuWidth={200}
                />,
              )}
              {settingCard(
                t("beatMap"),
                <DropChip
                  label={String(currentSceneCount)}
                  value={String(currentSceneCount)}
                  onPick={(v) => actions.patchSession({ targetSceneCount: parseInt(v, 10) })}
                  items={sceneOptions.map((n) => ({ value: String(n), name: String(n) }))}
                  menuWidth={140}
                />,
              )}
              {settingCard(
                t("llmModel"),
                <DropChip
                  label={`✦ ${llmLabel(s.llmModel ?? DEFAULT_LLM)}`}
                  value={s.llmModel ?? DEFAULT_LLM}
                  onPick={(v) => actions.patchSession({ llmModel: v as StoryLlm })}
                  items={storyLlmModels.map((m) => ({
                    value: m.value,
                    name: `${m.label} ${m.version}`.trim(),
                  }))}
                  menuWidth={220}
                />,
              )}
              {settingCard(
                t("imageModel"),
                <DropChip
                  label={imgLabel ? `${imgLabel.label} ${imgLabel.version}`.trim() : s.imageModel}
                  value={s.imageModel}
                  onPick={(v) => actions.patchSession({ imageModel: v })}
                  items={availableImageModels.map((m) => ({
                    value: m.value,
                    name: `${m.label} ${m.version}`.trim(),
                    sub: m.description,
                  }))}
                  menuWidth={270}
                />,
              )}
              {settingCard(
                t("videoModel"),
                <DropChip
                  label={vidLabel ? `${vidLabel.label} ${vidLabel.version}`.trim() : s.videoModel}
                  value={s.videoModel}
                  onPick={(v) => actions.patchSession({ videoModel: v })}
                  items={storyVideoModels.map((m) => ({
                    value: m.value,
                    name: `${m.label} ${m.version}`.trim(),
                    sub: m.description,
                  }))}
                  menuWidth={270}
                />,
              )}
              {settingCard(
                t("continuity"),
                <DropChip
                  label={contLabel}
                  value={continuity}
                  onPick={(v) => actions.patchSession({ continuity: v as StoryContinuity })}
                  items={continuityItems}
                  menuWidth={270}
                />,
              )}
              {settingCard(
                t("quality"),
                <DropChip
                  label={s.quality ?? "auto"}
                  value={s.quality ?? "1080p"}
                  onPick={(v) => actions.patchSession({ quality: v })}
                  items={[
                    { value: "720p", name: "720p", sub: t("quality720Sub") },
                    { value: "1080p", name: "1080p", sub: t("quality1080Sub") },
                  ]}
                  menuWidth={200}
                />,
              )}
              {settingCard(
                t("audio"),
                <DropChip
                  label={audioLabel(s.audio ?? "generated", t)}
                  value={s.audio ?? "generated"}
                  onPick={(v) => {
                    const mode = v as AudioMode
                    if (mode === "generated" || mode === "silent") {
                      actions.patchSession({ audio: mode })
                    } else {
                      // Music/voiceover modes always open the settings dialog
                      // first — re-picking the already-active one doubles as
                      // "edit its settings".
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
                />,
              )}
              {audioSettingsMode && (
                <AudioSettingsDialog
                  open
                  onOpenChange={(o) => !o && setAudioSettingsMode(null)}
                  mode={audioSettingsMode}
                  initial={{
                    musicPrompt: s.musicPrompt ?? "",
                    narrationText: s.narrationText ?? "",
                    narrationVoiceId: s.narrationVoiceId ?? "",
                    narrationLanguage: s.narrationLanguage ?? DEFAULT_NARRATION_LANGUAGE,
                    captionsEnabled: s.captionsEnabled ?? true,
                  }}
                  onSave={(v) => {
                    actions.patchSession({
                      audio: audioSettingsMode,
                      musicPrompt: v.musicPrompt.trim() || undefined,
                      narrationText: v.narrationText.trim() || undefined,
                      narrationVoiceId: v.narrationVoiceId || undefined,
                      narrationLanguage: v.narrationLanguage,
                      captionsEnabled: v.captionsEnabled,
                    })
                    setAudioSettingsMode(null)
                  }}
                />
              )}
            </div>
          </div>

          {/* Mood & style — the production design, editable per field */}
          <div>
            <SectionLabel className="mb-2">{t("styleBible")}</SectionLabel>
            <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-4 flex flex-col gap-3">
              {BIBLE_FIELDS.map((k) => (
                <div key={k}>
                  <div className="pos-mono uppercase text-[10px] text-[var(--pos-vioT)] mb-1">{k}</div>
                  <AutoTextarea
                    value={s.bible?.[k] ?? ""}
                    onChange={(v) => actions.patchSession({ bible: { ...s.bible, [k]: v } })}
                    minRows={2}
                    className="w-full bg-[var(--pos-s3)] border border-[var(--pos-b1)] rounded-[6px] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--pos-t2)] outline-none focus:border-[var(--pos-vio)] focus:text-[var(--pos-t1)]"
                  />
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--pos-t3)]">
            {dirty ? t("briefRegenHint") : t("briefEditNote")}
          </p>

          {/* Cast references — always shown (even with none yet) so there's
              always a way to add one here; upload/remove apply immediately,
              no regenerate required to take effect on future generations. */}
          <div>
            <SectionLabel className="mb-2">{t("references")}</SectionLabel>
            <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex flex-wrap items-center gap-2">
              {(s.references ?? []).map((r) => (
                <div key={r.index} className="relative group/ref w-14 shrink-0">
                  {r.analyzing ? (
                    <div className="size-14 rounded-[6px] bg-[var(--pos-s3)] pos-pulse border border-[var(--pos-b2)]" />
                  ) : (
                    <img
                      src={r.previewUrl ?? r.url}
                      alt={r.name ?? ""}
                      onClick={() =>
                        enlarge(r.previewUrl ?? r.url, r.name, {
                          title: r.name,
                          kind: r.kind,
                          description: r.description,
                        })
                      }
                      title={r.description || t("viewLarge")}
                      className="size-14 object-cover rounded-[6px] border border-[var(--pos-b2)] cursor-zoom-in"
                    />
                  )}
                  {!r.analyzing && (
                    <button
                      type="button"
                      onClick={() => actions.removeReference(r.index)}
                      title={t("remove")}
                      className="absolute -top-1 -right-1 z-10 size-4 rounded-full bg-black/70 hover:bg-black text-white hidden group-hover/ref:flex items-center justify-center cursor-pointer"
                    >
                      <IconX className="size-2.5" />
                    </button>
                  )}
                  <span className="block mt-0.5 text-[9px] text-[var(--pos-t3)] text-center truncate w-14">
                    {r.analyzing ? t("stRendering") : r.name}
                  </span>
                </div>
              ))}
              <input
                ref={refFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  for (const f of Array.from(e.target.files ?? [])) void actions.addReference(f)
                  e.target.value = ""
                }}
              />
              {!refsAtCap && (
                <button
                  type="button"
                  onClick={() => refFileRef.current?.click()}
                  title={`${t("addReference")} (${t("refsMaxReached", { n: MAX_INPUT_REFS })})`}
                  className="size-14 shrink-0 rounded-[6px] border border-dashed border-[var(--pos-b2)] flex items-center justify-center text-[var(--pos-t3)] hover:text-[var(--pos-t1)] hover:border-[var(--pos-b3)] cursor-pointer transition-colors"
                >
                  <IconPlus className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions — pinned footer, always visible regardless of scroll. When
          structural fields changed, the primary CTA becomes "Regenerate". */}
      <div className="shrink-0 border-t border-[var(--pos-b1)] bg-[var(--pos-base)]">
        <div className="max-w-[760px] mx-auto px-8 py-3.5 flex items-center justify-center gap-2">
          {dirty ? (
            <PrimaryBtn disabled={regenning} onClick={doRegenerate}>
              <span className="inline-flex items-center gap-1.5">
                {regenning ? (
                  <>
                    <IconLoader2 className="size-3.5 pltt-animate-spin" /> {t("briefRegenerating")}
                  </>
                ) : (
                  <>
                    <IconRefresh className="size-3.5" /> {t("briefRegenerate")}
                  </>
                )}
              </span>
            </PrimaryBtn>
          ) : (
            <PrimaryBtn onClick={onGoStoryboard}>
              <span className="inline-flex items-center gap-1.5">
                {t("stepStoryboard")} <IconArrowRight className="size-3.5" />
              </span>
            </PrimaryBtn>
          )}
          <GhostBtn onClick={onReuse} title={t("briefReuseHint")}>
            <span className="inline-flex items-center gap-1.5">
              <IconCopy className="size-3" /> {t("briefReuse")}
            </span>
          </GhostBtn>
        </div>
      </div>
    </div>
  )
}
