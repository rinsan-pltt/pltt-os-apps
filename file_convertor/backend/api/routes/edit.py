"""Edit Document tool: open a document as editable HTML, export it back.

POST /edit/extract — file → {pages, filename, characters}. `pages` is one
                     entry per source page ({html, width_pt, height_pt}) so
                     the editor can render each as its own correctly-sized
                     sheet, matching the uploaded file's real pagination
                     (PyMuPDF for PDFs, LibreOffice for Office docs).
POST /edit/export  — edited html + format (pdf|docx|html|txt) → file download.
"""

from __future__ import annotations

import anyio
from fastapi import APIRouter, HTTPException, Request, UploadFile

from ..core.files import cleanup, new_workdir, respond_with, safe_name, save_upload
from ..core.html_edit import (
    EDIT_SUPPORTED_EXTS,
    export_html,
    extract_html_bounded,
    real_page_sizes,
    split_into_pages,
)
from ..core.palette import require_permission

router = APIRouter(tags=["edit"])


@router.post("/edit/extract", dependencies=[require_permission("resources:write")])
async def extract_document(file: UploadFile):
    workdir = new_workdir()
    try:
        src = await save_upload(file, workdir, EDIT_SUPPORTED_EXTS)
        html = await extract_html_bounded(src, workdir, prefer_positioned=True)
        if not html.strip():
            raise HTTPException(status_code=422, detail="No readable content found in this document.")

        chunks = split_into_pages(html)
        sizes: list[tuple[float, float]] = []
        if any(w is None or h is None for _, w, h, _ in chunks):
            sizes = await anyio.to_thread.run_sync(real_page_sizes, src, workdir)

        pages = []
        for i, (chunk_html, width_pt, height_pt, positioned) in enumerate(chunks):
            if width_pt is None or height_pt is None:
                if sizes:
                    width_pt, height_pt = sizes[min(i, len(sizes) - 1)]
            pages.append({
                "html": chunk_html,
                "width_pt": width_pt,
                "height_pt": height_pt,
                "positioned": positioned,
            })

        return {"pages": pages, "filename": src.name, "characters": len(html)}
    finally:
        cleanup(workdir)


# Edited documents embed their images as base64 data URIs, so the posted HTML
# routinely exceeds python-multipart's 1 MB default per-part cap. Parse the form
# ourselves with a generous limit (matching the 100 MB upload ceiling).
_MAX_EXPORT_PART = 100 * 1024 * 1024


@router.post("/edit/export", dependencies=[require_permission("resources:write")])
async def export_document(request: Request):
    try:
        form = await request.form(max_part_size=_MAX_EXPORT_PART)
    except Exception as exc:  # noqa: BLE001 — malformed/oversized multipart
        raise HTTPException(status_code=413, detail=f"The edited document is too large to export ({exc}).")
    html = str(form.get("html") or "")
    format = str(form.get("format") or "pdf")
    basename = str(form.get("basename") or "document")
    if not html.strip():
        raise HTTPException(status_code=422, detail="Nothing to export.")
    stem = safe_name(basename, "document").rsplit(".", 1)[0] or "document"
    workdir = new_workdir()
    try:
        out = await anyio.to_thread.run_sync(export_html, html, format, stem, workdir)
        return respond_with(workdir, [out])
    except HTTPException:
        cleanup(workdir)
        raise
    except Exception as exc:  # noqa: BLE001
        cleanup(workdir)
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}")
