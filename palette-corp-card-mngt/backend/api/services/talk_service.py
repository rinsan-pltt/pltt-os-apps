"""Talk notices posted as the app's own agent identity.

`ctx.talk` posts into a Talk channel as the agent row the platform creates for
every installation — the same agent members `@`-mention. Per the SDK, it needs
`chat:write` in the manifest, and the agent must already be a participant of the
target channel: a member invites it the way they invite any agent. An app can
post only into rooms it was invited to, and it cannot read message history at
all — `channels()` is the single read it gets.

Talk is therefore always optional at runtime. No agent seat, a runtime without
the service (the local simulator), or a missing permission all mean "no Talk
here", and none of them may break a settlement flow, so every call below reports
failure instead of raising.
"""

from __future__ import annotations

from typing import Any

DEFAULT_CHANNEL = "general"


class TalkNotifier:
    """Posts corporate-card notices into one Talk channel.

    `channel` is a channel id or name (`"finance"`, `"#finance"`). Left unset,
    the first channel the agent is seated in is used, so an install works as
    soon as someone invites the agent somewhere.
    """

    def __init__(self, ctx: Any, *, channel: str | None = None) -> None:
        self.ctx = ctx
        self.channel = (channel or "").strip().lstrip("#") or None

    @property
    def available(self) -> bool:
        talk = getattr(self.ctx, "talk", None)
        return talk is not None and callable(getattr(talk, "post", None))

    async def channels(self) -> list[dict[str, Any]]:
        """Channels the app's agent sits in, or [] when Talk is unavailable."""
        if not self.available:
            return []
        try:
            rooms = await self.ctx.talk.channels()
        except (RuntimeError, PermissionError) as exc:
            self.ctx.logger.info("Talk channels unavailable: %s", exc)
            return []
        except Exception as exc:  # noqa: BLE001 - Talk must never break a flow
            self.ctx.logger.warning("Talk channel lookup failed: %s", exc)
            return []
        return [room for room in rooms if isinstance(room, dict)]

    async def resolve_channel(self) -> str | None:
        if self.channel:
            return self.channel
        rooms = await self.channels()
        if not rooms:
            return None
        first = rooms[0]
        return str(first.get("id") or first.get("name") or "") or None

    async def post(self, text: str) -> dict[str, Any] | None:
        """Post `text`; returns the message, or None when nothing was posted."""
        if not self.available or not text.strip():
            return None
        channel = await self.resolve_channel()
        if not channel:
            self.ctx.logger.info("Talk skipped: the app's agent is not in any channel yet")
            return None
        try:
            message = await self.ctx.talk.post(text, channel=channel)
        except PermissionError as exc:
            self.ctx.logger.info("Talk skipped: %s", exc)
            return None
        except RuntimeError as exc:
            self.ctx.logger.info("Talk service unavailable: %s", exc)
            return None
        except Exception as exc:  # noqa: BLE001 - a failed notice is not a failed claim
            self.ctx.logger.warning("Talk post to %s failed: %s", channel, exc)
            return None
        self.ctx.logger.info("Talk notice posted to %s", channel)
        return message if isinstance(message, dict) else {"channel": channel}
