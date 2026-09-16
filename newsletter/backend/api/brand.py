"""Brand identity (name + logo) and header/footer element-template rendering.

Look-and-feel (palette/typography/headers/footers) lives per BrandTheme — see
brand_theme.py — this module only renders whatever headers/footers it's
handed, merged with the global brand name/logo. One Brand row per
organization (get-or-create), unlike the source app's fixed id="default"
singleton — see models.py for why.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from palette_sdk import PluginContext, get_plugin_context, require_permission

from newsletter_backend.api import storage
from newsletter_backend.api.models import Brand
from newsletter_backend.api.orgscope import org_repo
from newsletter_backend.api.sanitize import safe_html
from newsletter_backend.api.serialize import brand_to_dict

logger = logging.getLogger(__name__)

router = APIRouter(tags=["brand"])

_JUSTIFY = {"left": "flex-start", "center": "center", "right": "flex-end"}


@lru_cache(maxsize=1)
def _jinja_env():
    """Deferred import: some environments load this module (e.g. to enumerate
    routes for permission-gate checks) without pip-installing every dependency
    first, and nothing at that stage needs a working template renderer — only
    render_templates()/_render_one()/_render_elements() do, at actual request
    time. Mirrors storage.py's lazy google-cloud-storage import."""
    from jinja2.sandbox import SandboxedEnvironment

    return SandboxedEnvironment(autoescape=False, trim_blocks=True, lstrip_blocks=True)


# Header/footer templates only ever use plain `{{ a.b }}` lookups
# (brand.name, newsletter.title, page.num, page.total).
_PLACEHOLDER_RE = re.compile(r"{{\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*}}")


def _simple_render(raw: str, ctx: dict) -> str:
    """Substitute `{{ a.b }}` placeholders without Jinja.

    Jinja2 is imported lazily, and the hosted runtime does not always have it
    installed (same gap as WeasyPrint — declared in pyproject.toml, absent at
    runtime). Previously any failure here fell back to emitting the template
    text verbatim, so brand headers/footers rendered as a literal
    `{{ brand.name }}` / `{{ page.num }} / {{ page.total }}`. Those strings are
    far longer than the values they stand for, so they wrapped and overlapped
    inside their fixed-percentage element boxes — which is what "the footer is
    breaking" looks like on the page.

    An unresolvable name is left as-is rather than blanked, so a genuine typo in
    a template stays visible instead of silently vanishing.
    """

    def replace(match: re.Match[str]) -> str:
        value: Any = ctx
        for part in match.group(1).split("."):
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                return match.group(0)
        return "" if value is None else str(value)

    return _PLACEHOLDER_RE.sub(replace, raw)


def _render_template_string(raw: str, ctx: dict) -> str:
    """Render a template string, degrading to plain placeholder substitution."""
    try:
        return _jinja_env().from_string(raw).render(**ctx)
    except Exception:  # noqa: BLE001 — missing jinja2, or a template error
        logger.warning("brand: Jinja unavailable or template failed; using simple substitution", exc_info=True)
        return _simple_render(raw, ctx)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


async def get_or_create_brand(ctx: PluginContext) -> Brand:
    repo = await org_repo(ctx, Brand)
    rows = await repo.list(limit=1)
    if rows:
        return rows[0]
    return await repo.create(name="Brand")


async def update_brand(ctx: PluginContext, patch: dict) -> Brand:
    b = await get_or_create_brand(ctx)
    values = {}
    if patch.get("name") is not None:
        values["name"] = patch["name"]
    if not values:
        return b
    repo = await org_repo(ctx, Brand)
    return await repo.update(b.id, **values)


async def set_logo(ctx: PluginContext, data: bytes, filename: str, mime: str) -> Brand:
    b = await get_or_create_brand(ctx)
    url = await storage.save_media(ctx, data, prefix="brand", category="inputs", content_type=mime)
    repo = await org_repo(ctx, Brand)
    return await repo.update(b.id, logo_url=url)


def _image_src(url: str, for_export: bool) -> str:
    """Served URL for the live preview; inlined as a data URI for export
    (WeasyPrint/export rendering happens synchronously and can't reliably
    depend on outbound HTTP at render time). Element images are absolute
    storage URLs — fetch the bytes (from this process's own recent-upload
    cache first, else a direct fetch of the public URL) and inline them."""
    if not url:
        return ""
    if not for_export:
        return url
    return storage.to_data_uri(url) or url


