"""Newsletter CRUD, RAG generation, and HTML/PDF export routes."""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from palette_sdk import PluginContext, get_plugin_context, require_permission

from newsletter_backend.api import brand as brand_module
from newsletter_backend.api import brand_theme, dataroom, export, llm_router
from newsletter_backend.api.config import settings
from newsletter_backend.api.models import BrandTheme, Newsletter, NewsletterBlock
from newsletter_backend.api.orgscope import org_repo
from newsletter_backend.api.prompts import LAYOUT_KEYS, build_generation_messages
from newsletter_backend.api.serialize import nl_to_dict

logger = logging.getLogger(__name__)

router = APIRouter(tags=["newsletter"])


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


async def list_newsletters(ctx: PluginContext) -> list[Newsletter]:
    rows = await ctx.db.execute(
        select(Newsletter).options(selectinload(Newsletter.blocks)).order_by(Newsletter.updated_at.desc())
    )
    return list(rows.scalars().all())


async def get_newsletter(ctx: PluginContext, nl_id: str) -> Newsletter | None:
    rows = await ctx.db.execute(
        select(Newsletter).where(Newsletter.id == nl_id).options(selectinload(Newsletter.blocks))
    )
    return rows.scalar_one_or_none()


async def update_newsletter(ctx: PluginContext, nl_id: str, patch: dict) -> Newsletter | None:
    nl = await get_newsletter(ctx, nl_id)
    if nl is None:
        return None

    if patch.get("title") is not None:
        nl.title = patch["title"]
    if patch.get("status") is not None:
        nl.status = patch["status"]
    if patch.get("language") is not None:
        nl.language = patch["language"]
    if patch.get("focusPrompt") is not None:
        nl.focus_prompt = patch["focusPrompt"]
    if patch.get("brandThemeId") is not None:
        # Only re-snapshot when the theme actually CHANGES (a theme switch =
        # reset header/footer per the editor's confirm-modal warning). A save
        # that re-sends the same brandThemeId must NOT wipe per-newsletter
        # theme_snapshot edits — the snapshot is self-contained by contract.
        if patch["brandThemeId"] != nl.brand_theme_id:
            theme_repo = await org_repo(ctx, BrandTheme)
            theme = await theme_repo.get(patch["brandThemeId"])
            if theme is not None:
                nl.brand_theme_id = theme.id
                nl.theme_snapshot = brand_theme.snapshot_of(theme)
    snap = patch.get("themeSnapshot")
    if (
        isinstance(snap, dict)
        and isinstance(snap.get("palette"), dict)
        and isinstance(snap.get("headers"), list)
        and isinstance(snap.get("footers"), list)
    ):
        nl.theme_snapshot = snap
    if isinstance(patch.get("layout"), dict):
        nl.layout = patch["layout"]
    if isinstance(patch.get("overlays"), list):
        nl.overlays = patch["overlays"]
    if isinstance(patch.get("blocks"), list):
        payload = patch["blocks"]
        # Preserve existing rows where the client sent an `id` so references
        # like `continuationOf` stay valid across edits. Rows without an id or
        # with an unknown id are treated as new.
        existing = {b.id: b for b in nl.blocks}
        seen: set[str] = set()
        new_blocks: list[NewsletterBlock] = []
        for i, b in enumerate(payload):
            bid = b.get("id") or None
            if bid and bid in existing:
                seen.add(bid)
                row = existing[bid]
                row.order_index = i
                row.layout_key = b.get("layout", "single_column")
                row.title = b.get("title", "")
                row.summary = b.get("summary", "")
                row.content = b.get("content", "")
                row.image_desc = b.get("imageDesc", "")
                row.images = b.get("images", []) or []
                row.citations = b.get("citations", []) or []
                row.continuation_of = b.get("continuationOf")
                row.force_page_break = bool(b.get("forcePageBreak", False))
                row.keep_next = bool(b.get("keepNext", False))
                new_blocks.append(row)
            else:
                new_blocks.append(
                    NewsletterBlock(
                        newsletter_id=nl.id,
                        organization_id=nl.organization_id,
                        order_index=i,
                        layout_key=b.get("layout", "single_column"),
                        title=b.get("title", ""),
                        summary=b.get("summary", ""),
                        content=b.get("content", ""),
                        image_desc=b.get("imageDesc", ""),
                        images=b.get("images", []) or [],
                        citations=b.get("citations", []) or [],
                        continuation_of=b.get("continuationOf"),
                        force_page_break=bool(b.get("forcePageBreak", False)),
                        keep_next=bool(b.get("keepNext", False)),
                    )
                )
        for bid, row in existing.items():
            if bid not in seen:
                await ctx.db.delete(row)
        nl.blocks = new_blocks

    await ctx.db.commit()
    # re-fetch with blocks eagerly loaded so serialization never lazy-loads
    return await get_newsletter(ctx, nl_id)


