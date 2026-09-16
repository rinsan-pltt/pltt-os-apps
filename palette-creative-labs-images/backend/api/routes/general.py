"""General plugin endpoints: status, model registry, items by project, delete item."""

from __future__ import annotations

from fastapi import Depends, HTTPException

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from pltt_image_backend.api.db_helpers import delete_item, get_items_by_project_id
from pltt_image_backend.api.core.fal_helper import get_registered_models

router = PluginRouter(tags=["general"])


@router.get("/status", dependencies=[require_permission("tasks:read")])
async def status(ctx: PluginContext = Depends(get_ctx)):
    return {
        "plugin_id": ctx.plugin_id,
        "user_id": ctx.user_id,
        "organization_id": ctx.organization_id,
    }


@router.get("/models", dependencies=[require_permission("resources:read")])
async def list_models():
    """Returns the registered Fal image model catalog."""
    return get_registered_models()


@router.get("/diagnostics/models", dependencies=[require_permission("resources:read")])
async def models_diagnostics():
    """Reports WHICH models module this runtime is actually bound to. In the
    shared hosted process the sibling video plugin registers the same
    `pltt_image_backend.api.*` module names; if this app ever adopts that copy, every
    query targets `pltt_creative_video__*` tables that don't exist in this
    schema. This endpoint makes the live binding verifiable after a deploy."""
    import pltt_image_backend.api.models as _models
    from pltt_image_backend.api.db_helpers import Project as _helper_project

    return {
        "isolation": "unique-package",
        "models_file": getattr(_models, "__file__", None),
        "models_project_table": _models.Project.__tablename__,
        "db_helpers_project_table": _helper_project.__tablename__,
        "entry_ok": _models.Project.__tablename__ == "pltt_creative__projects",
    }


@router.get(
    "/generations/{project_id}",
    dependencies=[require_permission("resources:read")],
)
async def fetch_generations(
    project_id: str,
    ctx: PluginContext = Depends(get_ctx),
):
    return await get_items_by_project_id(ctx.db, ctx.user_id, project_id)


@router.delete("/images/{doc_id}", dependencies=[require_permission("resources:write")])
async def delete_image(doc_id: str, ctx: PluginContext = Depends(get_ctx)):
    ok = await delete_item(ctx.db, ctx.user_id, doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Record {doc_id} not found.")
    return {"status": "success", "message": f"Record {doc_id} deleted."}
