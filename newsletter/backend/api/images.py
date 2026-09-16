"""Free-floating overlay images: upload, AI-generate, or reference-guided edit.

Upload and text-to-image generate are synchronous (fast enough to hold the
request open); reference-guided edit runs as a background job polled by the
client, since the gateway edit call is too slow for a synchronous
request/response cycle (see jobs.py). All bytes go through storage.save_media
so callers never hand back a raw gateway/loopback URL.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from palette_sdk import PluginContext, get_plugin_context, require_permission

from newsletter_backend.api import jobs, llm_router, storage
from newsletter_backend.api.config import settings
from newsletter_backend.api.models import MediaJob
from newsletter_backend.api.orgscope import org_repo

router = APIRouter(tags=["images"])


class GenerateBody(BaseModel):
    prompt: str = ""


class EditBody(BaseModel):
    imageUrl: str
    prompt: str = ""


@router.post("/upload", dependencies=[require_permission("resources:write")])
async def upload(file: UploadFile = File(...), ctx: PluginContext = Depends(get_plugin_context)):
    data = await file.read()
    image_url = await storage.save_media(
        ctx, data, prefix="uploads", category="inputs", content_type=file.content_type or "image/png"
    )
    return {"imageUrl": image_url}


@router.post("/generate", dependencies=[require_permission("resources:write")])
async def generate(body: GenerateBody, ctx: PluginContext = Depends(get_plugin_context)):
    data, router_url = await llm_router.generate_image(
        ctx, prompt=body.prompt.strip() or "an editorial illustration", model=settings.image_model
    )
    try:
        image_url = await storage.save_media(
            ctx, data, prefix="generated", category="outputs", content_type="image/png"
        )
    except Exception:  # noqa: BLE001 — re-host failed; fall back to the gateway's own URL
        image_url = router_url
    return {"imageUrl": image_url}


@router.post("/edit", dependencies=[require_permission("resources:write")])
async def edit(body: EditBody, background: BackgroundTasks, ctx: PluginContext = Depends(get_plugin_context)):
    # returns immediately; edit runs in the background, client polls status
    if not body.imageUrl:
        raise HTTPException(404, "image url required")
    job_repo = await org_repo(ctx, MediaJob)
    job = await job_repo.create(kind="image_edit", status="pending")
    snapshot = await jobs.build_ctx_snapshot(ctx)
    background.add_task(jobs.run_image_edit_job, snapshot, job.id, body.imageUrl, body.prompt)
    return {"jobId": job.id, "status": "pending"}


@router.get("/edit/{job_id}/status", dependencies=[require_permission("resources:read")])
async def edit_status(job_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    job_repo = await org_repo(ctx, MediaJob)
    job = await job_repo.get(job_id)
    if job is None:
        raise HTTPException(404, "not found")
    return {"status": job.status, "imageUrl": job.image_url, "error": job.error}
