"""Mascots: a library of brand characters that can be placed on a newsletter,
plus AI pose generation (gateway image-edit + background removal, run as a
background job via jobs.py — see images.py for why edits are backgrounded).

Mascot.storage_url is already an absolute URL from storage.save_media
(platform storage or the local-GCS fallback), so — unlike the source app —
there is no byte-streaming `GET /mascots/{id}/image` proxy route: the frontend
renders `<img src={mascot.imageUrl}>` pointing directly at the stored URL.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from palette_sdk import PluginContext, get_plugin_context, require_permission

from newsletter_backend.api import jobs, storage
from newsletter_backend.api.models import MediaJob, Mascot
from newsletter_backend.api.orgscope import org_repo
from newsletter_backend.api.serialize import mascot_to_dict

router = APIRouter(tags=["mascot"])


class PoseBody(BaseModel):
    prompt: str = ""


@router.get("", dependencies=[require_permission("resources:read")])
async def list_(ctx: PluginContext = Depends(get_plugin_context)):
    repo = await org_repo(ctx, Mascot)
    rows = await repo.list(order_by="-created_at")
    return [mascot_to_dict(m) for m in rows]


@router.post("/upload", dependencies=[require_permission("resources:write")])
async def upload(file: UploadFile = File(...), ctx: PluginContext = Depends(get_plugin_context)):
    data = await file.read()
    content_type = file.content_type or "image/png"
    url = await storage.save_media(ctx, data, prefix="mascots", category="inputs", content_type=content_type)
    repo = await org_repo(ctx, Mascot)
    m = await repo.create(name=file.filename or "mascot.png", mime=content_type, storage_url=url)
    return mascot_to_dict(m)


@router.get("/pose/{pose_id}/status", dependencies=[require_permission("resources:read")])
async def pose_status(pose_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    job_repo = await org_repo(ctx, MediaJob)
    job = await job_repo.get(pose_id)
    if job is None:
        raise HTTPException(404, "not found")
    return {"status": job.status, "imageUrl": job.image_url, "error": job.error}


@router.post("/{mascot_id}/pose", dependencies=[require_permission("resources:write")])
async def pose(
    mascot_id: str,
    body: PoseBody,
    background: BackgroundTasks,
    ctx: PluginContext = Depends(get_plugin_context),
):
    # returns immediately; generation runs in the background, client polls status
    repo = await org_repo(ctx, Mascot)
    m = await repo.get(mascot_id)
    if m is None:
        raise HTTPException(404, "not found")
    job_repo = await org_repo(ctx, MediaJob)
    job = await job_repo.create(kind="mascot_pose", status="pending")
    snapshot = await jobs.build_ctx_snapshot(ctx)
    background.add_task(jobs.run_mascot_pose_job, snapshot, job.id, m.storage_url, body.prompt)
    return {"poseId": job.id, "status": "pending"}


@router.delete("/{mascot_id}", dependencies=[require_permission("resources:write")])
async def delete(mascot_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    repo = await org_repo(ctx, Mascot)
    ok = await repo.delete(mascot_id)
    if not ok:
        raise HTTPException(404, "not found")
    return {"ok": True}
