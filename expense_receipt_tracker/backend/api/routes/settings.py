"""Plugin-wide org settings.

GET /settings   read the current settings (currently just the base currency)
PUT /settings   update the base display currency

Rows are org-scoped by the platform via RLS on `ctx.db`, so these handlers never
filter by organization_id.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.palette import PluginContext, get_plugin_context, require_permission
from ..core.settings_store import get_base_currency, set_base_currency

router = APIRouter(tags=["settings"])


class Settings(BaseModel):
    base_currency: str


class SettingsUpdate(BaseModel):
    base_currency: str


@router.get("/settings", dependencies=[require_permission("resources:read")])
async def read_settings(ctx: PluginContext = Depends(get_plugin_context)) -> Settings:
    return Settings(base_currency=await get_base_currency(ctx))


@router.put("/settings", dependencies=[require_permission("resources:write")])
async def update_settings(
    payload: SettingsUpdate, ctx: PluginContext = Depends(get_plugin_context)
) -> Settings:
    code = (payload.base_currency or "").strip().upper()
    if not (2 <= len(code) <= 8) or not code.isalpha():
        raise HTTPException(
            status_code=422,
            detail="base_currency must be a currency code like 'USD' or 'INR'.",
        )
    stored = await set_base_currency(ctx, code)
    return Settings(base_currency=stored)
