"""SSE generation progress stream.

Auth and org scoping come from the PluginContext; channels are keyed on
(organization_id, project_id) so two orgs cannot read each other's stream.
"""

from __future__ import annotations

from fastapi import Depends

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from backend.api.core.sse_manager import get_sse_response

router = PluginRouter(tags=["events"])


@router.get(
    "/events/{project_id}",
    dependencies=[require_permission("resources:read")],
)
async def event_stream(
    project_id: str,
    type: str = "image",
    ctx: PluginContext = Depends(get_ctx),
):
    return get_sse_response(ctx.organization_id, project_id, generation_type=type)