def _is_page_text(raw: str) -> bool:
    """Page-number text is a dynamic system field — rendered with __NUM__/__TOTAL__
    placeholders the client substitutes per page, so it must not be inline-edited."""
    r = raw.replace(" ", "")
    return "{{page." in r or "{{page[" in r


def _resolve_color(c: Any, ctx: dict) -> str:
    if c in ("accent", "title", "body", "bg"):
        return str(ctx.get(c, "#111111"))
    return str(c or "#111111")


def _render_elements(tpl: dict, ctx: dict, band_width: int | None = None) -> tuple[str, list[dict]]:
    """Returns (band_html, elements). band_html is the full positioned blob used
    for export. elements is per-element structured data for the editor: geometry
    + resolved inner html + (for text) resolved plain text + editable flag."""
    height = int(tpl.get("height") or 80)
    band_w = f"{band_width}px" if band_width else "100%"
    parts = []
    elements: list[dict] = []
    for el in tpl.get("elements") or []:
        hpx = round(height * float(el.get("hPct", 40)) / 100)
        box = (
            f"position:absolute;left:{el.get('xPct', 0)}%;top:{el.get('yPct', 0)}%;"
            f"width:{el.get('wPct', 20)}%;height:{hpx}px;"
        )
        if el.get("rotation"):
            box += f"transform:rotate({el['rotation']}deg);"
        t = el.get("type")
        box_style = box
        editable = False
        resolved_text = None
        text_color = _resolve_color(el.get("color", "title"), ctx)
        if t == "logo":
            src = ctx["brand"]["logoUrl"]
            if src:
                box_style = box + "display:flex;align-items:center;justify-content:center;overflow:hidden;"
                inner = f'<img src="{src}" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain"/>'
            else:
                inner = '<div style="width:100%;height:100%;border:1px dashed #cbd5e1;border-radius:4px"></div>'
        elif t == "image":
            src = _image_src(el.get("imageUrl", ""), bool(ctx.get("_for_export")))
            if src:
                box_style = box + "display:flex;align-items:center;justify-content:center;overflow:hidden;"
                inner = f'<img src="{src}" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain"/>'
            else:
                inner = '<div style="width:100%;height:100%;border:1px dashed #cbd5e1;border-radius:4px"></div>'
        elif t == "box":
            bg = _resolve_color(el["bgColor"], ctx) if el.get("bgColor") else "transparent"
            bc = _resolve_color(el.get("borderColor", "accent"), ctx)
            bw = el.get("borderWidth", 1)
            rad = el.get("radius", 0)
            inner = (
                f'<div style="width:100%;height:100%;background:{bg};'
                f'border:{bw}px solid {bc};border-radius:{rad}px"></div>'
            )
        elif t == "divider":
            col = _resolve_color(el.get("color", "accent"), ctx)
            th = el.get("thickness", 2)
            inner = (
                '<div style="width:100%;height:100%;display:flex;align-items:center">'
                f'<div style="width:100%;border-top:{th}px solid {col}"></div></div>'
            )
        else:  # text
            raw = str(el.get("text", ""))
            if el.get("literal"):
                txt = raw
            else:
                txt = _render_template_string(raw, ctx)
            txt = safe_html(txt)
            al = el.get("align", "left")
            wt = 700 if el.get("bold") else 400
            inner = (
                f'<div style="width:100%;height:100%;display:flex;align-items:center;'
                f"justify-content:{_JUSTIFY.get(al, 'flex-start')};font-size:{el.get('fontSize', 14)}px;"
                f"color:{text_color};font-weight:{wt};text-align:{al};line-height:1.15\">{txt}</div>"
            )
            editable = not _is_page_text(raw)
            resolved_text = txt
        parts.append(f'<div style="{box_style}">{inner}</div>')
        elements.append(
            {
                "id": el.get("id"),
                "type": t,
                "editable": editable,
                "boxStyle": box_style,
                "html": inner,
                "xPct": el.get("xPct", 0),
                "yPct": el.get("yPct", 0),
                "wPct": el.get("wPct", 20),
                "hpx": hpx,
                "rotation": el.get("rotation", 0),
                "fontSize": el.get("fontSize", 14),
                "align": el.get("align", "left"),
                "bold": bool(el.get("bold")),
                "color": text_color,
                "text": resolved_text,
            }
        )
    band_html = f'<div style="position:relative;width:{band_w};height:{height}px">{"".join(parts)}</div>'
    return band_html, elements


