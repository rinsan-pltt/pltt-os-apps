"""Video generation endpoint, ported to PluginRouter."""

from __future__ import annotations

import asyncio
import functools
import logging
import uuid
from typing import Any, Dict, List, Optional

import anyio
import fal_client
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from backend.api.db_helpers import (
    create_initial_item,
    create_scene,
    get_key_frame,
    get_project,
    set_item_fields,
    set_key_frame_prompt,
    touch_project,
    update_item_failed,
    update_item_success,
)
from backend.api.core.fal_helper import generate_video
from backend.api.core.runware_helper import (
    generate_video_runware,
    get_runware_video_model,
)
from backend.api.core.sse_manager import broadcast_event, broadcast_event_threadsafe, bind_user_id
from backend.api.core.storage_helper import generate_video_thumbnail, upload_media_to_storage
from backend.api.core.bg_session import standalone_background_session
from backend.api.core.secrets import read_secret as _secret

logger = logging.getLogger("pltt_creative_video.generate_video")
router = PluginRouter(tags=["generate-video"])


class VideoGenerationRequest(BaseModel):
    prompt: str
    models: Optional[List[str]] = []
    duration: Optional[str] = None
    aspect_ratio: Optional[str] = None
    params: Optional[Dict[str, Any]] = {}
    project_id: Optional[str] = None
    key_frame_id: Optional[str] = None
    # Reference images. `start_image`/`end_image` are the first/last frames for a
    # single model; `image_references` is the shared reference for multi-model.
    start_image: Optional[str] = None
    end_image: Optional[str] = None
    image_references: Optional[List[str]] = None
    # Kling "Elements": [{name, frontal_image, reference_images: [...]}], referenced
    # in the prompt as @Element1, @Element2, …
    elements: Optional[List[Dict[str, Any]]] = None


