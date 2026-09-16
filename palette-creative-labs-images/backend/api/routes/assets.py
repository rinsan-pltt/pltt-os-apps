"""Reference assets and key-frame asset endpoints."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path, PurePosixPath
from typing import List
from urllib.parse import unquote, urlparse

from fastapi import Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from pltt_image_backend.api.db_helpers import (
    add_assets_to_key_frame,
    delete_asset,
    find_asset_by_hash,
    get_key_frame,
    get_user_assets,
    remove_asset_from_key_frame,
    upsert_reference_asset,
)

logger = logging.getLogger("pltt_creative.assets")
router = PluginRouter(tags=["assets"])

_MAX_REFERENCE_BYTES = 25 * 1024 * 1024  # 25 MB


@router.post(
    "/assets/reference",
    dependencies=[require_permission("resources:write")],
)
async def upload_reference_asset(
    file: UploadFile = File(...),
    ctx: PluginContext = Depends(get_ctx),
):
    """Uploads a reference image once and deduplicates by content hash."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    content_hash = hashlib.sha256(data).hexdigest()
    content_type = file.content_type or "application/octet-stream"
    suffix = PurePosixPath(file.filename or "").suffix or ""
    key = f"creative_images/inputs/references/{ctx.user_id}/{content_hash}{suffix}"

    existing = await find_asset_by_hash(ctx.db, ctx.user_id, content_hash)
    if existing:
        # In dev the local file backing a reference is deleted after use (it's
        # inlined into the message as a data URI). If this dedup hit points at a
        # now-missing local file, re-save the bytes so the URL resolves again.
        ex_url = existing.get("url") or ""
        if ex_url.startswith("file://"):
            try:
                local_path = Path(unquote(urlparse(ex_url).path))
            except Exception:
                local_path = None
            if local_path is not None and not local_path.exists():
                await ctx.storage.upload_file(
                    file.filename or f"{content_hash}{suffix}", data, content_type, key=key,
                )
        return {"status": "exists", **existing}

    # Palette-scoped app storage: object lands under
    # uploads/apps/pltt_creative_<id>/<org>/creative_images/inputs/references/<user>/<hash>.ext
    saved = await ctx.storage.upload_file(
        file.filename or f"{content_hash}{suffix}",
        data,
        content_type,
        key=key,
    )
    url = saved.get("file_url") or saved.get("fileUrl") or saved.get("url")

    asset = await upsert_reference_asset(
        ctx.db, ctx.organization_id, ctx.user_id, url, content_hash
    )
    return {"status": "created", **asset}


class ReferenceRegisterRequest(BaseModel):
    url: str
    content_hash: str


@router.post(
    "/assets/reference/register",
    dependencies=[require_permission("resources:write")],
)
async def register_reference_asset(
    body: ReferenceRegisterRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    """Registers a reference image the browser already uploaded to OS app
    storage via the SDK storage client (`palette.storage.upload`).

    The bytes are uploaded directly from the browser to OS-managed storage
    (signed-URL PUT), so this route only persists the resulting URL and
    de-duplicates by the client-supplied content hash. JSON body avoids sending
    a multipart upload through the sandbox `apiFetch` bridge (which the OS
    preview rejects with 422).
    """
    url = (body.url or "").strip()
    content_hash = (body.content_hash or "").strip()
    if not url or not content_hash:
        raise HTTPException(status_code=400, detail="url and content_hash are required")

    existing = await find_asset_by_hash(ctx.db, ctx.user_id, content_hash)
    if existing:
        return {"status": "exists", **existing}

    asset = await upsert_reference_asset(
        ctx.db, ctx.organization_id, ctx.user_id, url, content_hash
    )
    return {"status": "created", **asset}


@router.get(
    "/assets",
    dependencies=[require_permission("resources:read")],
)
async def list_my_assets(ctx: PluginContext = Depends(get_ctx)):
    return {"assets": await get_user_assets(ctx.db, ctx.user_id)}


@router.delete(
    "/assets/{asset_id}",
    dependencies=[require_permission("resources:write")],
)
async def delete_my_asset(asset_id: str, ctx: PluginContext = Depends(get_ctx)):
    ok = await delete_asset(ctx.db, ctx.user_id, asset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"status": "success"}


class AttachKeyFrameAssetsRequest(BaseModel):
    urls: List[str]


@router.post(
    "/assets/{project_id}/{key_frame_id}",
    dependencies=[require_permission("resources:write")],
)
async def attach_key_frame_assets(
    project_id: str,
    key_frame_id: str,
    body: AttachKeyFrameAssetsRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    """Attaches already-uploaded reference URLs to a keyframe's persistent
    asset pool immediately (at attach time, not generate time), so a reference
    reopens with the keyframe until the user explicitly removes it."""
    kf = await get_key_frame(ctx.db, ctx.user_id, project_id, key_frame_id)
    if kf is None:
        raise HTTPException(status_code=404, detail="Key frame not found")
    urls = [u.strip() for u in body.urls if (u or "").strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="urls must be non-empty")
    assets = await add_assets_to_key_frame(ctx.db, ctx.organization_id, key_frame_id, urls)
    return {"status": "success", "assets": assets}


@router.get(
    "/assets/{project_id}/{key_frame_id}",
    dependencies=[require_permission("resources:read")],
)
async def fetch_key_frame_assets(
    project_id: str,
    key_frame_id: str,
    ctx: PluginContext = Depends(get_ctx),
):
    kf = await get_key_frame(ctx.db, ctx.user_id, project_id, key_frame_id)
    if kf is None:
        raise HTTPException(status_code=404, detail="Key frame not found")
    return {
        "status": "success",
        "project_id": project_id,
        "key_frame_id": key_frame_id,
        "assets": kf.get("assets") or [],
    }


@router.delete(
    "/assets/{project_id}/{key_frame_id}/{asset_id}",
    dependencies=[require_permission("resources:write")],
)
async def delete_key_frame_asset(
    project_id: str,
    key_frame_id: str,
    asset_id: str,
    ctx: PluginContext = Depends(get_ctx),
):
    kf = await get_key_frame(ctx.db, ctx.user_id, project_id, key_frame_id)
    if kf is None:
        raise HTTPException(status_code=404, detail="Key frame not found")
    ok = await remove_asset_from_key_frame(ctx.db, key_frame_id, asset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Asset not found in key frame")
    return {"status": "success", "message": f"Asset {asset_id} removed"}
