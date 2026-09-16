"""Project and key-frame CRUD."""

from __future__ import annotations

import logging
from typing import Literal, Optional

from fastapi import Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

logger = logging.getLogger("pltt_creative.projects")

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from pltt_image_backend.api.db_helpers import (
    create_key_frame,
    create_project,
    delete_key_frame,
    delete_project,
    get_project,
    list_projects,
    rename_key_frame,
    rename_project,
    reorder_key_frames,
)

router = PluginRouter(tags=["projects"])

ProjectType = Literal["image"]


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1)
    type: ProjectType
    client: Optional[str] = None


@router.post(
    "/projects",
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission("resources:write")],
)
async def create_project_endpoint(
    body: CreateProjectRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    # Wrap the DB writes so the hosted-preview runtime returns a proper
    # JSON error instead of crashing the container with an unhandled
    # exception (which surfaces as "preview backend runtime failed" in the
    # Palette OS shell). The full traceback still lands in `pltt logs`.
    try:
        doc = await create_project(
            ctx.db, ctx.organization_id, ctx.user_id, body.name, body.type, body.client
        )
    except Exception:
        logger.exception("create_project failed: org=%s user=%s name=%r type=%r", ctx.organization_id, ctx.user_id, body.name, body.type)
        raise HTTPException(status_code=500, detail="Failed to create project; see plugin logs")
    if doc is None:
        raise HTTPException(status_code=500, detail="Failed to create project")
    try:
        kf = await create_key_frame(ctx.db, ctx.organization_id, ctx.user_id, doc["id"])
    except Exception:
        logger.exception("create_key_frame failed for new project %s", doc.get("id"))
        # Project itself exists; surface the partial state to the caller.
        return {"status": "partial", "message": "Project created without initial key frame", **doc, "key_frames": []}
    return {"status": "success", "message": "Project created", **doc, "key_frames": [kf]}


@router.get("/projects", dependencies=[require_permission("resources:read")])
async def list_projects_endpoint(
    ctx: PluginContext = Depends(get_ctx),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    projects = await list_projects(ctx.db, ctx.user_id)
    total = len(projects)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size else 0,
        "projects": projects[start:end],
    }


@router.get(
    "/projects/{project_id}",
    dependencies=[require_permission("resources:read")],
)
async def get_project_endpoint(
    project_id: str, ctx: PluginContext = Depends(get_ctx)
):
    doc = await get_project(ctx.db, ctx.user_id, project_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return doc


class RenameProjectRequest(BaseModel):
    name: str = Field(..., min_length=1)


@router.patch(
    "/projects/{project_id}",
    dependencies=[require_permission("resources:write")],
)
async def rename_project_endpoint(
    project_id: str,
    body: RenameProjectRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    updated = await rename_project(ctx.db, ctx.user_id, project_id, body.name)
    if updated is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "success", "message": "Project renamed", **updated}


class RenameKeyFrameRequest(BaseModel):
    name: str = Field(..., min_length=1)


class ReorderKeyFramesRequest(BaseModel):
    new_key_frame_number: int = Field(..., ge=1)


@router.post(
    "/projects/{project_id}/key-frames",
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission("resources:write")],
)
async def create_key_frame_endpoint(
    project_id: str, ctx: PluginContext = Depends(get_ctx)
):
    kf = await create_key_frame(ctx.db, ctx.organization_id, ctx.user_id, project_id)
    if kf is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "success", "message": "Key frame created", **kf}


@router.patch(
    "/projects/{project_id}/key-frames/{key_frame_id}",
    dependencies=[require_permission("resources:write")],
)
async def rename_key_frame_endpoint(
    project_id: str,
    key_frame_id: str,
    body: RenameKeyFrameRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    updated = await rename_key_frame(ctx.db, ctx.user_id, project_id, key_frame_id, body.name)
    if updated is None:
        raise HTTPException(status_code=404, detail="Key frame not found")
    return {"status": "success", "message": "Key frame renamed", **updated}


@router.patch(
    "/projects/{project_id}/key-frames/{key_frame_id}/order",
    dependencies=[require_permission("resources:write")],
)
async def reorder_key_frames_endpoint(
    project_id: str,
    key_frame_id: str,
    body: ReorderKeyFramesRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    updated = await reorder_key_frames(
        ctx.db, ctx.user_id, project_id, key_frame_id, body.new_key_frame_number
    )
    if updated is None:
        raise HTTPException(status_code=400, detail="Invalid key frame id or position")
    return {
        "status": "success",
        "message": "Key frame moved",
        "project_id": project_id,
        "key_frames": updated,
    }


@router.delete(
    "/projects/{project_id}/key-frames/{key_frame_id}",
    dependencies=[require_permission("resources:write")],
)
async def delete_key_frame_endpoint(
    project_id: str,
    key_frame_id: str,
    ctx: PluginContext = Depends(get_ctx),
):
    ok = await delete_key_frame(ctx.db, ctx.user_id, project_id, key_frame_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Key frame not found")
    return {
        "status": "success",
        "message": f"Key frame {key_frame_id} deleted",
        "project_id": project_id,
    }


@router.delete(
    "/projects/{project_id}",
    dependencies=[require_permission("resources:write")],
)
async def delete_project_endpoint(
    project_id: str, ctx: PluginContext = Depends(get_ctx)
):
    ok = await delete_project(ctx.db, ctx.user_id, project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "success", "message": f"Project {project_id} deleted"}
