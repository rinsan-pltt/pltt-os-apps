"""Store for the chat agent — threads, messages and per-thread images.

One thread per base image (``thread.id == base_image_id``), so every
edit/regeneration/creation done from that thread is grouped with the base
image and the full conversation.

Every function opens its own ``standalone_background_session`` instead of
using ``ctx.db``: the agent's tools run while generation background tasks may
have swapped/closed the request session, and a single AsyncSession can't
service concurrent operations. A fresh NullPool connection per call also
guarantees we see rows committed by those background tasks.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from sqlalchemy import and_, delete, func, select, update

from palette_sdk import PluginContext

from backend.api.core.bg_session import standalone_background_session

# From the agent-owned module, NOT backend.api.models: the hosted runtime
# stale-caches `backend.api.models` across plugin revisions, and a pre-chat
# cached copy has no Agent* classes (see backend/api/agent/models.py).
from backend.api.agent.models import AgentMessage, AgentThread, AgentThreadImage

logger = logging.getLogger("pltt_creative_video.agent.db")


def _thread_to_dict(t: AgentThread) -> dict:
    return {
        "id": t.id,
        "user_id": t.user_id,
        "base_image_id": t.base_image_id,
        "base_image_url": t.base_image_url,
        "model_name": t.model_name,
        "project_id": t.project_id,
        "key_frame_id": t.key_frame_id,
        "aspect_ratio": t.aspect_ratio,
        "resolution": t.resolution,
        "title": t.title,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


def _message_to_dict(m: AgentMessage) -> dict:
    return {
        "id": m.id,
        "thread_id": m.thread_id,
        "role": m.role,
        "content": m.content,
        "tool_calls": m.tool_calls,
        "created_at": m.created_at,
    }


def _image_to_dict(i: AgentThreadImage) -> dict:
    return {
        "id": i.id,
        "thread_id": i.thread_id,
        "image_id": i.image_id,
        "kind": i.kind,
        "prompt": i.prompt,
        "url": i.url,
        "status": i.status,
        "created_at": i.created_at,
    }


# ---------------------------------------------------------------------------
# Threads
# ---------------------------------------------------------------------------

async def get_or_create_thread(ctx: PluginContext, base_image: dict) -> dict:
    """Return the thread for ``base_image`` (one per image), creating it from
    the image's metadata on first use."""
    base_image_id = base_image["id"]
    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentThread).where(
                and_(AgentThread.id == base_image_id, AgentThread.user_id == ctx.user_id)
            )
        )
        thread = res.scalar_one_or_none()
        if thread is None:
            thread = AgentThread(
                id=base_image_id,
                organization_id=ctx.organization_id,
                user_id=ctx.user_id,
                base_image_id=base_image_id,
                base_image_url=base_image.get("url"),
                model_name=base_image.get("model_name"),
                project_id=base_image.get("project_id"),
                key_frame_id=base_image.get("key_frame_id"),
                aspect_ratio=base_image.get("aspect_ratio"),
                resolution=base_image.get("resolution"),
                title=(base_image.get("prompt") or "Untitled")[:80],
            )
            db.add(thread)
            await db.commit()
            await db.refresh(thread)
        out = _thread_to_dict(thread)

    # Seed the base image as the first image of the thread (idempotent).
    await add_thread_image(
        ctx, base_image_id, base_image_id, "base",
        prompt=base_image.get("prompt"), url=base_image.get("url"),
        status=base_image.get("status"), dedupe=True,
    )
    return out


async def create_draft_thread(
    ctx: PluginContext,
    *,
    project_id: Optional[str] = None,
    key_frame_id: Optional[str] = None,
) -> dict:
    """Create a thread that is not anchored to any image yet (random id,
    ``base_image_id`` NULL). Plain text conversations live here until the chat
    generates its first image, at which point the thread is re-keyed to that
    image via :func:`rekey_thread`."""
    async with standalone_background_session(ctx) as db:
        thread = AgentThread(
            id=str(uuid.uuid4()),
            organization_id=ctx.organization_id,
            user_id=ctx.user_id,
            base_image_id=None,
            project_id=project_id,
            key_frame_id=key_frame_id,
        )
        db.add(thread)
        await db.commit()
        await db.refresh(thread)
        return _thread_to_dict(thread)