@router.post("/generate/video", dependencies=[require_permission("resources:write")])
async def run_video_generation(
    request: VideoGenerationRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    org_id = ctx.organization_id
    bind_user_id(ctx.user_id)

    if request.project_id:
        project = await get_project(ctx.db, ctx.user_id, request.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.get("type") != "video":
            raise HTTPException(status_code=400, detail="Project type is not 'video'")
        if not request.key_frame_id:
            raise HTTPException(status_code=400, detail="key_frame_id is required")
        project_id = request.project_id
    else:
        project_id = str(uuid.uuid4())

    generation_id = str(uuid.uuid4())
    models_to_run = request.models if request.models else ["kling_3_0_pro"]

    if request.project_id:
        kf = await get_key_frame(ctx.db, ctx.user_id, project_id, request.key_frame_id)
        if kf is None:
            raise HTTPException(status_code=404, detail="Key frame not found")
        key_frame_id = kf["id"]
        await set_key_frame_prompt(ctx.db, ctx.user_id, project_id, key_frame_id, request.prompt)
        # Each generation run in a key frame opens a new scene ("Scene N") so
        # its clips stay directly accessible from the sidebar afterwards.
        scene = await create_scene(
            ctx.db, ctx.organization_id, ctx.user_id, project_id, key_frame_id
        )
        scene_id = scene["id"] if scene else None
    else:
        key_frame_id = None
        scene = None
        scene_id = None

    merged_params: dict = (request.params or {}).copy()
    if request.duration:
        # The UI sends "5s"/"10s"/"15s", but both providers expect a bare number
        # (Fal Kling accepts '3'..'15'; Runware parses float(duration)). Strip the
        # trailing "s" so a value like "5s" doesn't get rejected.
        merged_params["duration"] = request.duration.rstrip("sS").strip() or request.duration
    if request.aspect_ratio:
        merged_params["aspect_ratio"] = request.aspect_ratio

    # Persist the input images with the item (gen_params) so "Remix" can
    # restore the exact frames/references/elements this video was made from.
    persist_params: dict = dict(merged_params)
    if request.start_image:
        persist_params["start_image"] = request.start_image
    if request.end_image:
        persist_params["end_image"] = request.end_image
    if request.image_references:
        persist_params["image_references"] = request.image_references
    if request.elements:
        persist_params["elements"] = request.elements

    fal_key = _secret(ctx, "FAL_KEY")
    runware_key = _secret(ctx, "RUNWARE_KEY")
    if not fal_key:
        raise HTTPException(
            status_code=503,
            detail="FAL_KEY is not configured for this environment.",
        )

    async def _single(model_name: str):
        # The per-model tasks run CONCURRENTLY (asyncio.gather below), so each
        # owns its OWN session/connection — a single AsyncSession can't service
        # concurrent operations. Sharing one session across models made every
        # DB write race ("another operation is in progress"), so no items were
        # ever persisted on multi-model runs.
        async with standalone_background_session(ctx) as db:
            loop = asyncio.get_running_loop()
            actual_model = "kling_3_0_pro" if model_name == "auto" else model_name
            doc = await create_initial_item(
                db,
                organization_id=ctx.organization_id, user_id=ctx.user_id, type="video", model_name=model_name,
                prompt=request.prompt, params=persist_params,
                project_id=project_id, key_frame_id=key_frame_id,
                scene_id=scene_id, generation_id=generation_id,
            )
            record_id = doc["id"]
            await broadcast_event(
                org_id, "started",
                {**doc, "project_id": project_id, "generation_id": generation_id},
                record_id, project_id,
            )

            def on_fal_update(update):
                data = {
                    "model_name": model_name,
                    "project_id": project_id,
                    "generation_id": generation_id,
                    "key_frame_id": key_frame_id,
                    "scene_id": scene_id,
                    "id": record_id,
                    "status": "processing",
                    "prompt": request.prompt,
                    "aspect_ratio": merged_params.get("aspect_ratio"),
                    "duration": merged_params.get("duration"),
                }
                if isinstance(update, fal_client.InProgress):
                    data["logs"] = [log["message"] for log in update.logs]
                elif isinstance(update, fal_client.Queued):
                    data["position"] = update.position
                broadcast_event_threadsafe(loop, org_id, "processing", data, record_id, project_id, ctx.user_id)

            try:
                res = await anyio.to_thread.run_sync(
                    functools.partial(
                        generate_video, fal_key, actual_model, request.prompt,
                        on_progress=on_fal_update,
                        start_image=request.start_image,
                        end_image=request.end_image,
                        image_references=request.image_references,
                        elements=request.elements,
                        **merged_params,
                    )
                )
                video_url = res.get("video", {}).get("url") or res.get("url")
                if not video_url:
                    raise RuntimeError(f"Fal returned no video url: {res}")
                stored = await upload_media_to_storage(ctx, video_url, "videos")
                thumb = await generate_video_thumbnail(ctx, stored)
                final = await update_item_success(db, record_id, url=stored)
                if thumb:
                    final = await set_item_fields(db, record_id, {"thumbnail_url": thumb}) or final
                final = await set_item_fields(db, record_id, {"is_favourite": True}) or final
                await broadcast_event(org_id, "completed", final, record_id, project_id)
            except Exception as fal_err:
                logger.warning(f"⚠️ [Fal] video {model_name} failed: {fal_err}. Trying Runware...")
                air = get_runware_video_model(actual_model)
                ok = False
                if air and runware_key:
                    try:
                        ar = merged_params.get("aspect_ratio", "16:9")
                        dur = str(merged_params.get("duration", "5"))
                        video_url = await generate_video_runware(runware_key, air, request.prompt, ar, dur)
                        stored = await upload_media_to_storage(ctx, video_url, "videos")
                        thumb = await generate_video_thumbnail(ctx, stored)
                        final = await update_item_success(db, record_id, url=stored)
                        if thumb:
                            final = await set_item_fields(db, record_id, {"thumbnail_url": thumb}) or final
                        final = await set_item_fields(db, record_id, {"is_favourite": True}) or final
                        await broadcast_event(org_id, "completed", final, record_id, project_id)
                        ok = True
                    except Exception as rw_err:
                        logger.error(f"❌ Runware video also failed: {rw_err}")
                if not ok:
                    failed = await update_item_failed(
                        db, record_id, "Both Fal and Runware failed for video"
                    )
                    await broadcast_event(org_id, "failed", failed, record_id, project_id)

    async def _bg():
        try:
            results = await asyncio.gather(
                *[_single(m) for m in models_to_run], return_exceptions=True
            )
            for m, r in zip(models_to_run, results):
                if isinstance(r, BaseException):
                    logger.error(f"❌ Model task '{m}' crashed: {r!r}")
            if request.project_id:
                async with standalone_background_session(ctx) as db:
                    await touch_project(db, ctx.user_id, request.project_id)
        except Exception as e:
            logger.error(f"❌ Background video gen crashed: {e}")

    asyncio.create_task(_bg())

    return {
        "status": "pending",
        "project_id": project_id,
        "generation_id": generation_id,
        "scene": scene,
        "message": "Generation started. Subscribe to /events/{project_id} for SSE updates.",
    }