async def generate_newsletter(ctx: PluginContext, req: dict) -> Newsletter:
    """RAG generation: retrieve grounded chunks, draft blocks via the LLM with
    per-block provenance, persist the newsletter."""
    title = req.get("title") or "Untitled newsletter"
    block_count = int(req.get("blockCount") or 5)
    focus = req.get("focusPrompt") or ""
    doc_ids = req.get("sourceDocumentIds") or []

    theme_repo = await org_repo(ctx, BrandTheme)
    theme = await theme_repo.get(req.get("brandThemeId") or "")
    if theme is None:
        raise HTTPException(404, "brand theme not found")

    k = min(18, max(6, block_count * 3))
    chunks = await dataroom.retrieve_chunks(ctx, query=focus or title, document_ids=doc_ids, k=k)
    by_id = {c["chunkId"]: c for c in chunks}

    system, user = build_generation_messages(
        title=title,
        language=req.get("language") or "en",
        tone=req.get("tone") or "Professional",
        block_count=block_count,
        focus_prompt=focus,
        chunks=chunks,
    )
    out = await llm_router.chat_json(ctx, model=settings.gen_model, system=system, user=user)
    raw_blocks = out.get("blocks") or []

    nl_repo = await org_repo(ctx, Newsletter)
    nl = await nl_repo.create(
        title=title,
        status="draft",
        language=req.get("language") or "en",
        focus_prompt=focus,
        brand_theme_id=theme.id,
        theme_snapshot=brand_theme.snapshot_of(theme),
        layout={},
        source_document_ids=doc_ids,
    )

    block_repo = await org_repo(ctx, NewsletterBlock)
    for i, rb in enumerate(raw_blocks):
        layout = rb.get("layout_key")
        if layout not in LAYOUT_KEYS:
            layout = "title_only" if i == 0 else "single_column"
        if i == 0:
            layout = "title_only"
        citations = []
        for cid in rb.get("citation_chunk_ids") or []:
            ch = by_id.get(cid)
            if ch:
                citations.append(
                    {
                        "documentId": ch["documentId"],
                        "documentName": ch["documentName"],
                        "chunkId": ch["chunkId"],
                        "snippet": ch["snippet"],
                    }
                )
        await block_repo.create(
            newsletter_id=nl.id,
            order_index=i,
            layout_key=layout,
            title=str(rb.get("title", "")).strip(),
            summary=str(rb.get("summary", "")).strip(),
            content=str(rb.get("content", "")).strip(),
            image_desc=str(rb.get("image_desc", "")).strip(),
            citations=citations,
        )

    return await get_newsletter(ctx, nl.id)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class GenerateBody(BaseModel):
    title: str = ""
    language: str = "en"
    blockCount: int = 5
    tone: str = "Professional"
    focusPrompt: str = ""
    sourceDocumentIds: list[str] = []
    brandThemeId: str


class PatchBody(BaseModel):
    title: str | None = None
    status: str | None = None
    language: str | None = None
    focusPrompt: str | None = None
    brandThemeId: str | None = None
    themeSnapshot: dict | None = None
    layout: dict | None = None
    blocks: list[dict] | None = None
    overlays: list[dict] | None = None


@router.get("/newsletters", dependencies=[require_permission("resources:read")])
async def list_(ctx: PluginContext = Depends(get_plugin_context)):
    return [nl_to_dict(n) for n in await list_newsletters(ctx)]