async def get_or_create_draft_thread(
    ctx: PluginContext,
    *,
    project_id: Optional[str] = None,
    key_frame_id: Optional[str] = None,
) -> dict:
    """Return the keyframe's existing (un-graduated) draft thread, or create one.

    The frontend keyed its keyframe-default chat by a localStorage thread id, but
    in the sandboxed hosted runtime localStorage doesn't survive a refresh — so
    the chat couldn't recover its in-flight conversation (the workspace could,
    since it reloads from the project by URL). Recovering the draft server-side
    (by project + keyframe) makes refresh work everywhere, with no client storage.
    Only NON-anchored threads (base_image_id NULL) are reused; once a draft
    graduates to an image it's anchored, so the next chat starts a fresh draft."""
    if project_id and key_frame_id:
        async with standalone_background_session(ctx) as db:
            res = await db.execute(
                select(AgentThread)
                .where(
                    and_(
                        AgentThread.user_id == ctx.user_id,
                        AgentThread.project_id == project_id,
                        AgentThread.key_frame_id == key_frame_id,
                        AgentThread.base_image_id.is_(None),
                    )
                )
                .order_by(AgentThread.updated_at.desc())
            )
            existing = res.scalars().first()
            if existing is not None:
                return _thread_to_dict(existing)
    return await create_draft_thread(
        ctx, project_id=project_id, key_frame_id=key_frame_id
    )


async def rekey_thread(ctx: PluginContext, old_thread_id: str, anchor: dict) -> Optional[dict]:
    """Re-key a draft thread to its first generated image: the thread (and all
    of its messages/images) moves under ``anchor['image_id']``, restoring the
    ``thread.id == base_image_id`` invariant so an Edit click on that image
    later reopens the same conversation. Returns the new thread dict, or
    ``None`` when re-keying isn't possible (missing thread, id collision)."""
    new_id = anchor.get("image_id")
    if not new_id or new_id == old_thread_id:
        return None
    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentThread).where(
                and_(AgentThread.id == old_thread_id, AgentThread.user_id == ctx.user_id)
            )
        )
        old = res.scalar_one_or_none()
        if old is None:
            return None
        res = await db.execute(select(AgentThread.id).where(AgentThread.id == new_id))
        if res.scalar_one_or_none() is not None:
            return None
        # New parent row first, then move the children, then drop the old row —
        # keeps every step valid under immediate FK checks (Postgres).
        new = AgentThread(
            id=new_id,
            organization_id=old.organization_id,
            user_id=old.user_id,
            base_image_id=new_id,
            base_image_url=anchor.get("url") or old.base_image_url,
            model_name=old.model_name,
            project_id=old.project_id,
            key_frame_id=old.key_frame_id,
            aspect_ratio=old.aspect_ratio,
            resolution=old.resolution,
            title=old.title or (anchor.get("prompt") or "Untitled")[:80],
        )
        db.add(new)
        await db.flush()
        await db.execute(
            update(AgentMessage)
            .where(AgentMessage.thread_id == old_thread_id)
            .values(thread_id=new_id)
        )
        await db.execute(
            update(AgentThreadImage)
            .where(AgentThreadImage.thread_id == old_thread_id)
            .values(thread_id=new_id)
        )
        await db.delete(old)
        await db.commit()
        await db.refresh(new)
        return _thread_to_dict(new)


async def get_thread(ctx: PluginContext, thread_id: str) -> Optional[dict]:
    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentThread).where(
                and_(AgentThread.id == thread_id, AgentThread.user_id == ctx.user_id)
            )
        )
        t = res.scalar_one_or_none()
        return _thread_to_dict(t) if t else None


async def list_threads(ctx: PluginContext) -> list[dict]:
    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentThread)
            .where(AgentThread.user_id == ctx.user_id)
            .order_by(AgentThread.updated_at.desc())
        )
        return [_thread_to_dict(t) for t in res.scalars().all()]


async def touch_thread(ctx: PluginContext, thread_id: str) -> None:
    async with standalone_background_session(ctx) as db:
        res = await db.execute(select(AgentThread).where(AgentThread.id == thread_id))
        t = res.scalar_one_or_none()
        if t:
            t.updated_at = func.now()
            await db.commit()


async def update_thread_settings(
    ctx: PluginContext,
    thread_id: str,
    *,
    aspect_ratio: Optional[str] = None,
    resolution: Optional[str] = None,
) -> None:
    """Persist the chat's chosen generation settings onto the thread so they
    stick for subsequent turns (the composer sends them each turn, but storing
    them keeps the thread context and any thread-derived default in sync).
    Only non-empty values overwrite — a turn that omits a setting leaves the
    stored one untouched."""
    if not (aspect_ratio or resolution):
        return
    async with standalone_background_session(ctx) as db:
        res = await db.execute(select(AgentThread).where(AgentThread.id == thread_id))
        t = res.scalar_one_or_none()
        if not t:
            return
        if aspect_ratio:
            t.aspect_ratio = aspect_ratio
        if resolution:
            t.resolution = resolution
        await db.commit()


