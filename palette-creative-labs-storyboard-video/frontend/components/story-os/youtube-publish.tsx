"use client"

// YouTube Shorts publishing: connect via OAuth, then upload the run's final
// merged video. See backend/api/routes/social_publish.py's module docstring
// for why the OAuth "callback" is just this app's own URL rather than a
// dedicated backend route (Google redirects the BROWSER back here with
// `?code=...`, which useYoutubeOAuthReturn below picks up).

import * as React from "react"
import { IconBrandYoutube, IconCheck, IconLoader2 } from "@tabler/icons-react"
import { apiRequest } from "@/lib/api-helper"
import type { StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { GhostBtn, PrimaryBtn, SectionLabel } from "./ui"
import type { SessionActions } from "./engine"

export const YOUTUBE_RETURN_SESSION_KEY = "pos-youtube-return-session"

/** Called once at the app root. A full-page OAuth redirect loses all
 * in-memory view state, so the "Connect YouTube" button stashes which
 * session/run to come back to in localStorage before leaving for Google;
 * this restores it once the code exchange finishes. */
export function useYoutubeOAuthReturn(
  onConnected: () => void,
  onError: (title: string, err: unknown) => void,
  restoreSession: (sessionId: string) => void,
) {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get("code")
    // `state` disambiguates from an Instagram return — both providers land
    // back on this same app URL (see social_publish.py's youtube_auth_start).
    if (!code || params.get("state") !== "youtube") return
    // Strip immediately so a refresh doesn't re-submit a spent code.
    window.history.replaceState({}, "", window.location.pathname)
    void (async () => {
      try {
        await apiRequest("/auth/youtube/exchange", {
          method: "POST",
          body: JSON.stringify({ code }),
        })
        onConnected()
      } catch (err) {
        onError("YouTube connect failed", err)
      } finally {
        try {
          const sessionId = window.localStorage.getItem(YOUTUBE_RETURN_SESSION_KEY)
          window.localStorage.removeItem(YOUTUBE_RETURN_SESSION_KEY)
          if (sessionId) restoreSession(sessionId)
        } catch {
          // localStorage unavailable — non-fatal, just skip the return-to-run.
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function YouTubePublishSection({
  session,
  actions,
}: {
  session: StorySession
  actions: SessionActions
}) {
  const { t } = usePosT()
  const [status, setStatus] = React.useState<{ connected: boolean; account_label?: string } | null>(
    null,
  )
  const [loadingStatus, setLoadingStatus] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    apiRequest("/auth/youtube/status")
      .then((res) => {
        if (!cancelled) setStatus(res)
      })
      .catch(() => {
        if (!cancelled) setStatus({ connected: false })
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connect = () => {
    try {
      window.localStorage.setItem(YOUTUBE_RETURN_SESSION_KEY, session.id)
    } catch {
      // non-fatal — worst case the user lands back on Home after connecting.
    }
    void apiRequest("/auth/youtube/start").then((res) => {
      if (res?.auth_url) window.location.href = res.auth_url
    })
  }

  const disconnect = async () => {
    await apiRequest("/auth/youtube/disconnect", { method: "POST" }).catch(() => {})
    setStatus({ connected: false })
  }

  const publish = async () => {
    if (!session.finalUrl) return
    actions.patchSession({ youtubePublishStatus: "publishing", youtubePublishError: undefined })
    try {
      const res = await apiRequest("/story/publish/youtube", {
        method: "POST",
        body: JSON.stringify({
          video_url: session.finalUrl,
          title: session.title || session.prompt,
          description: session.prompt,
        }),
      })
      actions.patchSession({
        youtubePublishStatus: "published",
        youtubePublishedUrl: res?.url,
        youtubePublishError: undefined,
      })
    } catch (err) {
      actions.patchSession({
        youtubePublishStatus: "failed",
        youtubePublishError: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const publishing = session.youtubePublishStatus === "publishing"

  return (
    <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex flex-col gap-2.5">
      <SectionLabel>{t("publishYoutube")}</SectionLabel>
      {loadingStatus ? (
        <span className="text-[11px] text-[var(--pos-t3)]">{t("loadingEllipsis")}</span>
      ) : !status?.connected ? (
        <GhostBtn className="w-full" onClick={connect}>
          <span className="inline-flex items-center gap-1.5">
            <IconBrandYoutube className="size-3.5" /> {t("connectYoutube")}
          </span>
        </GhostBtn>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--pos-t3)]">
            <span className="truncate">
              {t("connectedAs", { name: status.account_label || t("youtubeAccount") })}
            </span>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="text-[var(--pos-t3)] hover:text-[var(--pos-red)] underline cursor-pointer shrink-0"
            >
              {t("disconnect")}
            </button>
          </div>
          {session.youtubePublishStatus === "published" && session.youtubePublishedUrl ? (
            <a
              href={session.youtubePublishedUrl}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <PrimaryBtn accent="org" className="w-full">
                <span className="inline-flex items-center gap-1.5">
                  <IconCheck className="size-3.5" /> {t("viewOnYoutube")}
                </span>
              </PrimaryBtn>
            </a>
          ) : (
            <PrimaryBtn
              accent="org"
              className="w-full"
              disabled={publishing || !session.finalUrl}
              onClick={() => void publish()}
            >
              {publishing ? (
                <span className="inline-flex items-center gap-1.5">
                  <IconLoader2 className="size-3.5 pltt-animate-spin" /> {t("publishing")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <IconBrandYoutube className="size-3.5" /> {t("publishToYoutube")}
                </span>
              )}
            </PrimaryBtn>
          )}
          {session.youtubePublishStatus === "failed" && session.youtubePublishError && (
            <p className="text-[11px] text-[var(--pos-red)]">{session.youtubePublishError}</p>
          )}
        </>
      )}
    </div>
  )
}
