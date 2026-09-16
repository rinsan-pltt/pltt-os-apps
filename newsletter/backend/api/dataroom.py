"""Dataroom pipeline: upload -> extract -> chunk -> embed -> index, plus
semantic search (over documents) and chunk retrieval (for generation).

No pgvector: plugin Postgres schemas can't add the pgvector extension, so
semantic search goes through the managed ctx.vector service (which embeds server-side
— see palette-org-explorer-app/backend/api/policy_rag/{ingest,retrieve}.py,
the precedent this module mirrors), with a keyword/sequential SQL fallback
when ctx.vector is unavailable — same graceful-degrade shape the source app
already had for a missing embeddings provider.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import or_, select

from palette_sdk import PluginContext, get_plugin_context, require_permission
from palette_sdk.platform_services import UnavailablePlatformService

from newsletter_backend.api import jobs, llm_router, storage
from newsletter_backend.api.chunk import chunk_text
from newsletter_backend.api.config import settings
from newsletter_backend.api.extract import extract_text
from newsletter_backend.api.models import Document, DocumentChunk
from newsletter_backend.api.orgscope import org_repo
from newsletter_backend.api.serialize import doc_to_dict

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dataroom"])

SUMMARY_CHARS = 8000


def _vector_available(ctx: Any) -> bool:
    vector = getattr(ctx, "vector", None)
    return vector is not None and not isinstance(vector, UnavailablePlatformService)


def _guess_suffix(filename: str) -> str:
    _, ext = os.path.splitext(filename)
    return ext or ".bin"


# Kept in sync with extract.py's extract_text(): anything outside this list
# either can't be parsed into text at all (images, audio, archives, ...) or
# would silently decode as garbage via the plain-text fallback.
_ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".md", ".txt"}


def _is_supported_document(filename: str, mime: str) -> bool:
    _, ext = os.path.splitext((filename or "").lower())
    if ext in _ALLOWED_EXTENSIONS:
        return True
    mime = (mime or "").lower()
    return mime == "application/pdf" or "wordprocessingml" in mime or "presentationml" in mime or mime.startswith("text/")


# ---------------------------------------------------------------------------
# Upload + background processing
# ---------------------------------------------------------------------------


async def create_document(ctx: PluginContext, *, filename: str, mime: str, data: bytes) -> Document:
    # Document bytes are only ever read back via storage.cached_bytes() during
    # background extraction (process_document below) — never fetched by the
    # browser or an external API — so pltt dev's file:// URL is fine here and
    # doesn't need a real GCS bucket (see require_public_url in storage.py).
    url = await storage.save_media(
        ctx,
        data,
        prefix="documents",
        category="inputs",
        suffix=_guess_suffix(filename),
        content_type=mime,
        require_public_url=False,
    )
    # org_repo, not ctx.repo: the row must carry the org id the schema's
    # org-isolation policy compares against, which is not ctx.organization_id on
    # the hosted server (see orgscope.py). With ctx.repo this INSERT fails as
    # "new row violates row-level security policy" — but only on the server,
    # since pltt dev's create_all never installs the policy.
    repo = await org_repo(ctx, Document)
    return await repo.create(
        filename=filename, mime=mime, size_bytes=len(data), storage_url=url, status="uploaded"
    )


async def list_documents(ctx: PluginContext) -> list[Document]:
    # OrgRepository filters reads on the same org id it stamps writes with, so
    # this has to agree with create_document — otherwise RLS would happily
    # return the rows and the repo's own WHERE clause would drop them.
    repo = await org_repo(ctx, Document)
    return await repo.list(order_by="-created_at")


async def _index_chunks(ctx: Any, doc: Document, chunks: list[DocumentChunk]) -> bool:
    if not chunks or not _vector_available(ctx):
        return False
    items = [
        {
            "id": c.id,
            "text": c.content,
            "metadata": {
                "document_id": doc.id,
                "document_name": doc.filename,
                "chunk_index": c.chunk_index,
                "organization_id": ctx.organization_id,
            },
        }
        for c in chunks
    ]
    try:
        await ctx.vector.upsert_texts(settings.vector_index, items)
        return True
    except Exception:  # noqa: BLE001 — degrade to lexical/sequential retrieval
        logger.warning("dataroom: vector upsert failed for document %s", doc.id, exc_info=True)
        return False


async def _summarize(ctx: Any, text: str) -> tuple[str, dict]:
    system = (
        "Extract a one-sentence summary (max 24 words) and key facts from the document. "
        "Use only information present in the text. Return JSON: "
        '{"summary": "...", "facts": {"topic": "...", "dates": [], "orgs": [], "people": []}}'
    )
    try:
        out = await llm_router.chat_json(ctx, model=settings.gen_model, system=system, user=text, temperature=0.2)
        summary = str(out.get("summary", "")).strip() or text[:160]
        facts = out.get("facts") or {}
        return summary, facts
    except Exception:  # noqa: BLE001 — summarization is best-effort
        return text[:160].strip(), {}


async def process_document(snapshot: dict, doc_id: str, data: bytes | None = None) -> None:
    """Background pipeline: parse -> chunk -> embed -> summarize.

    The uploaded bytes are passed in directly (`data`) by the upload route, so
    extraction never depends on cross-request state — ctx.storage is upload-only
    (no read/download; see storage.py), so there is no way to fetch them back on
    the server otherwise. Falls back to storage.py's in-process cache only if no
    bytes were handed in (e.g. a legacy re-enqueue).

    Uses jobs.py's RLS-context-safe session machinery (same reasoning as
    images/mascot background jobs: a fresh pooled connection has none of the
    platform's per-request schema/RLS/role context).
    """
    ctx = jobs._JobCtx(snapshot)
    org_id = snapshot["organization_id"]
    factory, is_postgres = jobs._make_session_factory(snapshot.get("engine_url"))
    schema, role = snapshot.get("db_schema"), snapshot.get("db_role")

    async def _context_session():
        session = factory()
        await jobs._apply_plugin_db_context(session, org_id, is_postgres=is_postgres, schema=schema, role=role)
        return session

    async def _load() -> Document | None:
        async with await _context_session() as session:
            return (
                await session.execute(
                    select(Document).where(Document.id == doc_id, Document.organization_id == org_id)
                )
            ).scalar_one_or_none()

    async def _save(**fields: Any) -> None:
        async with await _context_session() as session:
            doc = (
                await session.execute(
                    select(Document).where(Document.id == doc_id, Document.organization_id == org_id)
                )
            ).scalar_one_or_none()
            if doc is None:
                return
            for key, value in fields.items():
                setattr(doc, key, value)
            await session.commit()

    doc = await _load()
    if doc is None:
        return
    try:
        await _save(status="parsing")

        if data is None:
            cached = storage.cached_bytes(doc.storage_url)
            if cached is None:
                raise RuntimeError("uploaded bytes no longer available for extraction")
            data, _content_type = cached

        text, pages = extract_text(data, doc.mime, doc.filename)
        if not text.strip():
            await _save(status="error", error="No extractable text", page_count=pages)
            return

        await _save(status="embedding", page_count=pages)

        pieces = chunk_text(text)
        chunk_rows: list[DocumentChunk] = []
        async with await _context_session() as session:
            for index, (content, tok) in enumerate(pieces):
                chunk = DocumentChunk(
                    document_id=doc.id, organization_id=org_id, chunk_index=index, content=content, token_count=tok
                )
                session.add(chunk)
                chunk_rows.append(chunk)
            await session.commit()
            # No refresh() here: the sessionmaker uses expire_on_commit=False and
            # DocumentChunk.id is a Python-side UUID default (set at flush), so
            # every attribute the pipeline reads below (id/content/chunk_index) is
            # already populated. A refresh would run AFTER this commit, i.e. in a
            # new transaction where the transaction-local `SET LOCAL search_path`
            # no longer applies — that is the "relation newsletter__document_chunk
            # does not exist" (UndefinedTableError) failure.

        if await _index_chunks(ctx, doc, chunk_rows):
            async with await _context_session() as session:
                for chunk in chunk_rows:
                    row = await session.get(DocumentChunk, chunk.id)
                    if row is not None:
                        row.embedded = True
                await session.commit()

        summary, facts = await _summarize(ctx, text[:SUMMARY_CHARS])
        await _save(chunk_count=len(pieces), summary=summary, facts=facts, status="ready")
    except Exception as exc:  # noqa: BLE001 — record any failure on the row
        logger.exception("dataroom: processing failed for document %s", doc_id)
        await _save(status="error", error=str(exc)[:500])


# ---------------------------------------------------------------------------
# Search + retrieval
# ---------------------------------------------------------------------------


async def search_documents(ctx: PluginContext, query: str, *, limit: int = 24) -> list[Document]:
    """Rank ready documents by their best-matching chunk against the query.
    Falls back to keyword search when ctx.vector is unavailable or empty."""
    if _vector_available(ctx):
        try:
            rows = await ctx.vector.search(settings.vector_index, query=query, top_k=limit * 3)
        except Exception:  # noqa: BLE001 — degrade, never hard-fail
            rows = None
        if rows:
            doc_ids: list[str] = []
            seen: set[str] = set()
            for row in rows:
                did = str((row.get("metadata") or {}).get("document_id") or "")
                if did and did not in seen:
                    seen.add(did)
                    doc_ids.append(did)
            if doc_ids:
                found = {
                    d.id: d
                    for d in (
                        await ctx.db.execute(
                            select(Document).where(Document.status == "ready", Document.id.in_(doc_ids[:limit]))
                        )
                    )
                    .scalars()
                    .all()
                }
                ordered = [found[d] for d in doc_ids[:limit] if d in found]
                if ordered:
                    return ordered
    return await _keyword_search(ctx, query, limit)


async def _keyword_search(ctx: PluginContext, query: str, limit: int) -> list[Document]:
    like = f"%{query}%"
    stmt = (
        select(Document)
        .where(Document.status == "ready", or_(Document.filename.ilike(like), Document.summary.ilike(like)))
        .order_by(Document.created_at.desc())
        .limit(limit)
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def retrieve_chunks(ctx: PluginContext, *, query: str, document_ids: list[str], k: int = 12) -> list[dict]:
    """Top-k chunks scoped to the given documents, as RetrievedChunk dicts.
    Falls back to document-order chunks when ctx.vector is unavailable."""
    if _vector_available(ctx):
        try:
            rows = await ctx.vector.search(
                settings.vector_index, query=query or "key highlights", top_k=max(k * 3, k)
            )
        except Exception:  # noqa: BLE001 — degrade, never hard-fail
            rows = None
        if rows:
            hits: list[dict] = []
            for row in rows:
                meta = row.get("metadata") or {}
                did = str(meta.get("document_id") or "")
                if document_ids and did not in document_ids:
                    continue
                content = str(row.get("text") or "")
                hits.append(
                    {
                        "chunkId": str(row.get("id") or ""),
                        "documentId": did,
                        "documentName": str(meta.get("document_name") or ""),
                        "score": round(float(row.get("score") or 0.0), 3),
                        "snippet": content[:240],
                        "content": content,
                    }
                )
                if len(hits) >= k:
                    break
            if hits:
                return hits
    return await _sequential_chunks(ctx, document_ids, k)


async def _sequential_chunks(ctx: PluginContext, document_ids: list[str], k: int) -> list[dict]:
    stmt = (
        select(DocumentChunk.id, DocumentChunk.content, Document.id, Document.filename)
        .join(Document, Document.id == DocumentChunk.document_id)
        .order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)
    )
    if document_ids:
        stmt = stmt.where(DocumentChunk.document_id.in_(document_ids))
    stmt = stmt.limit(k)
    rows = (await ctx.db.execute(stmt)).all()
    return [
        {
            "chunkId": cid,
            "documentId": did,
            "documentName": fname,
            "score": 0.0,
            "snippet": content[:240],
            "content": content,
        }
        for cid, content, did, fname in rows
    ]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class SearchRequest(BaseModel):
    query: str = ""


class RetrieveRequest(BaseModel):
    focusPrompt: str = ""
    sourceDocumentIds: list[str] = []


@router.post("/documents/upload", dependencies=[require_permission("resources:write")])
async def upload(
    background: BackgroundTasks, file: UploadFile = File(...), ctx: PluginContext = Depends(get_plugin_context)
):
    filename = file.filename or "upload.bin"
    mime = file.content_type or "application/octet-stream"
    if not _is_supported_document(filename, mime):
        raise HTTPException(400, "Unsupported file type — upload a PDF, DOCX, PPTX, Markdown, or plain text file.")
    try:
        data = await file.read()
    except Exception as exc:  # noqa: BLE001 — spooling a multipart part can fail on a read-only /tmp
        logger.exception("dataroom: reading the uploaded part failed for %s", filename)
        raise HTTPException(400, f"Could not read the uploaded file: {type(exc).__name__}: {exc}") from exc
    if not data:
        raise HTTPException(400, "Empty file")

    # Everything below is where a hosted-only failure shows up (platform storage,
    # the plugin DB schema/RLS context). Any non-HTTP exception escaping here
    # reaches the browser as a bare 500 with a body DevTools reports as "Failed
    # to load response data", so name the failing stage and the real cause
    # instead — and log the traceback for `pltt logs`.
    try:
        doc = await create_document(ctx, filename=filename, mime=mime, data=data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("dataroom: create_document failed for %s (%d bytes)", filename, len(data))
        raise HTTPException(500, f"Storing the document failed: {type(exc).__name__}: {exc}") from exc

    try:
        snapshot = await jobs.build_ctx_snapshot(ctx)
        background.add_task(process_document, snapshot, doc.id, data)
    except Exception as exc:  # noqa: BLE001 — the row exists; don't fail the upload over scheduling
        logger.exception("dataroom: could not schedule processing for document %s", doc.id)
        doc.status = "error"
        doc.error = f"Could not start processing: {type(exc).__name__}: {exc}"[:500]

    return doc_to_dict(doc)


@router.get("/documents", dependencies=[require_permission("resources:read")])
async def list_docs(ctx: PluginContext = Depends(get_plugin_context)):
    return [doc_to_dict(d) for d in await list_documents(ctx)]


@router.get("/documents/{doc_id}", dependencies=[require_permission("resources:read")])
async def get_doc(doc_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    repo = await org_repo(ctx, Document)
    doc = await repo.get(doc_id)
    if doc is None:
        raise HTTPException(404, "not found")
    return doc_to_dict(doc)


# Page rendering for the document viewer.
#
# The viewer used to show only the extracted text, which is the right thing for
# "what will generation use" and the wrong thing for "let me look at my file".
# PyMuPDF (already a dependency — extract.py uses it for PDF text) renders a
# page exactly as it is: fonts, images, vectors, columns, in their real
# positions. Rendering to an image rather than to positioned HTML is the honest
# choice for a READ-ONLY viewer — nothing can drift.
#
# Formats fitz cannot open (DOCX, PPTX, Markdown, plain text) report kind="text"
# and the viewer keeps showing the extracted text for them. Converting those
# would need LibreOffice, which this plugin does not ship.
_RENDER_DPI = 144
_RENDERABLE_SUFFIXES = (".pdf", ".xps", ".epub", ".mobi", ".fb2", ".cbz", ".svg")


def _fitz_filetype(filename: str, mime: str) -> str | None:
    """The `filetype` fitz should open these bytes as, or None if it cannot."""
    name = (filename or "").lower()
    if mime == "application/pdf" or name.endswith(".pdf"):
        return "pdf"
    for suffix in _RENDERABLE_SUFFIXES:
        if name.endswith(suffix):
            return suffix.lstrip(".")
    return None


async def _open_for_render(ctx: PluginContext, doc: Document):
    """(fitz.Document, page_count) for a renderable document, or (None, 0)."""
    filetype = _fitz_filetype(doc.filename, doc.mime)
    if filetype is None:
        return None, 0
    payload = await storage.read_bytes(doc.storage_url)
    if payload is None:
        return None, 0
    try:
        import fitz

        rendered = fitz.open(stream=payload[0], filetype=filetype)
        return rendered, rendered.page_count
    except Exception:  # noqa: BLE001 — a corrupt or password-locked file is a
        # "no preview" answer, not a 500.
        logger.warning("dataroom: could not open document %s for rendering", doc.id, exc_info=True)
        return None, 0


@router.get("/documents/{doc_id}/preview", dependencies=[require_permission("resources:read")])
async def get_doc_preview(doc_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    """Whether this document can be shown as pages, and each page's true size.

    The sizes let the viewer lay out correctly-shaped page sheets before any
    image has loaded, so the page does not jump as they arrive.
    """
    repo = await org_repo(ctx, Document)
    doc = await repo.get(doc_id)
    if doc is None:
        raise HTTPException(404, "not found")

    rendered, count = await _open_for_render(ctx, doc)
    if rendered is None:
        return {"kind": "text", "pages": []}
    try:
        scale = _RENDER_DPI / 72.0
        pages = [
            {
                "index": i,
                "width": round(rendered[i].rect.width * scale),
                "height": round(rendered[i].rect.height * scale),
            }
            for i in range(count)
        ]
    finally:
        rendered.close()
    return {"kind": "pages", "pages": pages}


@router.get(
    "/documents/{doc_id}/preview/{page}", dependencies=[require_permission("resources:read")]
)
async def get_doc_page(
    doc_id: str, page: int, ctx: PluginContext = Depends(get_plugin_context)
):
    """One rendered page as a PNG."""
    repo = await org_repo(ctx, Document)
    doc = await repo.get(doc_id)
    if doc is None:
        raise HTTPException(404, "not found")

    rendered, count = await _open_for_render(ctx, doc)
    if rendered is None:
        raise HTTPException(404, "no preview available for this document")
    try:
        if page < 0 or page >= count:
            raise HTTPException(404, "page out of range")
        png = rendered[page].get_pixmap(dpi=_RENDER_DPI).tobytes("png")
    finally:
        rendered.close()
    # Private: a document's pages are org-scoped, so they must not land in a
    # shared cache — but the viewer re-requests them on every scroll-back, and
    # re-rendering each time is wasted work.
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/documents/{doc_id}/chunks", dependencies=[require_permission("resources:read")])
async def get_doc_chunks(doc_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    """The extracted text the dataroom actually holds for a document.

    Returned as the stored chunks rather than one reassembled string, because
    that is what retrieval works on — and because consecutive chunks overlap by
    `settings.chunk_overlap` tokens (see chunk.chunk_text), so concatenating
    them would repeat a slice of text at every seam.
    """
    repo = await org_repo(ctx, Document)
    doc = await repo.get(doc_id)
    if doc is None:
        raise HTTPException(404, "not found")
    rows = (
        (
            await ctx.db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == doc_id)
                .order_by(DocumentChunk.chunk_index)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": c.id,
            "index": c.chunk_index,
            "content": c.content,
            "tokenCount": c.token_count,
            "embedded": c.embedded,
        }
        for c in rows
    ]


@router.delete("/documents/{doc_id}", dependencies=[require_permission("resources:write")])
async def delete_doc(doc_id: str, ctx: PluginContext = Depends(get_plugin_context)):
    repo = await org_repo(ctx, Document)
    doc = await repo.get(doc_id)
    if doc is None:
        raise HTTPException(404, "not found")
    if _vector_available(ctx):
        chunk_ids = (
            (await ctx.db.execute(select(DocumentChunk.id).where(DocumentChunk.document_id == doc_id)))
            .scalars()
            .all()
        )
        if chunk_ids:
            try:
                await ctx.vector.delete(settings.vector_index, list(chunk_ids))
            except Exception:  # noqa: BLE001 — degrade, never hard-fail
                logger.warning("dataroom: vector delete failed for document %s", doc_id, exc_info=True)
    # DocumentChunk rows cascade-delete with the Document row (FK ondelete="CASCADE"
    # + ORM cascade="all, delete-orphan" on Document.chunks, see models.py).
    await repo.delete(doc_id)
    return {"ok": True}


@router.post("/documents/search", dependencies=[require_permission("resources:read")])
async def search(req: SearchRequest, ctx: PluginContext = Depends(get_plugin_context)):
    q = req.query.strip()
    if not q:
        docs = [d for d in await list_documents(ctx) if d.status == "ready"]
    else:
        docs = await search_documents(ctx, q)
    return [doc_to_dict(d) for d in docs]


@router.post("/retrieve", dependencies=[require_permission("resources:read")])
async def retrieve(req: RetrieveRequest, ctx: PluginContext = Depends(get_plugin_context)):
    return await retrieve_chunks(ctx, query=req.focusPrompt, document_ids=req.sourceDocumentIds)
