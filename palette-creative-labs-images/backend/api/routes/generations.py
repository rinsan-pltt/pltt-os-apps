"""Lightweight `GET /generations/{project_id}` endpoint.

Returns the flat list of generated items (image or video) for a project,
without the per-keyframe nesting and asset hydration that `/projects/{id}`
performs. Designed for fast polling: a freshly-clicked Generate call can
poll this every few seconds until the items it spawned reach a terminal
status, without paying for the rest of the project payload on each tick.

Supports optional query-string filters that mirror what callers actually
need to ask:

  ?generation_id=UUID   — only items from a single generation batch
  ?key_frame_id=UUID    — only items belonging to a single key frame
  ?status=completed     — only items with this exact status
  ?status=pending       — meta-filter for non-terminal items (
                          status in {started, in_progress, processing})
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy import and_, select

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from pltt_image_backend.api.db_helpers import _item_to_dict, get_project
from pltt_image_backend.api.models import Item

logger = logging.getLogger("pltt_creative.generations")
router = PluginRouter(tags=["generations"])

_PENDING_STATUSES = {"started", "in_progress", "processing"}


@router.get(
    "/generations/{project_id}",
    dependencies=[require_permission("resources:read")],
)
async def list_project_generations(
    project_id: str,
    generation_id: Optional[str] = None,
    key_frame_id: Optional[str] = None,
    status: Optional[str] = None,
    ctx: PluginContext = Depends(get_ctx),
):
    try:
        project = await get_project(ctx.db, ctx.user_id, project_id)
    except Exception:
        logger.exception("get_project failed: project_id=%s user_id=%s", project_id, ctx.user_id)
        raise HTTPException(status_code=500, detail="Failed to load project; see plugin logs")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    conditions = [Item.project_id == project_id, Item.user_id == ctx.user_id]
    if generation_id:
        conditions.append(Item.generation_id == generation_id)
    if key_frame_id:
        conditions.append(Item.key_frame_id == key_frame_id)

    try:
        res = await ctx.db.execute(
            select(Item).where(and_(*conditions)).order_by(Item.created_at)
        )
        items = [_item_to_dict(it) for it in res.scalars().all()]
    except Exception:
        logger.exception(
            "list_project_generations failed: project_id=%s generation_id=%s key_frame_id=%s",
            project_id, generation_id, key_frame_id,
        )
        raise HTTPException(status_code=500, detail="Failed to list generations; see plugin logs")

    if status:
        if status == "pending":
            items = [it for it in items if it.get("status") in _PENDING_STATUSES]
        else:
            items = [it for it in items if it.get("status") == status]

    return {
        "project_id": project_id,
        "count": len(items),
        "items": items,
    }
