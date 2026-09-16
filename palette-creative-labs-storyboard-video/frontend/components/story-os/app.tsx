"use client"

// Palette OS story app — the single-flow UI: Home → Storyboard → Animate →
// Publish, plus Library. One client-side state machine (no routing), one SSE
// pair (image + video channels on the user's own channel), one engine.

import * as React from "react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/providers/theme-provider"
import { toast } from "@/components/ui/sonner"
import { useGenerationEvents, type GenerationItem } from "@/hooks/useGenerationEvents"
import { useSharedGenerationEvents } from "@/components/providers/generation-events-context"
import type { StorySession } from "@/components/providers/story-video-context"
import { PosI18nProvider, usePosT } from "./i18n"
import { Dot, GhostBtn } from "./ui"
import {
  allClipsDone,
  STAGE_ORDER,
  STATUS_RANK,
  reachedStage,
  runTitle,
  stageIndex,
  useStoryEngine,
  type RunStage,
} from "./engine"
import { LightboxProvider } from "./image-lightbox"
import { usePlttCreativeVideoPortalContainer } from "@/components/ui/app-portal"
import { HomeScreen } from "./home"
import { BriefScreen } from "./brief"
import { StoryboardScreen } from "./storyboard"
import { AnimateScreen } from "./animate"
import { PublishScreen } from "./publish"
import { LibraryScreen } from "./library"
import { BrandKitScreen, type BrandKitUseRef } from "./brand-kit"
import { useYoutubeOAuthReturn } from "./youtube-publish"
import { useInstagramOAuthReturn } from "./instagram-publish"
import { useTiktokOAuthReturn } from "./tiktok-publish"

// "brief" is a run-scoped view like the stages, but sits before them and is
// always reachable — it shows the run's concept rather than pipeline work.
type RunView = RunStage | "brief"
// Storyboard/Animate's inspector rail (prompt editor vs. scene chat) — kept
// in the URL alongside the stage so a refresh lands back on whichever one
// was open, not always the Prompt tab.
type InspectorTab = "prompt" | "agent"
const INSPECTOR_TABS: readonly InspectorTab[] = ["prompt", "agent"]
type View =
  | { kind: "home" }
  | { kind: "library" }
  | { kind: "brandkit" }
  // `tab` only matters for storyboard/animate (their inspector rail); every
  // other transition can omit it and the reader below defaults to "prompt".
  | { kind: "run"; sessionId: string; stage: RunView; tab?: InspectorTab }

const RUN_VIEWS: readonly RunView[] = ["brief", "storyboard", "animate", "publish"]

// The app is served as one bundle at a single fixed path (no server-side
// routing to a plugin-owned sub-path — see social_publish.py's OAuth-redirect
// note for why), so "a URL per page" is done as query params on that one
// path rather than distinct routes: refresh re-reads them, and every view
// change below rewrites them via history.replaceState (no back-button
// history entries — auto-advancing through pipeline stages during
// generation would otherwise spam Back with every automatic step).
function parseViewFromUrl(): View {
  if (typeof window === "undefined") return { kind: "home" }
  const params = new URLSearchParams(window.location.search)
  const kind = params.get("view")
  if (kind === "library") return { kind: "library" }
  if (kind === "brandkit") return { kind: "brandkit" }
  if (kind === "run") {
    const sessionId = params.get("session")
    const stage = params.get("stage")
    const tab = params.get("tab")
    if (sessionId && (RUN_VIEWS as string[]).includes(stage ?? "")) {
      return {
        kind: "run",
        sessionId,
        stage: stage as RunView,
        tab: (INSPECTOR_TABS as string[]).includes(tab ?? "") ? (tab as InspectorTab) : "prompt",
      }
    }
  }
  return { kind: "home" }
}

function viewToSearch(view: View): string {
  const params = new URLSearchParams()
  if (view.kind === "library") {
    params.set("view", "library")
  } else if (view.kind === "brandkit") {
    params.set("view", "brandkit")
  } else if (view.kind === "run") {
    params.set("view", "run")
    params.set("session", view.sessionId)
    params.set("stage", view.stage)
    if (view.stage === "storyboard" || view.stage === "animate") {
      params.set("tab", view.tab ?? "prompt")
    }
  }
  return params.toString()
}

