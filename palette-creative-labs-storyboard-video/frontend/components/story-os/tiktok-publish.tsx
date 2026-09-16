"use client"

// TikTok publishing: connect via OAuth (PKCE required — see below), then
// upload the run's final merged video. Mirrors youtube-publish.tsx's shape,
// with two real differences forced by TikTok's own API (not just a re-skin):
// the OAuth flow requires a PKCE code_verifier round-trip, and a freshly
// published post has no permalink to link to (see backend/api/routes/
// social_publish.py's module docstring for the full detail on both, plus why
// an unaudited app can only publish as a private SELF_ONLY draft for now).

import * as React from "react"
import { IconBrandTiktok, IconCheck, IconLoader2 } from "@tabler/icons-react"
import { apiRequest } from "@/lib/api-helper"
import type { StorySession } from "@/components/providers/story-video-context"
import { usePosT } from "./i18n"
import { GhostBtn, PrimaryBtn, SectionLabel } from "./ui"
import type { SessionActions } from "./engine"

export const TIKTOK_RETURN_SESSION_KEY = "pos-tiktok-return-session"
// The PKCE verifier generated at /auth/tiktok/start time never reaches
// TikTok itself — it has to survive the full-page redirect out and back the
// same way the "which run to return to" key does, then gets sent to
// /auth/tiktok/exchange alongside the code.
const TIKTOK_CODE_VERIFIER_KEY = "pos-tiktok-code-verifier"

/** Called once at the app root. A full-page OAuth redirect loses all
 * in-memory view state, so the "Connect TikTok" button stashes which
 * session/run to come back to (plus the PKCE verifier) in localStorage
 * before leaving; this restores both once the code exchange finishes. */
export function useTiktokOAuthReturn(
  onConnected: () => void,
  onError: (title: string, err: unknown) => void,
  restoreSession: (sessionId: string) => void,
) {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get("code")
    // `state` disambiguates from a YouTube/Instagram return — every provider
    // lands back on this same app URL (see social_publish.py's
    // tiktok_auth_start).
    if (!code || params.get("state") !== "tiktok") return
    // Strip immediately so a refresh doesn't re-submit a spent code.
    window.history.replaceState({}, "", window.location.pathname)
    void (async () => {
      try {
        const codeVerifier = window.localStorage.getItem(TIKTOK_CODE_VERIFIER_KEY) || ""
        await apiRequest("/auth/tiktok/exchange", {
          method: "POST",
          body: JSON.stringify({ code, code_verifier: codeVerifier }),
        })
        onConnected()
      } catch (err) {
        onError("TikTok connect failed", err)
      } finally {
        try {
          window.localStorage.removeItem(TIKTOK_CODE_VERIFIER_KEY)
          const sessionId = window.localStorage.getItem(TIKTOK_RETURN_SESSION_KEY)
          window.localStorage.removeItem(TIKTOK_RETURN_SESSION_KEY)
          if (sessionId) restoreSession(sessionId)
        } catch {
          // localStorage unavailable — non-fatal, just skip the return-to-run.
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function TikTokPublishSection({
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
    apiRequest("/auth/tiktok/status")
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
    void apiRequest("/auth/tiktok/start").then((res) => {
      if (!res?.auth_url) return
      try {
        window.localStorage.setItem(TIKTOK_RETURN_SESSION_KEY, session.id)
        window.localStorage.setItem(TIKTOK_CODE_VERIFIER_KEY, res.code_verifier || "")
      } catch {
        // non-fatal — worst case the exchange fails and the user reconnects.
      }
      window.location.href = res.auth_url
    })
  }

  const disconnect = async () => {
    await apiRequest("/auth/tiktok/disconnect", { method: "POST" }).catch(() => {})
    setStatus({ connected: false })
  }

  const publish = async () => {
    if (!session.finalUrl) return
    actions.patchSession({ tiktokPublishStatus: "publishing", tiktokPublishError: undefined })
    try {
      await apiRequest("/story/publish/tiktok", {
        method: "POST",
        body: JSON.stringify({
          video_url: session.finalUrl,
          caption: session.title ? `${session.title}\n\n${session.prompt}` : session.prompt,
        }),
      })
      actions.patchSession({ tiktokPublishStatus: "published", tiktokPublishError: undefined })
    } catch (err) {
      actions.patchSession({
        tiktokPublishStatus: "failed",
        tiktokPublishError: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const publishing = session.tiktokPublishStatus === "publishing"
  const published = session.tiktokPublishStatus === "published"

  return (
    <div className="bg-[var(--pos-s1)] border border-[var(--pos-b1)] rounded-[10px] p-3 flex flex-col gap-2.5">
      <SectionLabel>{t("publishTiktok")}</SectionLabel>
      {loadingStatus ? (
        <span className="text-[11px] text-[var(--pos-t3)]">{t("loadingEllipsis")}</span>
      ) : !status?.connected ? (
        <GhostBtn className="w-full" onClick={connect}>
          <span className="inline-flex items-center gap-1.5">
            <IconBrandTiktok className="size-3.5" /> {t("connectTiktok")}
          </span>
        </GhostBtn>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--pos-t3)]">
            <span className="truncate">
              {t("connectedAs", { name: status.account_label || t("tiktokAccount") })}
            </span>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="text-[var(--pos-t3)] hover:text-[var(--pos-red)] underline cursor-pointer shrink-0"
            >
              {t("disconnect")}
            </button>
          </div>
          {published ? (
            // TikTok's API doesn't hand back a permalink for a freshly
            // published post — nothing to link to, just confirm it landed.
            <div className="flex items-center justify-center gap-1.5 text-[12px] text-[var(--pos-t2)] py-[7px]">
              <IconCheck className="size-3.5 text-[var(--pos-grn)]" /> {t("tiktokPublished")}
            </div>
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
                  <IconBrandTiktok className="size-3.5" /> {t("publishToTiktok")}
                </span>
              )}
            </PrimaryBtn>
          )}
          {session.tiktokPublishStatus === "failed" && session.tiktokPublishError && (
            <p className="text-[11px] text-[var(--pos-red)]">{session.tiktokPublishError}</p>
          )}
        </>
      )}
    </div>
  )
}
