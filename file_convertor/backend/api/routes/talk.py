"""Talk integration: post into OS Talk channels as the app's agent identity.

Talk is Palette OS's channel-based messaging. An app participates through the
agent identity declared in ``palette-plugin.json`` (``agents[]``): a member
invites that agent into a channel, and the backend can then read the channels it
was invited to and post messages there as the agent.

There is no frontend Talk API — posting is backend-only through ``ctx.talk`` and
requires the ``chat:write`` permission. During ``pltt dev`` nothing reaches a
real channel: the simulator reports one fake seat and logs each post as
``[palette-talk] {...}``.

GET  /talk/channels  — channels the app's agent was invited to (id, name, type)
POST /talk/post      — post a message (channel id or name, optional @mentions)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Form, HTTPException

from ..core.palette import require_permission

try:
    from fastapi import Depends
    from palette_sdk import get_plugin_context  # type: ignore

    _CTX_DEP: Any = Depends(get_plugin_context)
except ImportError:  # standalone dev/tests — no platform, no Talk
    _CTX_DEP = None

router = APIRouter(tags=["talk"])


def _require_talk(ctx: Any) -> Any:
    """Return ``ctx.talk`` or fail with a clear message when Talk is unavailable.

    Talk only exists inside Palette OS (hosted or ``pltt dev``). Under plain
    uvicorn / pytest there is no platform context, so posting is not possible.
    """
    talk = getattr(ctx, "talk", None)
    if talk is None:
        raise HTTPException(
            status_code=424,
            detail=(
                "Talk is only available inside Palette OS (hosted or `pltt dev`). "
                "Run the app on the platform and have a member invite its agent "
                "to a channel first."
            ),
        )
    return talk


@router.get("/talk/channels", dependencies=[require_permission("chat:write")])
async def list_channels(ctx: Any = _CTX_DEP) -> dict:
    """List the Talk channels the app's agent has been invited to."""
    talk = _require_talk(ctx)
    channels = await talk.channels()
    return {"channels": channels, "count": len(channels)}


@router.post("/talk/post", dependencies=[require_permission("chat:write")])
async def post_message(
    message: str = Form(...),
    channel: str = Form(...),
    ctx: Any = _CTX_DEP,
) -> dict:
    """Post a message into a Talk channel as the app's agent.

    ``channel`` is a channel id or name (``"general"``, ``"#general"``). Use
    ``@Name`` in the message to mention a member or agent, exactly as a typed
    message does. The agent must already be a member of that channel.
    """
    text = message.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message text is required.")

    target = channel.strip()
    if not target:
        raise HTTPException(status_code=422, detail="A channel id or name is required.")

    talk = _require_talk(ctx)
    await talk.post(text, channel=target)
    return {"posted": True, "channel": target}