def _time_ctx(created_at: datetime | str | None) -> dict:
    dt = created_at
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            dt = None
    if not isinstance(dt, datetime):
        dt = datetime.now()
    return {
        "date": dt.strftime("%b %-d, %Y"),
        "day": dt.strftime("%A"),
        "month": dt.strftime("%B"),
        "year": dt.strftime("%Y"),
    }


def _context(
    *,
    brand_name: str,
    logo_url: str | None,
    title: str,
    palette: dict,
    num: Any,
    total: Any,
    for_export: bool,
    created_at: datetime | str | None = None,
) -> dict:
    logo = ""
    if logo_url:
        logo = (storage.to_data_uri(logo_url) or logo_url) if for_export else logo_url
    return {
        "brand": {"name": brand_name, "logoUrl": logo},
        "accent": palette.get("accent", "#4f46e5"),
        "title": palette.get("title", "#0f172a"),
        "body": palette.get("body", "#334155"),
        "bg": palette.get("bg", "#ffffff"),
        "newsletter": {"title": title},
        "page": {"num": num, "total": total},
        "time": _time_ctx(created_at),
        "_for_export": for_export,
    }


def _render_one(tpl: dict, ctx: dict, band_width: int | None = None) -> dict:
    elements: list[dict] = []
    if tpl.get("elements"):
        html, elements = _render_elements(tpl, ctx, band_width)
    else:
        html = _render_template_string(str(tpl.get("html", "")), ctx)
    return {
        "id": tpl.get("id"),
        "name": tpl.get("name"),
        "rule": tpl.get("rule", "all"),
        "html": html,
        "height": tpl.get("height"),
        "elements": elements,
    }


def render_templates(
    *,
    headers: list[dict],
    footers: list[dict],
    brand_name: str,
    logo_url: str | None,
    title: str,
    palette: dict,
    num: Any = "__NUM__",
    total: Any = "__TOTAL__",
    for_export: bool = False,
    band_width: int | None = None,
    created_at: datetime | str | None = None,
) -> dict:
    """Render a theme's header/footer element templates. For the preview,
    num/total are literal placeholders the client substitutes per page."""
    ctx = _context(
        brand_name=brand_name,
        logo_url=logo_url,
        title=title,
        palette=palette,
        num=num,
        total=total,
        for_export=for_export,
        created_at=created_at,
    )
    return {
        "headers": [_render_one(t, ctx, band_width) for t in (headers or [])],
        "footers": [_render_one(t, ctx, band_width) for t in (footers or [])],
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class BrandPatch(BaseModel):
    name: str | None = None


class RenderBody(BaseModel):
    title: str = ""
    palette: dict = {}
    headers: list[dict] = []
    footers: list[dict] = []
    createdAt: str | None = None


@router.get("", dependencies=[require_permission("resources:read")])
async def get_brand_route(ctx: PluginContext = Depends(get_plugin_context)):
    return brand_to_dict(await get_or_create_brand(ctx))


@router.put("", dependencies=[require_permission("resources:write")])
async def update_brand_route(body: BrandPatch, ctx: PluginContext = Depends(get_plugin_context)):
    b = await update_brand(ctx, body.model_dump(exclude_unset=True))
    return brand_to_dict(b)


@router.post("/logo", dependencies=[require_permission("resources:write")])
async def upload_logo(file: UploadFile = File(...), ctx: PluginContext = Depends(get_plugin_context)):
    data = await file.read()
    b = await set_logo(ctx, data, file.filename or "logo.png", file.content_type or "image/png")
    return brand_to_dict(b)


@router.post("/render", dependencies=[require_permission("resources:read")])
async def render(body: RenderBody, ctx: PluginContext = Depends(get_plugin_context)):
    b = await get_or_create_brand(ctx)
    return render_templates(
        headers=body.headers,
        footers=body.footers,
        brand_name=b.name,
        logo_url=b.logo_url,
        title=body.title,
        palette=body.palette,
        created_at=body.createdAt,
    )