function StoryAppInner() {
  const { t } = usePosT()

  // Single source of truth for light/dark — shared with the plugin root
  // (AppThemeRoot in layout.tsx) via ThemeProvider, so this drives both the
  // `--pltt*`-based shadcn primitives (dialogs, toasts, etc.) and the
  // `--pos-*` tokens below instead of each half of the UI tracking its own
  // theme. Controlled by the OS only — see theme-provider.tsx.
  const { theme } = useTheme()

  // Popovers/dialogs render into the OS-level shared portal root (see
  // app-portal.ts) so they're never clipped by this app's own scrollable
  // panels — but that container is a SIBLING of .pos-root in the DOM, not a
  // descendant, so .pos-root's --pos-* theme variables don't cascade into
  // it. Mirroring data-pos-theme onto the container itself (globals.css
  // matches the same attribute there) is what lets portaled content resolve
  // the same tokens as the rest of the app instead of falling back to
  // nothing (unreadable text / invisible highlights in either theme).
  const portalContainer = usePlttCreativeVideoPortalContainer()
  React.useEffect(() => {
    portalContainer?.setAttribute("data-pos-theme", theme)
  }, [theme, portalContainer])

  // ---- Live generation items: user-channel SSE, image + video ------------
  const { allItems: imageItems } = useSharedGenerationEvents()
  const { allItems: videoItems } = useGenerationEvents("video")
  const items = React.useMemo(() => {
    const byId = new Map<string, GenerationItem>()
    for (const it of [...imageItems, ...videoItems]) {
      if (!it.id) continue
      const prev = byId.get(it.id)
      if (!prev || (STATUS_RANK[it.status] ?? 0) >= (STATUS_RANK[prev.status] ?? 0)) {
        byId.set(it.id, it)
      }
    }
    return Array.from(byId.values())
  }, [imageItems, videoItems])

  const onError = React.useCallback((title: string, err: unknown) => {
    toast.error(title, {
      description: err instanceof Error ? err.message : err ? String(err) : undefined,
    })
  }, [])

  const engine = useStoryEngine(items, onError)
  const {
    sessions,
    loaded,
    addSession,
    updateSession,
    resyncSession,
    removeSession,
    actionsFor,
    writingPrompts,
    promptsFailed,
  } = engine

  // ---- View state ----------------------------------------------------------
  // Seeded from the URL so a refresh (or a shared link) lands back on the
  // same page instead of always resetting to Home — see parseViewFromUrl.
  const [view, setView] = React.useState<View>(() => parseViewFromUrl())
  const [sel, setSel] = React.useState(0)

  // Keep the URL in sync with every view change (Home clears it entirely).
  React.useEffect(() => {
    const search = viewToSearch(view)
    const url = search ? `${window.location.pathname}?${search}` : window.location.pathname
    window.history.replaceState(window.history.state, "", url)
  }, [view])
  // Set by "Reuse this brief" — Home picks it up as the prompt box content.
  const [homePrefill, setHomePrefill] = React.useState<string | null>(null)
  // Set by Brand Kit's selection bar ("Use N") — Home picks these up as
  // ready references (already categorized, no re-analysis needed). An array
  // so multiple assets picked in one Brand Kit visit arrive together — Home
  // is a fresh mount every time it's navigated to, so round-tripping through
  // Brand Kit once per asset would silently drop everything but the last one.
  const [homePendingRefs, setHomePendingRefs] = React.useState<BrandKitUseRef[] | null>(null)
  const useAssetsAsReference = React.useCallback(
    (refs: BrandKitUseRef[]) => {
      if (refs.length === 0) return
      setHomePendingRefs(refs)
      setView({ kind: "home" })
      toast.success(t("bkUsedToast", { n: refs.length }))
    },
    [t],
  )

  const activeSession: StorySession | null =
    view.kind === "run" ? (sessions.find((s) => s.id === view.sessionId) ?? null) : null

  const openRun = React.useCallback(
    (id: string, stage?: RunStage) => {
      const s = sessions.find((x) => x.id === id)
      setSel(0)
      setView({ kind: "run", sessionId: id, stage: stage ?? (s ? reachedStage(s) : "storyboard") })
    },
    [sessions],
  )

  // YouTube OAuth return: a full-page redirect to Google and back loses all
  // in-memory view state, so this restores whichever run the user was
  // publishing from when they clicked "Connect YouTube".
  useYoutubeOAuthReturn(
    () => toast.success(t("youtubeConnected")),
    onError,
    (sessionId) => openRun(sessionId, "publish"),
  )
  // Same for Instagram and TikTok — see instagram-publish.tsx/tiktok-
  // publish.tsx's module comments for why the three hooks don't collide on
  // the same `?code=` return.
  useInstagramOAuthReturn(
    () => toast.success(t("instagramConnected")),
    onError,
    (sessionId) => openRun(sessionId, "publish"),
  )
  useTiktokOAuthReturn(
    () => toast.success(t("tiktokConnected")),
    onError,
    (sessionId) => openRun(sessionId, "publish"),
  )

  // Re-confirm the active run against the server every time it's (re-)viewed
  // — covers both opening a different run AND switching stage tabs on the
  // SAME run (e.g. Publish → Animate), so a completion the live sync missed
  // while a different stage was on screen shows up without a manual reload.
  React.useEffect(() => {
    if (view.kind === "run") void resyncSession(view.sessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind === "run" ? `${view.sessionId}:${view.stage}` : null])

  // Auto-follow the pipeline forward: when the active run advances to a later
  // stage than the one on screen, move with it (backwards browsing sticks).
  const prevReachedRef = React.useRef<string | null>(null)
  // Tracks which session we've already established a baseline for — a fresh
  // mount (page refresh, or a URL restoring straight into e.g. "storyboard")
  // has an empty prevReachedRef, so without this the very first run below
  // would always look like "the stage just advanced" and force-jump to
  // wherever the run has already reached (often Publish), overriding
  // whatever stage was actually being restored. First encountering a session
  // just records where it's already at; only a stage that advances WHILE
  // already viewing this session auto-follows.
  const seededSessionRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeSession || view.kind !== "run") return
    const reached = reachedStage(activeSession)
    const key = `${activeSession.id}:${reached}`
    if (seededSessionRef.current !== activeSession.id) {
      seededSessionRef.current = activeSession.id
      prevReachedRef.current = key
      return
    }
    if (prevReachedRef.current === key) return
    prevReachedRef.current = key
    // While reading the Brief, stay put — it's outside the pipeline flow.
    if (view.stage === "brief") return
    if (stageIndex(reached) > stageIndex(view.stage)) {
      setView({ kind: "run", sessionId: activeSession.id, stage: reached })
    }
  }, [activeSession, view])

  // A run deleted elsewhere (or restore raced) → fall back home.
  React.useEffect(() => {
    if (view.kind === "run" && loaded && !sessions.some((s) => s.id === view.sessionId)) {
      setView({ kind: "home" })
    }
  }, [view, sessions, loaded])

  // A story finishing planning no longer resolves inline in HomeScreen (the
  // job runs in the background so it survives a refresh — see engine.ts's
  // syncSession/applyPlanResult), so nothing there can any longer decide
  // "should this auto-open now". Watching for the transition here instead:
  // jump to the newly-planned story, but only while still sitting on Home
  // waiting for it — if the user's already gone to look at something else
  // (or into a different run), leave them there instead of yanking them away.
  const wasPlanningRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    const stillPlanning = new Set<string>()
    for (const s of sessions) {
      if (s.planningStatus === "generating") {
        stillPlanning.add(s.id)
        continue
      }
      if (wasPlanningRef.current.has(s.id) && s.planningStatus !== "failed" && view.kind === "home") {
        openRun(s.id, "storyboard")
      }
    }
    wasPlanningRef.current = stillPlanning
  }, [sessions, view.kind, openRun])

  // Confirmation now happens in RunCard's own AlertDialog before this fires
  // (same pattern as scene deletion in the Storyboard) — no second prompt here.
  const deleteRun = (id: string) => {
    removeSession(id)
    if (view.kind === "run" && view.sessionId === id) setView({ kind: "library" })
  }

  // A failed plan (initial "Generate" or a Brief "Regenerate" — either can
  // fail) gets its own retry from wherever it's shown, without needing to
  // open the run first. regeneratePlan re-runs /story/plan from whatever
  // inputs are already on the session (prompt/duration/references/etc),
  // which is exactly what a fresh session that never finished planning has.
  const retryPlan = (id: string) => {
    void actionsFor(id).regeneratePlan().catch(() => {})
  }

  // ---- Toolbar bits --------------------------------------------------------
  const stagePill = activeSession
    ? reachedStage(activeSession) === "storyboard"
      ? { label: t("stageStoryboarding"), color: "var(--pos-vioT)", bg: "var(--pos-vioS)", dot: "var(--pos-vio)" }
      : reachedStage(activeSession) === "animate"
        ? { label: t("stageAnimating"), color: "var(--pos-orgT)", bg: "var(--pos-orgS)", dot: "var(--pos-org)" }
        : activeSession.step === "done"
          ? { label: t("stLive"), color: "var(--pos-grn)", bg: "rgba(62,207,110,.14)", dot: "var(--pos-grn)" }
          : { label: t("stagePublishReady"), color: "var(--pos-orgT)", bg: "var(--pos-orgS)", dot: "var(--pos-org)" }
    : null

  const activeTitle = activeSession ? runTitle(activeSession) : null

  const stepStates = activeSession
    ? STAGE_ORDER.map((stage) => {
        const reachedIdx = stageIndex(reachedStage(activeSession))
        const idx = stageIndex(stage)
        return {
          stage,
          reachable: idx <= reachedIdx,
          current: view.kind === "run" && view.stage === stage,
        }
      })
    : []

  const stageLabel: Record<RunStage, string> = {
    storyboard: t("stepStoryboard"),
    animate: t("stepAnimate"),
    publish: t("stepPublish"),
  }
  // All stepper stage boxes share the storyboard's violet selection accent.
  const VIO_ACCENT = {
    text: "var(--pos-vioT)",
    bg: "var(--pos-vioS)",
    border: "var(--pos-vioB)",
    dot: "var(--pos-vio)",
  }
  const stageAccent: Record<RunStage, { text: string; bg: string; border: string; dot: string }> = {
    storyboard: VIO_ACCENT,
    animate: VIO_ACCENT,
    publish: VIO_ACCENT,
  }

  return (
    <div className="pos-root flex flex-col h-full min-h-0 overflow-hidden" data-pos-theme={theme}>
      {/* ═══ Toolbar ═══ */}
      <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-[var(--pos-b1)]">
        <button
          type="button"
          onClick={() => setView({ kind: "home" })}
          className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--pos-t1)] cursor-pointer whitespace-nowrap"
        >
          {t("appName")}
        </button>
        {activeSession && (
          <>
            <span className="text-xs text-[var(--pos-t4)]">/</span>
            <span
              className="text-[12.5px] font-medium text-[var(--pos-t1)] whitespace-nowrap max-w-[32ch] truncate"
              title={activeSession.prompt}
            >
              {activeTitle}
            </span>
            {stagePill && (
              <span
                className="flex items-center gap-1.5 pos-mono text-[10.5px] px-2 py-[2px] rounded-full whitespace-nowrap"
                style={{ color: stagePill.color, background: stagePill.bg }}
              >
                <Dot color={stagePill.dot} pulse={activeSession.step !== "done" && activeSession.step !== "plan"} />
                {stagePill.label}
              </span>
            )}
          </>
        )}
        <div className="flex-1" />
        {/* Each link doubles as the way back to Home when its own screen is
            already active (mirrors the pre-existing Library toggle) — no
            point showing "Library" while already on the Library page. */}
        <button
          type="button"
          onClick={() => setView(view.kind === "library" ? { kind: "home" } : { kind: "library" })}
          className={cn(
            "text-xs font-medium cursor-pointer whitespace-nowrap transition-colors",
            view.kind === "library"
              ? "text-[var(--pos-t1)]"
              : "text-[var(--pos-t2)] hover:text-[var(--pos-t1)]",
          )}
        >
          {view.kind === "library" ? t("navHome") : t("navLibrary")}
        </button>
        <button
          type="button"
          onClick={() => setView(view.kind === "brandkit" ? { kind: "home" } : { kind: "brandkit" })}
          className={cn(
            "text-xs font-medium cursor-pointer whitespace-nowrap transition-colors",
            view.kind === "brandkit"
              ? "text-[var(--pos-t1)]"
              : "text-[var(--pos-t2)] hover:text-[var(--pos-t1)]",
          )}
        >
          {view.kind === "brandkit" ? t("navHome") : t("navBrandKit")}
        </button>
      </div>

      {/* ═══ Pipeline stepper (run screens) ═══ */}
      {activeSession && view.kind === "run" && (
        <div
          data-pos-stepper
          className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--pos-b1)] overflow-x-auto no-scrollbar"
        >
          {/* Brief — always reachable; opens the run's concept view (idea,
              settings, mood/style, references). */}
          {/* Selected Brief uses the same violet accent as Storyboard. */}
          <button
            type="button"
            onClick={() => setView({ kind: "run", sessionId: activeSession.id, stage: "brief" })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border cursor-pointer whitespace-nowrap transition-colors"
            style={{
              background: view.stage === "brief" ? "var(--pos-vioS)" : "transparent",
              borderColor: view.stage === "brief" ? "var(--pos-vioB)" : "transparent",
            }}
          >
            <span className="w-3 shrink-0 flex items-center justify-center">
              {view.stage === "brief" ? (
                <Dot color="var(--pos-vio)" />
              ) : (
                <span className="text-[10px] leading-none text-[var(--pos-grn)]">✓</span>
              )}
            </span>
            <span
              className="text-xs font-semibold"
              style={{ color: view.stage === "brief" ? "var(--pos-vioT)" : "var(--pos-t2)" }}
            >
              {t("stepBrief")}
            </span>
          </button>
          {stepStates.map((s) => {
            const acc = stageAccent[s.stage]
            return (
              <React.Fragment key={s.stage}>
                <span className="text-[10px] text-[var(--pos-t4)]">→</span>
                <button
                  type="button"
                  disabled={!s.reachable}
                  onClick={() => s.reachable && setView({ kind: "run", sessionId: activeSession.id, stage: s.stage })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border cursor-pointer disabled:cursor-default whitespace-nowrap transition-colors"
                  style={{
                    background: s.current ? acc.bg : "transparent",
                    borderColor: s.current ? acc.border : "transparent",
                  }}
                >
                  {/* Fixed-width indicator slot: ✓ and the dot have different
                      natural widths, so without this the label text would
                      shift left/right as steps select/deselect. Reached
                      stages show ✓ whenever deselected (same as Brief); the
                      dot marks only the selected stage, dim = not reached. */}
                  <span className="w-3 shrink-0 flex items-center justify-center">
                    {s.current ? (
                      <Dot color={acc.dot} />
                    ) : s.reachable ? (
                      <span className="text-[10px] leading-none text-[var(--pos-grn)]">✓</span>
                    ) : (
                      <Dot color="var(--pos-t4)" />
                    )}
                  </span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: s.current ? acc.text : s.reachable ? "var(--pos-t2)" : "var(--pos-t3)" }}
                  >
                    {stageLabel[s.stage]}
                  </span>
                  {s.stage === "storyboard" && (
                    <span className="pos-mono text-[10.5px] text-[var(--pos-t3)]">
                      {t("scenesN", { n: activeSession.scenes.length })}
                    </span>
                  )}
                </button>
              </React.Fragment>
            )
          })}
          {/* Start over — back to Home for a fresh video. Publish already has
              its own "New video" button, so it's hidden there. */}
          {view.stage !== "publish" && (
            <>
              <div className="flex-1" />
              <GhostBtn onClick={() => setView({ kind: "home" })} title={t("startNew")}>
                ↺ {t("startOver")}
              </GhostBtn>
            </>
          )}
        </div>
      )}

      {/* ═══ Screens ═══ */}
      {view.kind === "home" && (
        <HomeScreen
          sessions={sessions}
          loaded={loaded}
          addSession={addSession}
          updateSession={updateSession}
          prefill={homePrefill}
          onPrefillConsumed={() => setHomePrefill(null)}
          pendingRefs={homePendingRefs}
          onPendingRefsConsumed={() => setHomePendingRefs(null)}
          onOpenRun={(id) => openRun(id)}
          onOpenLibrary={() => setView({ kind: "library" })}
          onRetryPlan={retryPlan}
          onError={onError}
        />
      )}
      {view.kind === "library" && (
        <LibraryScreen
          sessions={sessions}
          onOpenRun={(id) => openRun(id)}
          onDelete={deleteRun}
          onRetryPlan={retryPlan}
        />
      )}
      {view.kind === "brandkit" && <BrandKitScreen onError={onError} onUseAssets={useAssetsAsReference} />}
      {view.kind === "run" && activeSession && (
        <>
          {view.stage === "brief" && (
            <BriefScreen
              session={activeSession}
              actions={actionsFor(activeSession.id)}
              onGoStoryboard={() =>
                setView({ kind: "run", sessionId: activeSession.id, stage: "storyboard" })
              }
              onReuse={() => {
                setHomePrefill(activeSession.prompt)
                setView({ kind: "home" })
              }}
            />
          )}
          {view.stage === "storyboard" && (
            <StoryboardScreen
              session={activeSession}
              actions={actionsFor(activeSession.id)}
              sel={sel}
              setSel={setSel}
              writingPrompts={writingPrompts.has(activeSession.id)}
              promptsFailed={promptsFailed.has(activeSession.id)}
              canGoAnimate={stageIndex(reachedStage(activeSession)) >= stageIndex("animate")}
              onGoAnimate={() => setView({ kind: "run", sessionId: activeSession.id, stage: "animate" })}
              tab={view.tab ?? "prompt"}
              onTabChange={(t) => setView({ ...view, tab: t })}
            />
          )}
          {view.stage === "animate" && (
            <AnimateScreen
              session={activeSession}
              actions={actionsFor(activeSession.id)}
              sel={sel}
              setSel={setSel}
              writingPrompts={writingPrompts.has(activeSession.id)}
              tab={view.tab ?? "prompt"}
              onTabChange={(t) => setView({ ...view, tab: t })}
              canGoPublish={allClipsDone(activeSession)}
              onGoPublish={() => {
                // Merge (narration/music/captions included) starts here, on
                // the explicit click — never the instant clips finish — so
                // the user can still regenerate any clip beforehand. Skip
                // re-kicking it if a merge from a previous visit is already
                // running or done; retryVideo resets mergeStatus back to
                // undefined whenever a regen invalidates it.
                if (!activeSession.mergeStatus || activeSession.mergeStatus === "failed") {
                  void actionsFor(activeSession.id).runMerge()
                }
                setView({ kind: "run", sessionId: activeSession.id, stage: "publish" })
              }}
            />
          )}
          {view.stage === "publish" && (
            <PublishScreen
              session={activeSession}
              actions={actionsFor(activeSession.id)}
              onStartNew={() => setView({ kind: "home" })}
            />
          )}
        </>
      )}
    </div>
  )
}

export function StoryApp() {
  return (
    <PosI18nProvider>
      <LightboxProvider>
        <StoryAppInner />
      </LightboxProvider>
    </PosI18nProvider>
  )
}
