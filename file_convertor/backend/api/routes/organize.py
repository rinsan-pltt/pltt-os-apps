"""Organize PDF: visual page manager (reorder, rotate, delete).

POST /organize/preview — file -> per-page thumbnail + current rotation
POST /organize/apply   — file + `order` describing the final page sequence
                         -> the reorganized PDF
"""

from __future__ import annotations

import base64

import anyio
from fastapi import APIRouter, Form, HTTPException, UploadFile

from ..core.documents import DOCUMENT_EXTS, ensure_pdf
from ..core.files import cleanup, new_workdir, respond_with, save_upload
from ..core.palette import require_permission

router = APIRouter(tags=["organize"])

# Any document: Word, PowerPoint, Hancom and the rest are rendered to PDF on
# the way in (core/documents.py), so the pages shown are the pages the Rotate,
# Crop, Sign, Watermark and Page-number tools will then work on.
ACCEPTS = DOCUMENT_EXTS
MAX_PAGES = 300


def _preview(src) -> dict:
    import fitz

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")
    if doc.page_count > MAX_PAGES:
        doc.close()
        raise HTTPException(status_code=422, detail=f"Organize PDF supports up to {MAX_PAGES} pages.")

    pages = []
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=fitz.Matrix(0.3, 0.3))
        data = base64.b64encode(pix.tobytes("jpg")).decode("ascii")
        pages.append({"index": i, "thumbnail": f"data:image/jpeg;base64,{data}", "rotation": page.rotation})
    doc.close()
    return {"filename": src.name, "pages": pages}


def _parse_order(order: str, page_count: int) -> list[tuple[int, int]]:
    """`order` is comma-separated tokens "idx" or "idx:angle" (1-based
    original page index, optional rotation delta in degrees)."""
    tokens = [t.strip() for t in order.split(",") if t.strip()]
    if not tokens:
        raise HTTPException(status_code=422, detail="No pages selected — the document would be empty.")
    result = []
    for token in tokens:
        idx_s, _, angle_s = token.partition(":")
        try:
            idx = int(idx_s)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid page reference '{token}'.")
        if not (1 <= idx <= page_count):
            raise HTTPException(status_code=422, detail=f"Page {idx} does not exist in this document.")
        angle = int(angle_s) if angle_s else 0
        if angle % 90 != 0:
            raise HTTPException(status_code=422, detail=f"Rotation for page {idx} must be a multiple of 90.")
        result.append((idx, angle))
    return result


def _apply(src, workdir, order: str):
    # Built on PyMuPDF (fitz), not pypdf: pypdf is absent on the hosted platform
    # and importing it 424'd the whole Organize tool with a missing-dependency
    # error. fitz is already used by the /organize/preview handler above.
    import fitz

    from ..core.files import output_dir

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    try:
        plan = _parse_order(order, doc.page_count)
        organized = fitz.open()
        try:
            for idx, angle in plan:
                organized.insert_pdf(doc, from_page=idx - 1, to_page=idx - 1)
                if angle:
                    page = organized[-1]
                    page.set_rotation((page.rotation + angle) % 360)
            out = output_dir(workdir) / f"{src.stem}_organized.pdf"
            organized.save(str(out))
        finally:
            organized.close()
    finally:
        doc.close()
    return [out]


@router.post("/organize/preview", dependencies=[require_permission("resources:write")])
async def organize_preview(file: UploadFile):
    workdir = new_workdir()
    try:
        src = await save_upload(file, workdir, ACCEPTS)
        return await anyio.to_thread.run_sync(lambda: _preview(ensure_pdf(src, workdir)))
    finally:
        cleanup(workdir)


@router.post("/organize/apply", dependencies=[require_permission("resources:write")])
async def organize_apply(file: UploadFile, order: str = Form(...)):
    workdir = new_workdir()
    try:
        src = await save_upload(file, workdir, ACCEPTS)
        outputs = await anyio.to_thread.run_sync(lambda: _apply(ensure_pdf(src, workdir), workdir, order))
        return respond_with(workdir, outputs)
    except HTTPException:
        cleanup(workdir)
        raise
    except Exception as exc:  # noqa: BLE001
        cleanup(workdir)
        raise HTTPException(status_code=500, detail=f"Organize failed: {exc}")
