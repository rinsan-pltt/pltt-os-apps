"""Favourites: a boolean flag + colour-group tag on items."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from backend.api.db_helpers import (
    get_user_favourites,
    locate_item,
    set_item_fields,
)

router = PluginRouter(tags=["favourites"])

FavouriteGroup = Literal[
    "#FFD700", "#FF4136", "#2ECC40", "#0074D9", "#FF851B",
    "#B10DC9", "#F012BE", "#39CCCC", "#01FF70", "#85144B",
]


def _normalize_group(v):
    if v is None:
        return None
    if isinstance(v, str):
        if v.lower() == "null":
            return None
        s = v.strip()
        if not s.startswith("#"):
            s = "#" + s
        return s.upper()
    return v


class AddFavouriteRequest(BaseModel):
    content_id: str
    content_type: str  # "video"
    group: Optional[FavouriteGroup] = None

    @field_validator("group", mode="before")
    @classmethod
    def _norm(cls, v):
        return _normalize_group(v)


class UpdateFavouriteGroupRequest(BaseModel):
    group: Optional[FavouriteGroup] = None

    @field_validator("group", mode="before")
    @classmethod
    def _norm(cls, v):
        return _normalize_group(v)


@router.get("/favourites", dependencies=[require_permission("resources:read")])
async def list_favourites(
    ctx: PluginContext = Depends(get_ctx),
    group: Optional[str] = Query(None),
    model_name: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    group_is_null = False
    normalized: Optional[str] = None
    if group is not None and group.lower() not in ("", "all"):
        if group.lower() == "null":
            group_is_null = True
        else:
            normalized = _normalize_group(group)
    normalized_model = (
        None if (model_name is None or model_name.lower() in ("", "all")) else model_name
    )
    items = await get_user_favourites(
        ctx.db,
        ctx.user_id,
        group=normalized,
        group_is_null=group_is_null,
        model_name=normalized_model,
    )
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size else 0,
        "items": items[start:end],
    }


@router.post(
    "/favourites",
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission("resources:write")],
)
async def create_favourite(
    body: AddFavouriteRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    if body.content_type != "video":
        raise HTTPException(status_code=400, detail="content_type must be 'video'")
    existing = await locate_item(ctx.db, ctx.user_id, body.content_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Content not found or not yours")
    doc = await set_item_fields(
        ctx.db, body.content_id, {"is_favourite": True, "group": body.group}
    )
    return {"status": "success", "message": "Added to favourites", **(doc or {})}


@router.patch(
    "/favourites/{content_id}",
    dependencies=[require_permission("resources:write")],
)
async def patch_favourite_group(
    content_id: str,
    body: UpdateFavouriteGroupRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    existing = await locate_item(ctx.db, ctx.user_id, content_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await set_item_fields(ctx.db, content_id, {"group": body.group})
    return {"status": "success", "message": "Favourite group updated", **(doc or {})}


@router.delete(
    "/favourites/{content_id}",
    dependencies=[require_permission("resources:write")],
)
async def delete_favourite(
    content_id: str, ctx: PluginContext = Depends(get_ctx)
):
    existing = await locate_item(ctx.db, ctx.user_id, content_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    await set_item_fields(ctx.db, content_id, {"is_favourite": False, "group": None})
    return {"status": "success", "message": f"Removed favourite for item {content_id}"}
