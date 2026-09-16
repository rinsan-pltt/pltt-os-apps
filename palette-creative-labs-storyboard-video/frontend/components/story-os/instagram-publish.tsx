"use client"

// Instagram Reels publishing: connect via Meta/Facebook OAuth, then upload
// the run's final merged video. Mirrors youtube-publish.tsx's shape exactly
// (same "callback is just this app's own URL" trick — see
// backend/api/routes/social_publish.py's module docstring) — the one real
// difference is what's actually behind the connection: Meta requires the
// Instagram account to be a Business/Creator account linked to a Facebook
// Page, which the backend resolves and stores at connect time.

import * as React from "react"
import { IconBrandInstagram, IconCheck, IconLoader2 } from "@tabler/icons-react"
import { apiRequest } from "@/lib/api-helper"
import type { StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { GhostBtn, PrimaryBtn, SectionLabel } from "./ui"
import type { SessionActions } from "./engine"

export const INSTAGRAM_RETURN_SESSION_KEY = "pos-instagram-return-session"

/** Called once at the app root. A full-page OAuth redirect loses all
 * in-memory view state, so the "Connect Instagram" button stashes which
 * session/run to come back to in localStorage before leaving for Meta; this
 * restores it once the code exchange finishes. */
export function useInstagramOAuthReturn(
  onConnected: () => void,
  onError: (title: string, err: unknown) => void,
  restoreSession: (sessionId: string) => void,
) {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get("code")
    // `state` disambiguates from a YouTube return — both providers land back
    // on this same app URL (see social_publish.py's instagram_auth_start).
    if (!code || params.get("state") !== "instagram") return
    // Strip immediately so a refresh doesn't re-submit a spent code.
    window.history.replaceState({}, "", window.location.pathname)
    void (async () => {
      try {
        await apiRequest("/auth/instagram/exchange", {
          method: "POST",
          body: JSON.stringify({ code }),
        })
        onConnected()
      } catch (err) {
        onError("Instagram connect failed", err)
      } finally {
        try {
          const sessionId = window.localStorage.getItem(INSTAGRAM_RETURN_SESSION_KEY)
          window.localStorage.removeItem(INSTAGRAM_RETURN_SESSION_KEY)
          if (sessionId) restoreSession(sessionId)
        } catch {
          // localStorage unavailable — non-fatal, just skip the return-to-run.
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function InstagramPublishSection({
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
    apiRequest("/auth/instagram/status")
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
      window.localStorage.setItem(INSTAGRAM_RETURN_SESSION_KEY, session.id)
    } catch {
      // non-fatal — worst case the user lands back on Home after connecting.
    }
    void apiRequest("/auth/instagram/start").then((res) => {
      if (res?.auth_url) window.location.href = res.auth_url
    })
  }

  const disconnect = async () => {
    await apiRequest("/auth/instagram/disconnect", { method: "POST" }).catch(() => {})
    setStatus({ connected: false })
  }

  const publish = async () => {
    if (!session.finalUrl) return
    actions.patchSession({ instagramPublishStatus: "publishing", instagramPublishError: undefined })
    try {
      const res = await apiRequest("/story/publish/instagram", {
        method: "POST",
        body: JSON.stringify({
          video_url: session.finalUrl,
          caption: session.title ? `${session.title}\n\n${session.prompt}` : session.prompt,
        }),
      })
      actions.patchSession({
        instagramPublishStatus: "published",
        instagramPublishedUrl: res?.url,
        instagramPublishError: undefined,
      })
    } catch (err) {
      actions.patchSession({
        instagramPublishStatus: "failed",
        instagramPublishError: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const publishing = session.instagramPublishStatus === "publishing"

  return (
    <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex flex-col gap-2.5">
      <SectionLabel>{t("publishInstagram")}</SectionLabel>
      {loadingStatus ? (
        <span className="text-[11px] text-[var(--pos-t3)]">{t("loadingEllipsis")}</span>
      ) : !status?.connected ? (
        <GhostBtn className="w-full" onClick={connect}>
          <span className="inline-flex items-center gap-1.5">
            <IconBrandInstagram className="size-3.5" /> {t("connectInstagram")}
          </span>
        </GhostBtn>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--pos-t3)]">
            <span className="truncate">
              {t("connectedAs", { name: status.account_label || t("instagramAccount") })}
            </span>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="text-[var(--pos-t3)] hover:text-[var(--pos-red)] underline cursor-pointer shrink-0"
            >
              {t("disconnect")}
            </button>
          </div>
          {session.instagramPublishStatus === "published" && session.instagramPublishedUrl ? (
            <a
              href={session.instagramPublishedUrl}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <PrimaryBtn accent="org" className="w-full">
                <span className="inline-flex items-center gap-1.5">
                  <IconCheck className="size-3.5" /> {t("viewOnInstagram")}
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
                  <IconBrandInstagram className="size-3.5" /> {t("publishToInstagram")}
                </span>
              )}
            </PrimaryBtn>
          )}
          {session.instagramPublishStatus === "failed" && session.instagramPublishError && (
            <p className="text-[11px] text-[var(--pos-red)]">{session.instagramPublishError}</p>
          )}
        </>
      )}
    </div>
  )
}
