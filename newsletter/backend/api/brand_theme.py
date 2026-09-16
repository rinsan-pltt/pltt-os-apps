"""Brand themes: named, self-contained look-and-feel presets (palette +
typography + header/footer element templates). A newsletter snapshots one of
these at pick time — see newsletter.py::generate_newsletter."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update

from palette_sdk import PluginContext, get_plugin_context, require_permission

from newsletter_backend.api.models import BrandTheme
from newsletter_backend.api.orgscope import org_repo
from newsletter_backend.api.serialize import brand_theme_to_dict

router = APIRouter(tags=["brand-theme"])


def _id() -> str:
    return uuid.uuid4().hex[:8]


def _el(type_: str, **kw) -> dict:
    return {"id": _id(), "type": type_, **kw}


def _default_headers() -> list[dict]:
    return [
        {
            "id": _id(), "name": "Masthead", "rule": "first", "height": 96,
            "elements": [
                _el("logo", xPct=4, yPct=18, wPct=13, hPct=64),
                _el("text", xPct=20, yPct=22, wPct=60, hPct=40, text="{{ brand.name }}", fontSize=26, bold=True, align="center", color="title"),
                _el("text", xPct=20, yPct=64, wPct=60, hPct=22, text="{{ newsletter.title }}", fontSize=11, align="center", color="accent"),
                _el("divider", xPct=6, yPct=92, wPct=88, hPct=6, color="accent", thickness=2),
            ],
        },
        {
            "id": _id(), "name": "Running header", "rule": "subsequent", "height": 34,
            "elements": [
                _el("text", xPct=4, yPct=18, wPct=60, hPct=64, text="{{ brand.name }}", fontSize=11, align="left", color="accent"),
            ],
        },
    ]


def _default_footers() -> list[dict]:
    return [
        {
            "id": _id(), "name": "Footer", "rule": "all", "height": 40,
            "elements": [
                _el("divider", xPct=4, yPct=8, wPct=92, hPct=6, color="accent", thickness=1),
                _el("text", xPct=4, yPct=32, wPct=50, hPct=60, text="{{ brand.name }}", fontSize=10, align="left", color="body"),
                _el("text", xPct=46, yPct=32, wPct=50, hPct=60, text="{{ page.num }} / {{ page.total }}", fontSize=10, align="right", color="body"),
            ],
        },
    ]


# Seeded (per organization) on first access — same 4 palettes the app always
# shipped with, each getting its own copy of the default header/footer so
# every theme starts fully self-contained.
DEFAULT_THEMES_SEED = [
    {"name": "Indigo", "palette": {"bg": "#ffffff", "title": "#1e1b4b", "body": "#334155", "accent": "#4f46e5", "highlights": ["#fde68a", "#bfdbfe", "#bbf7d0", "#fecaca"]}, "typography": {"fontFamily": "sans", "scale": 1}, "is_default": True},
    {"name": "Slate ink", "palette": {"bg": "#0f172a", "title": "#f8fafc", "body": "#cbd5e1", "accent": "#38bdf8", "highlights": ["#fde68a", "#bfdbfe", "#bbf7d0", "#fecaca"]}, "typography": {"fontFamily": "sans", "scale": 1}, "is_default": False},
    {"name": "Warm press", "palette": {"bg": "#fff7ed", "title": "#7c2d12", "body": "#44403c", "accent": "#ea580c", "highlights": ["#fde68a", "#bfdbfe", "#bbf7d0", "#fecaca"]}, "typography": {"fontFamily": "serif", "scale": 1}, "is_default": False},
    {"name": "Forest", "palette": {"bg": "#f0fdf4", "title": "#14532d", "body": "#374151", "accent": "#16a34a", "highlights": ["#fde68a", "#bfdbfe", "#bbf7d0", "#fecaca"]}, "typography": {"fontFamily": "sans", "scale": 1}, "is_default": False},
]


async def seed_default(ctx: PluginContext) -> None:
    existing = await ctx.db.execute(select(BrandTheme.id).limit(1))
    if existing.scalar_one_or_none() is not None:
        return
    # Seeding is an INSERT on the read path — GET /brand/themes is what triggers
    # it — so an org-id mismatch here fails the *listing*, not just theme
    # creation, which is why "themes don't load" was the visible symptom.
    repo = await org_repo(ctx, BrandTheme)
    for t in DEFAULT_THEMES_SEED:
        await repo.create(
            name=t["name"],
            palette=dict(t["palette"]),
            typography=dict(t["typography"]),
            headers=_default_headers(),
            footers=_default_footers(),
            is_default=t["is_default"],
        )


async def list_themes(ctx: PluginContext) -> list[BrandTheme]:
    await seed_default(ctx)
    rows = await ctx.db.execute(select(BrandTheme).order_by(BrandTheme.created_at))
    return list(rows.scalars().all())


async def get_default_theme(ctx: PluginContext) -> BrandTheme | None:
    await seed_default(ctx)
    rows = await ctx.db.execute(select(BrandTheme).where(BrandTheme.is_default.is_(True)).limit(1))
    row = rows.scalar_one_or_none()
    if row is not None:
        return row
    rows = await ctx.db.execute(select(BrandTheme).order_by(BrandTheme.created_at).limit(1))
    return rows.scalar_one_or_none()


async def update_theme(ctx: PluginContext, theme_id: str, patch: dict) -> BrandTheme | None:
    repo = await org_repo(ctx, BrandTheme)
    theme = await repo.get(theme_id)
    if theme is None:
        return None
    values: dict = {}
    if patch.get("name") is not None:
        values["name"] = patch["name"]
    if isinstance(patch.get("palette"), dict):
        values["palette"] = patch["palette"]
    if isinstance(patch.get("typography"), dict):
        values["typography"] = patch["typography"]
    if isinstance(patch.get("headers"), list):
        values["headers"] = patch["headers"]
    if isinstance(patch.get("footers"), list):
        values["footers"] = patch["footers"]
    if patch.get("isDefault") is True:
        await ctx.db.execute(update(BrandTheme).values(is_default=False).where(BrandTheme.id != theme_id))
        values["is_default"] = True
    if not values:
        return theme
    return await repo.update(theme_id, **values)


class ThemeDeleteError(Exception):
    pass


async def delete_theme(ctx: PluginContext, theme_id: str) -> None:
    rows = await ctx.db.execute(select(BrandTheme))
    all_themes = list(rows.scalars().all())
    theme = next((t for t in all_themes if t.id == theme_id), None)
    if theme is None:
        return
    if len(all_themes) <= 1:
        raise ThemeDeleteError("can't delete the last remaining theme")
    if theme.is_default:
        raise ThemeDeleteError("can't delete the default theme — set another as default first")
    repo = await org_repo(ctx, BrandTheme)
    await repo.delete(theme_id)


def snapshot_of(theme: BrandTheme) -> dict:
    """Full self-contained copy captured onto a newsletter at pick time."""
    return {
        "themeId": theme.id,
        "themeName": theme.name,
        "palette": dict(theme.palette or {}),
        "typography": dict(theme.typography or {}),
        "headers": list(theme.headers or []),
        "footers": list(theme.footers or []),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class ThemeBody(BaseModel):
    name: str | None = None
    palette: dict | None = None
    typography: dict | None = None
    headers: list[dict] | None = None
    footers: list[dict] | None = None
    isDefault: bool | None = None


@router.get("", dependencies=[require_permission("resources:read")])
async def list_(ctx: PluginContext = Depends(get_plugin_context)):
    return [brand_theme_to_dict(t) for t in await list_themes(ctx)]


@router.post("", dependencies=[require_permission("resources:write")])
async def create(body: ThemeBody, ctx: PluginContext = Depends(get_plugin_context)):
    data = body.model_dump(exclude_unset=True)
    repo = await org_repo(ctx, BrandTheme)
    t = await repo.create(
        name=data.get("name") or "New theme",
        palette=data.get("palette") or {},
        typography=data.get("typography") or {"fontFamily": "sans", "scale": 1},
        headers=data.get("headers") or _default_headers(),
        footers=data.get("footers") or _default_footers(),
        is_default=False,
    )
    return brand_theme_to_dict(t)


@router.patch("/{theme_id}", dependencies=[require_permission("resources:write")])
async def update(theme_id: str, body: ThemeBody, ctx: PluginContext = Depends(get_plugin_context)):
    t = await update_theme(ctx, theme_id, body.model_dump(exclude_unset=True))
    if t is None:
        raise HTTPException(404, "not found")
    return brand_theme_to_dict(t)


@router.delete("/{theme_id}", dependencies=[require_permission("resources:write")])
async def delete(theme_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    try:
        await delete_theme(ctx, theme_id)
    except ThemeDeleteError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True}
