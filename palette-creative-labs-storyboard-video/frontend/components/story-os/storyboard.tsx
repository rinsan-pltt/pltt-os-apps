"use client"

// Storyboard stage — covers session steps "plan" and "images".
// Layout: scene rail · panel grid · inspector (prompt editor + context).

import * as React from "react"
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconDotsVertical,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import type { StorySession, StoryScene } from "@/components/providers/story-video-context"
import { apiRequest } from "@/lib/api-helper"
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
import { usePosT } from "./i18n"
import { DropChip, GhostBtn, PrimaryBtn, ProgressBar, SectionLabel, Seg, aspectStyle } from "./ui"
import {
  DEFAULT_LLM,
  isSceneStale,
  MAX_INPUT_REFS,
  masterImageUrls,
  runTitle,
  storyImageModels,
  type SessionActions,
} from "./engine"
import { SceneChat, type SceneChatReply } from "./scene-chat"
import { useLightbox } from "./image-lightbox"

function SceneTile({
  scene,
  session,
  selected,
  onSelect,
  onDelete,
  canDelete,
}: {
  scene: StoryScene
  session: StorySession
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  const { t } = usePosT()
  const enlarge = useLightbox()
  const generating = scene.imageStatus === "generating"
  const stale = isSceneStale(session, scene)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  return (
    <>
    <div
      onClick={onSelect}
      className="group/tile cursor-pointer rounded-lg overflow-hidden border transition-colors bg-[var(--pos-s1)]"
      style={{
        borderColor: selected ? "var(--pos-vioB)" : "var(--pos-b1)",
        boxShadow: selected ? "0 0 0 1px var(--pos-vioB)" : undefined,
      }}
    >
      <div className="relative pos-stripes" style={aspectStyle(session.aspectRatio)}>
        {scene.imageUrl && (
          <img src={scene.imageUrl} alt={scene.title} className="absolute inset-0 size-full object-cover" />
        )}
        {/* Enlarge a generated image (tile click still selects the scene). */}
        {scene.imageUrl && !generating && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              const gallery = session.scenes
                .filter((s) => !!s.imageUrl)
                .map((s) => ({ url: s.imageUrl!, alt: s.title }))
              enlarge(scene.imageUrl!, scene.title, undefined, gallery)
            }}
            title={t("viewLarge")}
            className="absolute top-1.5 left-1.5 z-10 size-6 rounded-[6px] bg-black/55 hover:bg-black/80 text-white/90 hover:text-white items-center justify-center hidden group-hover/tile:flex cursor-pointer"
          >
            <IconArrowsMaximize className="size-3.5" />
          </button>
        )}
        {/* Per-scene menu — three dots on hover, "Delete" with a confirm. */}
        <div className="absolute top-1.5 right-1.5 z-20 hidden group-hover/tile:block">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            title={t("sceneOptions")}
            className="size-6 rounded-[6px] bg-black/55 hover:bg-black/80 text-white/90 hover:text-white flex items-center justify-center cursor-pointer"
          >
            <IconDotsVertical className="size-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} />
              <div
                className="absolute top-[calc(100%+4px)] right-0 z-40 bg-[var(--pos-s2)] border border-[var(--pos-b2)] rounded-[8px] p-[4px] shadow-[0_16px_48px_rgba(0,0,0,.45)] whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  disabled={!canDelete}
                  title={canDelete ? undefined : t("cantDeleteLastScene")}
                  onClick={() => {
                    setMenuOpen(false)
                    if (!canDelete) return
                    setConfirmOpen(true)
                  }}
                  className="w-full flex items-center gap-1.5 rounded-[6px] px-2.5 py-[7px] text-xs font-medium text-[var(--pos-red)] hover:bg-[var(--pos-s3)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <IconTrash className="size-3.5" /> {t("deleteScene")}
                </button>
              </div>
            </>
          )}
        </div>
        {generating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
            <span className="pos-mono text-[10px] uppercase tracking-widest text-white/90 pos-pulse">
              {t("stRendering")}
            </span>
          </div>
        ) : scene.imageStatus === "failed" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <IconAlertTriangle className="size-5 text-[var(--pos-red)]" strokeWidth={1.5} />
          </div>
        ) : null}
        {/* Passive badge: the prompt changed since this image was generated
            — regenerate the board to apply (no per-scene generation). */}
        {stale && !generating && (
          <span
            title={t("promptStale")}
            className="absolute bottom-1.5 right-1.5 flex items-center gap-1 pos-mono text-[9px] px-1.5 py-[3px] rounded-[6px] text-white"
            style={{ background: "rgba(255,92,56,.9)" }}
          >
            {t("promptStaleShort")}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span
          className="pos-mono text-[10px] font-medium truncate"
          style={{ color: selected ? "var(--pos-vioT)" : "var(--pos-t3)" }}
        >
          {String(scene.index + 1).padStart(2, "0")} · {scene.title}
        </span>
        <span className="pos-mono text-[10px] text-[var(--pos-t3)] shrink-0">{scene.duration}s</span>
      </div>
    </div>
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="uppercase tracking-widest text-sm">{t("deleteSceneTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deleteSceneConfirm")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("deleteScene")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

export function StoryboardScreen({
  session,
  actions,
  sel,
  setSel,
  writingPrompts,
  promptsFailed,
  canGoAnimate,
  onGoAnimate,
  tab,
  onTabChange,
}: {
  session: StorySession
  actions: SessionActions
  sel: number
  setSel: (i: number) => void
  writingPrompts: boolean
  promptsFailed: boolean
  // Forward navigation — enabled once the run has reached the Animate stage
  // (motion prompts exist); before that there is nothing to show there.
  canGoAnimate: boolean
  onGoAnimate: () => void
  // Inspector mode: edit the prompt directly, or talk to the agent — one at a
  // time, never both open together. Lifted to the URL (see app.tsx's `view`)
  // so refreshing on the Agent tab stays on the Agent tab, same for Prompt.
  tab: "prompt" | "agent"
  onTabChange: (t: "prompt" | "agent") => void
}) {
  const { t } = usePosT()
  const enlarge = useLightbox()
  const scene = session.scenes.find((s) => s.index === sel) ?? session.scenes[0]
  const isPlan = session.step === "plan"
  const imagesDone = session.scenes.filter((s) => s.imageStatus === "completed").length
  const imagesGenerating = session.scenes.some((s) => s.imageStatus === "generating")
  const anyImageFailed = session.scenes.some((s) => s.imageStatus === "failed")
  const hasStaleScenes = session.scenes.some((s) => isSceneStale(session, s))
  const anchorGenerating = (session.masterImages ?? []).some((m) => m.status === "generating")
  const masterFileRef = React.useRef<HTMLInputElement>(null)
  const refFileRef = React.useRef<HTMLInputElement>(null)

  const hasReferences = (session.references?.length ?? 0) > 0
  const refsAtCap = (session.references?.length ?? 0) >= MAX_INPUT_REFS
  const anchorAtCap = (session.masterImages?.length ?? 0) >= MAX_INPUT_REFS
  const anchored = hasReferences || masterImageUrls(session).length > 0
  const availableImageModels = anchored ? storyImageModels.filter((m) => m.reference) : storyImageModels
  const imgLabel = storyImageModels.find((m) => m.value === session.imageModel)

  // A scene is a valid chain anchor once it actually has a finished image —
  // "generating"/"failed"/never-started all leave nothing to hand the next
  // scene as its reference.
  const hasFinishedImage = (s: StoryScene) => s.imageStatus === "completed" && !!s.imageUrl

  // If the user asks the chat to generate a scene whose PREDECESSORS aren't
  // done yet, we can't just generate that one in isolation — every scene
  // (after the first) is chained from the previous scene's image for visual
  // consistency (see regenerateImage/generateImages in engine.ts). Instead of
  // generating an unanchored image, the chat asks whether to generate the
  // pending scenes first; this ref remembers which scene was actually asked
  // for so a "yes" on the NEXT message can resume the chain there.
  const pendingChainConfirmRef = React.useRef<number | null>(null)
  const isAffirmative = (text: string) =>
    /^\s*(y|yes|yeah|yep|yup|sure|ok(ay)?|go ahead|do it|please( do)?|generate( (them|it|all|the pending( ones)?))?)\s*[.!]?\s*$/i.test(
      text.trim(),
    )

  // An explicit "scene N" / "@Scene 06" reference in the free text names a
  // DIFFERENT scene than whatever's currently selected/open in the
  // inspector. Without this, the vision-grounded image sent to the chat
  // backend would always be the selected scene's — so an edit request aimed
  // at another scene would get judged against the wrong picture. Numbers are
  // as the UI displays them (1-based); only free-text digit references are
  // resolved here — descriptive references ("the one with the umbrella")
  // still rely entirely on the backend's own (text-only) resolution.
  const resolveMentionedScene = (text: string): StoryScene | undefined => {
    const m = text.match(/scene\s*#?\s*0*(\d+)/i)
    if (!m) return undefined
    const displayN = parseInt(m[1], 10)
    if (!Number.isFinite(displayN) || displayN < 1) return undefined
    return session.scenes.find((s) => s.index === displayN - 1)
  }

  // Scene chat: the agent can answer questions about the selected scene's
  // image/prompt, edit a prompt, (re)generate it, or act on ANY other scene
  // the user mentions by number/title/description — the backend resolves
  // which scene from the full list and returns an action the engine already
  // knows how to execute (same pipeline the manual controls use).
  const handleChatSend = React.useCallback(
    async (text: string): Promise<SceneChatReply> => {
      const pendingTarget = pendingChainConfirmRef.current
      if (pendingTarget !== null) {
        pendingChainConfirmRef.current = null
        if (isAffirmative(text)) {
          const order = [...session.scenes].sort((a, b) => a.index - b.index)
          const firstPending = order.find((s) => !hasFinishedImage(s))
          // Re-checked against the CURRENT session (not what it was when the
          // question was asked) in case something else finished a scene in
          // the meantime — falls back to the originally-requested scene if
          // every predecessor turns out to already be done.
          const resumeScene =
            firstPending && firstPending.index < pendingTarget
              ? firstPending
              : (session.scenes.find((s) => s.index === pendingTarget) ?? null)
          if (resumeScene) {
            void actions.regenerateImage(resumeScene)
            setSel(resumeScene.index)
          }
          return {
            reply: t("chatGeneratingPending"),
            note: resumeScene
              ? t("chatJumpedToScene", {
                  n: t("sceneN", { n: String(resumeScene.index + 1).padStart(2, "0") }),
                })
              : undefined,
          }
        }
        // Not an affirmative — fall through and handle this as a normal,
        // unrelated message instead of silently dropping it.
      }

      // Ground the vision context on whichever scene the message is actually
      // about — an explicit "scene N" mention overrides the currently-open
      // one, so an edit aimed at another scene is judged against ITS image.
      const contextScene = resolveMentionedScene(text) ?? scene
      const res = await apiRequest("/story/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          story: session.story,
          bible: session.bible,
          selected_index: contextScene.index,
          selected_image_url: contextScene.imageUrl || undefined,
          scenes: session.scenes.map((s) => ({
            index: s.index,
            title: s.title,
            image_prompt: s.imagePrompt,
            has_image: !!s.imageUrl,
          })),
          llm: session.llmModel ?? DEFAULT_LLM,
        }),
      })
      const targetIndex = typeof res.target_index === "number" ? res.target_index : contextScene.index
      if (res.action === "update_prompt" && res.new_prompt) {
        actions.updateScene(targetIndex, { imagePrompt: res.new_prompt })
      } else if (res.action === "regenerate") {
        const targetScene = session.scenes.find((s) => s.index === targetIndex)
        if (targetScene) {
          const override =
            typeof res.new_prompt === "string" && res.new_prompt.trim() ? res.new_prompt : undefined
          // Persist a prompt override up front — if the chain has to resume
          // from an earlier pending scene below, this scene's own imagePrompt
          // (read live once the chain reaches it) already reflects it.
          if (override) actions.updateScene(targetIndex, { imagePrompt: override })
          const order = [...session.scenes].sort((a, b) => a.index - b.index)
          const firstPending = order.find((s) => !hasFinishedImage(s))
          if (firstPending && firstPending.index < targetScene.index) {
            pendingChainConfirmRef.current = targetScene.index
            return {
              reply: t("chatNeedsPrevScenes", {
                n: t("sceneN", { n: String(targetScene.index + 1).padStart(2, "0") }),
              }),
            }
          }
          void actions.regenerateImage(targetScene)
        }
      } else if (res.action === "generate_all") {
        void actions.generateImages()
      }
      let note: string | undefined
      if (
        targetIndex !== scene.index &&
        (res.action === "update_prompt" || res.action === "regenerate") &&
        session.scenes.some((s) => s.index === targetIndex)
      ) {
        setSel(targetIndex)
        note = t("chatJumpedToScene", { n: t("sceneN", { n: String(targetIndex + 1).padStart(2, "0") }) })
      }
      return { reply: res.reply || "", note }
    },
    [session, scene, actions, setSel, t],
  )

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
    <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "230px 1fr 320px" }}>
      {/* ── Scene rail ── */}
      <div className="border-r border-[var(--pos-b1)] bg-[var(--pos-s1)] px-2.5 py-3 flex flex-col gap-1 overflow-y-auto">
        <div className="flex items-baseline justify-between px-1 pb-1.5">
          <span className="text-xs font-semibold text-[var(--pos-t1)]">{t("beatMap")}</span>
          <span className="pos-mono text-[9.5px] text-[var(--pos-t3)]">
            {session.scenes.length} · {session.totalDuration}s
          </span>
        </div>
        {session.scenes.map((s) => (
          <button
            key={s.index}
            type="button"
            onClick={() => setSel(s.index)}
            className="text-left flex gap-2 items-start rounded-[6px] px-2 py-2 cursor-pointer border transition-colors hover:bg-[var(--pos-s3)]"
            style={{
              background: s.index === scene.index ? "var(--pos-s3)" : "transparent",
              borderColor: s.index === scene.index ? "var(--pos-vioB)" : "transparent",
            }}
          >
            <span
              className="pos-mono text-[11px] font-medium pt-px shrink-0"
              style={{ color: s.index === scene.index ? "var(--pos-vioT)" : "var(--pos-t3)" }}
            >
              {String(s.index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="block text-[11.5px] font-medium text-[var(--pos-t1)] truncate">{s.title}</span>
              <span className="block text-[10.5px] leading-snug text-[var(--pos-t2)] line-clamp-2">
                {s.imagePrompt}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* ── Panel grid ── */}
      <div className="flex flex-col min-w-0 bg-[var(--pos-base)]">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--pos-b1)]">
          <span
            className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--pos-t1)] truncate"
            title={session.prompt}
          >
            {runTitle(session)}
          </span>
          <span className="pos-mono text-[10.5px] text-[var(--pos-t3)] whitespace-nowrap">
            {t("scenesN", { n: session.scenes.length })} · {session.totalDuration}s · {session.aspectRatio}
          </span>
        </div>
        {/* Style anchor — governs every scene; sits just below the heading.
            Text-only stories on the plan step only. */}
        {!hasReferences && session.masterPrompt && isPlan && (
          <div className="px-5 pt-4">
            <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <SectionLabel className="mb-1">{t("masterRef")}</SectionLabel>
                <p className="text-[11px] leading-snug text-[var(--pos-t2)]">{t("masterRefHint")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(session.masterImages ?? []).map((m) => (
                  <div key={m.id} className="relative group/anchor size-14 shrink-0">
                    {m.status === "completed" && m.url ? (
                      <img
                        src={m.url}
                        alt=""
                        onClick={() => enlarge(m.url!, t("masterRef"))}
                        title={t("viewLarge")}
                        className="size-full object-cover rounded-[6px] border border-[var(--pos-b2)] cursor-zoom-in"
                      />
                    ) : m.status === "generating" ? (
                      <div className="size-full rounded-[6px] bg-[var(--pos-s3)] pos-pulse" />
                    ) : (
                      <div
                        className="size-full rounded-[6px] border border-dashed flex items-center justify-center"
                        style={{ borderColor: "rgba(240,82,77,.5)" }}
                        title={t("masterFailed")}
                      >
                        <IconAlertTriangle className="size-4 text-[var(--pos-red)] opacity-70" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => actions.removeMasterImage(m.id)}
                      className="absolute -top-1 -right-1 z-10 size-4 rounded-full bg-black/70 hover:bg-black text-white hidden group-hover/anchor:flex items-center justify-center cursor-pointer"
                    >
                      <IconX className="size-2.5" />
                    </button>
                  </div>
                ))}
                <input
                  ref={masterFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void actions.uploadMasterImage(f)
                    e.target.value = ""
                  }}
                />
                {!anchorAtCap && (
                  <button
                    type="button"
                    onClick={() => masterFileRef.current?.click()}
                    title={`${t("masterUpload")} (${t("refsMaxReached", { n: MAX_INPUT_REFS })})`}
                    className="size-14 shrink-0 rounded-[6px] border border-dashed border-[var(--pos-b2)] flex items-center justify-center text-[var(--pos-t3)] hover:text-[var(--pos-t1)] hover:border-[var(--pos-b3)] cursor-pointer transition-colors"
                  >
                    <IconPlus className="size-4" />
                  </button>
                )}
                <GhostBtn disabled={anchorGenerating || anchorAtCap} onClick={() => void actions.generateMaster()}>
                  {anchorGenerating ? (
                    <span className="inline-flex items-center gap-1.5">
                      <IconLoader2 className="size-3 pltt-animate-spin" /> {t("stRendering")}…
                    </span>
                  ) : (
                    <>✦ {t("masterGenerate")}</>
                  )}
                </GhostBtn>
              </div>
            </div>
          </div>
        )}
        {/* References — the run's cast, shown in the same top position as the
            style anchor, with add/remove. Regenerate to apply changes. */}
        {hasReferences && (
          <div className="px-5 pt-4">
            <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <SectionLabel className="mb-1">{t("references")}</SectionLabel>
                <p className="text-[11px] leading-snug text-[var(--pos-t2)]">{t("referencesHint")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(session.references ?? []).map((r) => (
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
        )}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {session.scenes.map((s) => (
              <SceneTile
                key={s.index}
                scene={s}
                session={session}
                selected={s.index === scene.index}
                onSelect={() => setSel(s.index)}
                canDelete={session.scenes.length > 1}
                onDelete={() => {
                  actions.deleteScene(s.index)
                  // Remaining scenes are re-indexed to 0..N-2 — if the one
                  // just removed was selected, land on whatever now sits at
                  // (or nearest to) that same position instead of an index
                  // that no longer exists.
                  if (s.index === scene.index) {
                    setSel(Math.max(0, Math.min(s.index, session.scenes.length - 2)))
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Inspector ── */}
      <div className="border-l border-[var(--pos-b1)] bg-[var(--pos-s2)] flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3.5">
          {/* Selected panel — grows to use whatever inspector height is free,
              so long prompts show without scrolling when space allows. */}
          <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex-1 min-h-0 flex flex-col">
            <div className="flex justify-between items-baseline mb-2">
              <span className="pos-mono text-[11px] font-medium text-[var(--pos-vioT)]">
                {t("sceneN", { n: String(scene.index + 1).padStart(2, "0") })}
              </span>
              <span className="pos-mono text-[10px] text-[var(--pos-t3)]">{scene.duration}s</span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-xs font-medium text-[var(--pos-t1)] truncate">{scene.title}</span>
              <Seg
                value={tab}
                onChange={onTabChange}
                options={[
                  { value: "prompt", label: t("tabPrompt") },
                  { value: "agent", label: t("tabChat") },
                ]}
              />
            </div>
            {/* Image model — visible in both Prompt and Chat (sits above the
                tab content, not inside either branch) so it can still be
                changed after the initial generation, not just from the plan
                step's footer. Regenerating (the footer button, or a chat
                "regenerate" request) always uses whatever's picked here. */}
            {!isPlan && (
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <SectionLabel>{t("imageModel")}</SectionLabel>
                <DropChip
                  label={`◇ ${imgLabel ? `${imgLabel.label} ${imgLabel.version}`.trim() : session.imageModel}`}
                  value={session.imageModel}
                  onPick={(v) => actions.patchSession({ imageModel: v })}
                  items={availableImageModels.map((m) => ({
                    value: m.value,
                    name: `${m.label} ${m.version}`.trim(),
                    sub: m.description,
                  }))}
                  menuWidth={270}
                  align="right"
                />
              </div>
            )}
            {tab === "prompt" ? (
              <>
                <SectionLabel className="mb-1">
                  {t("imagePromptLabel")}
                  <span className="normal-case tracking-normal text-[var(--pos-t4)]"> — {t("imagePromptHint")}</span>
                </SectionLabel>
                <textarea
                  value={scene.imagePrompt}
                  onChange={(e) => actions.updateScene(scene.index, { imagePrompt: e.target.value })}
                  rows={7}
                  className="w-full flex-1 min-h-[140px] resize-none text-xs leading-relaxed text-[var(--pos-t1)] bg-[var(--pos-s3)] border border-[var(--pos-b2)] rounded-[6px] p-2.5 outline-none focus:border-[var(--pos-vio)]"
                />
                {scene.imageError && (
                  <p className="text-[11px] text-[var(--pos-red)] mt-1.5 line-clamp-2" title={scene.imageError}>
                    {scene.imageError}
                  </p>
                )}
                {/* Passive nudge: images generate as one consistent chain, so
                    edits (or a model switch) apply on the next full
                    (re)generation. */}
                {isSceneStale(session, scene) && (
                  <p className="flex items-center gap-1.5 text-[11px] text-[var(--pos-orgT)] mt-1.5">
                    <IconRefresh className="size-3 shrink-0" /> {t("promptStale")}
                  </p>
                )}
              </>
            ) : (
              <SceneChat
                accent="vio"
                title={t("chatTitleSB")}
                context={`@${t("sceneN", { n: String(scene.index + 1).padStart(2, "0") })}`}
                hasContent={hasFinishedImage(scene)}
                messages={session.storyboardChatMessages ?? []}
                onMessagesChange={(msgs) => actions.patchSession({ storyboardChatMessages: msgs })}
                onSend={handleChatSend}
                llmModel={session.llmModel ?? DEFAULT_LLM}
                onLlmChange={(v) => actions.patchSession({ llmModel: v })}
                scenes={session.scenes.map((s) => ({ index: s.index, title: s.title }))}
                onMentionSelect={setSel}
              />
            )}
          </div>

        </div>

        {/* CTA footer */}
        <div className="border-t border-[var(--pos-b1)] p-3.5 flex flex-col gap-2.5">
          {isPlan ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>{t("imageModel")}</SectionLabel>
                <DropChip
                  label={`◇ ${imgLabel ? `${imgLabel.label} ${imgLabel.version}`.trim() : session.imageModel}`}
                  value={session.imageModel}
                  onPick={(v) => actions.patchSession({ imageModel: v })}
                  items={availableImageModels.map((m) => ({
                    value: m.value,
                    name: `${m.label} ${m.version}`.trim(),
                    sub: m.description,
                  }))}
                  menuWidth={270}
                  align="right"
                />
              </div>
              {/* One sequential chain — each scene generated from the
                  previous one's image for consistency. */}
              <PrimaryBtn
                className="w-full"
                disabled={
                  anchorGenerating ||
                  session.scenes.some((s) => !s.imagePrompt.trim()) ||
                  imagesGenerating
                }
                onClick={() => void actions.generateImages()}
              >
                ➤ {t("generateImages", { n: session.scenes.length })}
              </PrimaryBtn>
            </>
          ) : (
            <>
              {/* Progress only while something is actually running/failed —
                  no permanent status block once images are done. */}
              {writingPrompts && <span className="text-xs pos-shimmer-text">{t("writingPrompts")}</span>}
              {imagesGenerating && (
                <>
                  <span className="text-xs text-[var(--pos-t2)]">
                    {t("imagesProgress", { done: imagesDone, total: session.scenes.length })}
                  </span>
                  <ProgressBar pct={(imagesDone / Math.max(1, session.scenes.length)) * 100} accent="vio" />
                </>
              )}
              {anyImageFailed && <span className="text-[11px] text-[var(--pos-red)]">{t("imageFailedHint")}</span>}
              {/* Only enabled once a prompt edit has actually gone un-applied
                  (isSceneStale) — and only regenerates THOSE scenes, leaving
                  every unchanged one exactly as it is. */}
              {!imagesGenerating && !writingPrompts && (
                <GhostBtn
                  className="w-full"
                  disabled={!hasStaleScenes}
                  title={hasStaleScenes ? undefined : t("regenerateNoChanges")}
                  onClick={() => void actions.regenerateStaleImages()}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <IconRefresh className="size-3" /> {t("regenerateChangedImages")}
                  </span>
                </GhostBtn>
              )}
              {promptsFailed && (
                <GhostBtn onClick={() => void actions.generateVideoPrompts()}>
                  <span className="inline-flex items-center gap-1.5">
                    <IconRefresh className="size-3" /> {t("writePromptsRetry")}
                  </span>
                </GhostBtn>
              )}
            </>
          )}
          <GhostBtn
            className="w-full"
            disabled={!canGoAnimate}
            onClick={onGoAnimate}
            title={canGoAnimate ? t("toAnimate") : t("toAnimateLocked")}
          >
            {t("toAnimate")} →
          </GhostBtn>
        </div>
      </div>
    </div>
  )
}