@router.post("/newsletters/generate", dependencies=[require_permission("resources:write")])
async def gen(body: GenerateBody, ctx: PluginContext = Depends(get_plugin_context)):
    nl = await generate_newsletter(ctx, body.model_dump())
    return nl_to_dict(nl)


@router.get("/newsletters/{nl_id}", dependencies=[require_permission("resources:read")])
async def get_one(nl_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    nl = await get_newsletter(ctx, nl_id)
    if nl is None:
        raise HTTPException(404, "not found")
    return nl_to_dict(nl)


@router.patch("/newsletters/{nl_id}", dependencies=[require_permission("resources:write")])
async def patch(nl_id: str, body: PatchBody, ctx: PluginContext = Depends(get_plugin_context)):
    nl = await update_newsletter(ctx, nl_id, body.model_dump(exclude_unset=True))
    if nl is None:
        raise HTTPException(404, "not found")
    return nl_to_dict(nl)


def _attachment_headers(title: str, extension: str) -> dict[str, str]:
    """Content-Disposition that makes the browser save rather than render.

    Two filename forms, per RFC 6266: a quote/non-ASCII-free `filename=` that
    every client understands, plus `filename*=UTF-8''...` carrying the real
    title. A raw title in `filename=` is not safe — a quote or newline in a
    newsletter name would corrupt the header, and non-Latin-1 bytes raise
    outright when the response is encoded.
    """
    stem = "_".join((title or "newsletter").split()) or "newsletter"
    ascii_stem = "".join(c for c in stem if c.isalnum() or c in "-_.") or "newsletter"
    quoted = quote(f"{stem}.{extension}", safe="")
    return {
        "Content-Disposition": (
            f'attachment; filename="{ascii_stem}.{extension}"; filename*=UTF-8\'\'{quoted}'
        )
    }


@router.get("/newsletters/{nl_id}/export.html", dependencies=[require_permission("resources:read")])
async def export_html(nl_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    nl = await get_newsletter(ctx, nl_id)
    if nl is None:
        raise HTTPException(404, "not found")
    b = await brand_module.get_or_create_brand(ctx)
    # Rendering inlines every image as a data URI, and on a cache miss
    # storage.to_data_uri falls back to a BLOCKING urllib fetch per image — off
    # the event loop it goes, or one slow image stalls the whole worker and the
    # gateway times the request out as a 500.
    try:
        markup = await asyncio.to_thread(export.render_html, nl, b)
    except Exception as exc:  # noqa: BLE001
        logger.exception("export: HTML render failed for newsletter %s", nl_id)
        raise HTTPException(500, f"Rendering the HTML failed: {type(exc).__name__}: {exc}") from exc
    # Without Content-Disposition the browser renders the HTML in the tab
    # instead of saving it — which is what "Export HTML" was doing.
    return HTMLResponse(markup, headers=_attachment_headers(nl.title, "html"))


@router.get("/newsletters/{nl_id}/export.pdf", dependencies=[require_permission("resources:read")])
async def export_pdf(nl_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    nl = await get_newsletter(ctx, nl_id)
    if nl is None:
        raise HTTPException(404, "not found")
    b = await brand_module.get_or_create_brand(ctx)
    try:
        pdf = await asyncio.to_thread(export.render_pdf, nl, b)
    except (ImportError, OSError) as exc:
        # render_pdf already falls back from WeasyPrint to PyMuPDF, so reaching
        # here means NEITHER engine is usable — i.e. pymupdf is missing too,
        # which would also have broken dataroom PDF extraction.
        logger.exception("export: no usable PDF engine for newsletter %s", nl_id)
        raise HTTPException(
            503,
            f"PDF rendering is unavailable on this server: {type(exc).__name__}: {exc}. "
            "HTML export still works.",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("export: PDF render failed for newsletter %s", nl_id)
        raise HTTPException(500, f"Rendering the PDF failed: {type(exc).__name__}: {exc}") from exc
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers=_attachment_headers(nl.title, "pdf"),
    )
