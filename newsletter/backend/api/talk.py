"""Palette OS Talk integration.

Every installed app gets an agent identity in Talk — the agent members
`@`-mention and DM. `ctx.talk` (backend SDK >= 0.1.13) lets this app speak as
that identity, which is the only way to write into Talk: the frontend SDK has
no Talk equivalent, so the UI calls these routes instead.

Two rules the platform enforces, both fail-closed:

* `chat:write` must be declared in `palette-plugin.json` → `permissions`, or
  every `ctx.talk.*` call raises `PermissionError` before it leaves the process;
* the app's agent must already be a participant of the target channel — a
  member invites it in Talk exactly like any other agent. `ctx.talk.channels()`
  is the ONLY read an app gets (id/name/type of the rooms it is seated in);
  there is no history, member list, or search.

Under `pltt dev` nothing reaches a real channel: the simulator reports one fake
seat and logs each post as `[palette-talk] {...}`.

Mounted at `/talk` by `main.py`, so the routes below are `/talk/channels`,
`/talk/message`, and `/talk/share/{nl_id}`.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from palette_sdk import PluginContext, get_plugin_context, require_permission

from newsletter_backend.api.newsletter import get_newsletter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["talk"])


class PostMessageRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    # Channel id, or its name ("general" / "#general").
    channel: str = Field(..., min_length=1)


class ShareNewsletterRequest(BaseModel):
    channel: str = Field(..., min_length=1)
    # Optional lead-in line, e.g. "@Priya draft ready for review".
    note: Optional[str] = Field(default=None, max_length=2000)


def _talk_http_error(exc: Exception) -> HTTPException:
    """Maps the SDK's two failure modes onto HTTP the frontend can act on.

    `PermissionError` means the manifest is missing `chat:write`; `RuntimeError`
    means no Talk service is wired into this runtime (plain pytest, or a host
    older than backend SDK 0.1.13). Anything else is a real platform error.
    """
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Talk is not available in this runtime.",
        )
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


async def post_to_talk(ctx: PluginContext, text: str, channel: str) -> Optional[dict]:
    """Fire-and-forget Talk post for background work (media jobs, exports).
    Returns the posted message, or `None` when Talk is unavailable — a chat
    notice must never fail the job that triggered it, so every error is
    swallowed into a log line."""
    try:
        return await ctx.talk.post(text, channel=channel)
    except Exception as exc:  # pragma: no cover - defensive, never user-facing
        logger.warning("talk post to %s failed: %s", channel, exc)
        return None


@router.get("/channels", dependencies=[require_permission("chat:write")])
async def list_talk_channels(ctx: PluginContext = Depends(get_plugin_context)):
    """Channels this app's agent is seated in — `{id, name, type}` each.

    Empty means nobody has invited the app into a room yet; the UI should say
    so rather than treat it as an error.
    """
    try:
        channels: list[dict[str, Any]] = await ctx.talk.channels()
    except Exception as exc:
        raise _talk_http_error(exc) from exc
    return {"channels": channels}


@router.post("/message", dependencies=[require_permission("chat:write")])
async def post_talk_message(
    body: PostMessageRequest,
    ctx: PluginContext = Depends(get_plugin_context),
):
    """Posts `text` into `channel` as this app's agent.

    An `@Name` inside the text mentions that member or agent exactly as a typed
    message does — so a mentioned agent will answer.
    """
    try:
        message = await ctx.talk.post(body.text, channel=body.channel)
    except Exception as exc:
        raise _talk_http_error(exc) from exc
    return {"status": "sent", "message": message}


@router.post("/share/{nl_id}", dependencies=[require_permission("chat:write")])
async def share_newsletter_to_talk(
    nl_id: str,
    body: ShareNewsletterRequest,
    ctx: PluginContext = Depends(get_plugin_context),
):
    """Announces a newsletter in a Talk channel.

    Deliberately no export link: `/newsletters/{id}/export.{html,pdf}` renders
    on demand behind `resources:read` and is not a shareable URL, so pasting it
    into chat would hand teammates a link that only works from inside the app.
    The announcement carries the title and state; readers open it in Newsletter
    Studio.
    """
    nl = await get_newsletter(ctx, nl_id)
    if nl is None:
        raise HTTPException(status_code=404, detail=f"Newsletter {nl_id} not found.")

    lines: list[str] = []
    if body.note:
        lines.append(body.note.strip())
    state = "ready" if nl.status == "ready" else "in draft"
    lines.append(f"*{nl.title}* — {state} in Newsletter Studio")
    focus = (nl.focus_prompt or "").strip()
    if focus:
        lines.append(focus)

    try:
        message = await ctx.talk.post("\n".join(lines), channel=body.channel)
    except Exception as exc:
        raise _talk_http_error(exc) from exc
    return {"status": "sent", "newsletter_id": nl_id, "message": message}