async def delete_thread(ctx: PluginContext, thread_id: str) -> bool:
    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentThread).where(
                and_(AgentThread.id == thread_id, AgentThread.user_id == ctx.user_id)
            )
        )
        t = res.scalar_one_or_none()
        if not t:
            return False
        # Explicit deletes so SQLite dev (no FK pragma) behaves like Postgres.
        await db.execute(delete(AgentMessage).where(AgentMessage.thread_id == thread_id))
        await db.execute(
            delete(AgentThreadImage).where(AgentThreadImage.thread_id == thread_id)
        )
        await db.delete(t)
        await db.commit()
        return True


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

async def add_message(
    ctx: PluginContext, thread_id: str, role: str, content: str, tool_calls: Any = None
) -> dict:
    async with standalone_background_session(ctx) as db:
        m = AgentMessage(
            organization_id=ctx.organization_id,
            thread_id=thread_id,
            role=role,
            content=content or "",
            tool_calls=tool_calls,
        )
        db.add(m)
        await db.commit()
        await db.refresh(m)
        return _message_to_dict(m)


async def update_message(
    ctx: PluginContext, message_id: Any, *, content: Any = None, tool_calls: Any = None
) -> None:
    """Update an existing message's text and/or tool_calls. Used to fill in a
    "generating" placeholder turn with the final reply + produced images once a
    generation finishes (the placeholder is persisted early so a refresh
    mid-generation still shows the turn)."""
    if message_id is None:
        return
    async with standalone_background_session(ctx) as db:
        res = await db.execute(select(AgentMessage).where(AgentMessage.id == message_id))
        m = res.scalar_one_or_none()
        if m is None:
            return
        if content is not None:
            m.content = content
        if tool_calls is not None:
            m.tool_calls = tool_calls
        await db.commit()


async def get_messages(ctx: PluginContext, thread_id: str) -> list[dict]:
    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentMessage)
            .where(AgentMessage.thread_id == thread_id)
            .order_by(AgentMessage.id.asc())
        )
        return [_message_to_dict(m) for m in res.scalars().all()]


# ---------------------------------------------------------------------------
# Thread images
# ---------------------------------------------------------------------------

async def add_thread_image(
    ctx: PluginContext,
    thread_id: str,
    image_id: str,
    kind: str,
    *,
    prompt: Optional[str] = None,
    url: Optional[str] = None,
    status: Optional[str] = None,
    dedupe: bool = False,
) -> Optional[dict]:
    async with standalone_background_session(ctx) as db:
        if dedupe:
            res = await db.execute(
                select(AgentThreadImage.id).where(
                    and_(
                        AgentThreadImage.thread_id == thread_id,
                        AgentThreadImage.image_id == image_id,
                    )
                ).limit(1)
            )
            if res.scalar_one_or_none() is not None:
                return None
        i = AgentThreadImage(
            organization_id=ctx.organization_id,
            thread_id=thread_id,
            image_id=image_id,
            kind=kind,
            prompt=prompt,
            url=url,
            status=status,
        )
        db.add(i)
        await db.commit()
        await db.refresh(i)
        return _image_to_dict(i)


async def update_thread_image(
    ctx: PluginContext, thread_id: str, image_id: str, *,
    url: Optional[str], status: Optional[str],
) -> None:
    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentThreadImage).where(
                and_(
                    AgentThreadImage.thread_id == thread_id,
                    AgentThreadImage.image_id == image_id,
                )
            )
        )
        i = res.scalar_one_or_none()
        if i:
            if url is not None:
                i.url = url
            if status is not None:
                i.status = status
            await db.commit()


async def list_thread_images(ctx: PluginContext, thread_id: str) -> list[dict]:
    # The thread-image rows are a SNAPSHOT taken when each image was recorded —
    # for a slow generation (Midjourney) recorded while still pending, the
    # snapshot stays status=in_progress/url=None even after the detached
    # generation task completes the underlying Item. Reconcile each row against
    # its live Item so the finished image is recognized (e.g. as the thread's
    # current image for a follow-up edit/variation).
    from backend.api.db_helpers import locate_item

    async with standalone_background_session(ctx) as db:
        res = await db.execute(
            select(AgentThreadImage)
            .where(AgentThreadImage.thread_id == thread_id)
            .order_by(AgentThreadImage.id.asc())
        )
        rows = [_image_to_dict(i) for i in res.scalars().all()]
        for r in rows:
            image_id = r.get("image_id")
            if not image_id:
                continue
            live = await locate_item(db, ctx.user_id, image_id)
            if not live:
                continue
            if live.get("status"):
                r["status"] = live["status"]
            if live.get("url"):
                r["url"] = live["url"]
        return rows
