"""Compare PDF: a side-by-side viewer with a semantic change report.

POST /compare/pages  — file        -> rendered page images (base64) for the viewer
POST /compare/report — files a,b   -> structured text diff (edit/delete/insert)

The pages are rasterised with PyMuPDF so the frontend can show real, scrollable,
scroll-syncable page views (rather than the browser's own PDF chrome) and let the
user close and re-upload either side. The HTML download report is produced by the
existing `compare-pdf` tool endpoint.
"""

from __future__ import annotations

import base64
import difflib

import anyio
from fastapi import APIRouter, HTTPException, UploadFile

from ..core.documents import DOCUMENT_EXTS, ensure_pdf
from ..core.files import cleanup, new_workdir, save_upload
from ..core.palette import require_permission

router = APIRouter(tags=["compare"])

# Any document — rendered to PDF on the way in (core/documents.py), so a Word
# draft can be compared against the PDF it was exported to.
ACCEPTS = DOCUMENT_EXTS
MAX_PAGES = 80
# ~110 DPI (72 * 1.53) — crisp enough to read, small enough to inline as base64.
_RENDER_ZOOM = 1.53


def _open(src):
    import fitz

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail=f"'{src.name}' is password-protected. Unlock it first.")
    return doc


def _render_pages(src) -> dict:
    import fitz

    doc = _open(src)
    try:
        if doc.page_count > MAX_PAGES:
            raise HTTPException(
                status_code=422,
                detail=f"Compare PDF previews up to {MAX_PAGES} pages per file.",
            )
        matrix = fitz.Matrix(_RENDER_ZOOM, _RENDER_ZOOM)
        pages = []
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(matrix=matrix)
            data = base64.b64encode(pix.tobytes("jpg")).decode("ascii")
            pages.append(
                {"index": i, "src": f"data:image/jpeg;base64,{data}", "w": pix.width, "h": pix.height}
            )
    finally:
        doc.close()
    return {"filename": src.name, "pages": pages}


def _lines_with_pages(src) -> list[tuple[str, int]]:
    doc = _open(src)
    try:
        entries: list[tuple[str, int]] = []
        for pno, page in enumerate(doc, start=1):
            for raw in page.get_text().splitlines():
                line = raw.strip()
                if line:
                    entries.append((line, pno))
    finally:
        doc.close()
    return entries


def _words_with_boxes(src) -> list[dict]:
    """Per-word text + page + bounding box, normalised to a 0..1 fraction of the
    page so the frontend can position highlight overlays independent of the
    render zoom / image size."""
    doc = _open(src)
    try:
        out: list[dict] = []
        for pno, page in enumerate(doc, start=1):
            rect = page.rect
            width = rect.width or 1.0
            height = rect.height or 1.0
            for x0, y0, x1, y1, text, *_ in page.get_text("words"):
                word = text.strip()
                if not word:
                    continue
                out.append(
                    {
                        "text": word,
                        "page": pno,
                        "x": x0 / width,
                        "y": y0 / height,
                        "w": (x1 - x0) / width,
                        "h": (y1 - y0) / height,
                    }
                )
    finally:
        doc.close()
    return out


def _diff_highlights(words_a: list[dict], words_b: list[dict]) -> tuple[list[dict], list[dict]]:
    """Word-level diff → highlight rects. Words that were removed/changed are
    flagged on side A; words that were added/changed are flagged on side B."""
    texts_a = [w["text"] for w in words_a]
    texts_b = [w["text"] for w in words_b]
    highlights_a: list[dict] = []
    highlights_b: list[dict] = []

    def rect(word: dict, kind: str) -> dict:
        return {"page": word["page"], "x": word["x"], "y": word["y"], "w": word["w"], "h": word["h"], "type": kind}

    matcher = difflib.SequenceMatcher(a=texts_a, b=texts_b, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in ("delete", "replace"):
            kind = "edit" if tag == "replace" else "delete"
            highlights_a.extend(rect(words_a[k], kind) for k in range(i1, i2))
        if tag in ("insert", "replace"):
            kind = "edit" if tag == "replace" else "insert"
            highlights_b.extend(rect(words_b[k], kind) for k in range(j1, j2))
    return highlights_a, highlights_b


def _build_report(a, b) -> dict:
    entries_a, entries_b = _lines_with_pages(a), _lines_with_pages(b)
    lines_a = [line for line, _ in entries_a]
    lines_b = [line for line, _ in entries_b]

    changes: list[dict] = []

    def add(kind: str, old: str, new: str, page: int) -> None:
        changes.append(
            {"type": kind, "old": old, "new": new, "page": page, "oldCount": len(old), "newCount": len(new)}
        )

    def page_of(entries, idx, fallback=1):
        if not entries:
            return fallback
        return entries[min(idx, len(entries) - 1)][1]

    matcher = difflib.SequenceMatcher(a=lines_a, b=lines_b, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag == "delete":
            add("delete", "\n".join(lines_a[i1:i2]), "", page_of(entries_a, i1))
        elif tag == "insert":
            add("insert", "", "\n".join(lines_b[j1:j2]), page_of(entries_b, j1))
        else:  # replace — pair old/new lines so each becomes its own edit card,
            # with any surplus lines surfacing as deletions/insertions.
            olds, news = lines_a[i1:i2], lines_b[j1:j2]
            pairs = min(len(olds), len(news))
            for k in range(pairs):
                add("edit", olds[k], news[k], page_of(entries_a, i1 + k))
            for k in range(pairs, len(olds)):
                add("delete", olds[k], "", page_of(entries_a, i1 + k))
            for k in range(pairs, len(news)):
                add("insert", "", news[k], page_of(entries_b, j1 + k))

    highlights_a, highlights_b = _diff_highlights(_words_with_boxes(a), _words_with_boxes(b))
    return {
        "total": len(changes),
        "changes": changes,
        "highlightsA": highlights_a,
        "highlightsB": highlights_b,
    }


@router.post("/compare/pages", dependencies=[require_permission("resources:write")])
async def compare_pages(file: UploadFile):
    workdir = new_workdir()
    try:
        src = await save_upload(file, workdir, ACCEPTS)
        return await anyio.to_thread.run_sync(lambda: _render_pages(ensure_pdf(src, workdir)))
    except ImportError as exc:
        raise HTTPException(status_code=424, detail=f"PDF rendering is unavailable on this deployment ({exc}).")
    finally:
        cleanup(workdir)


@router.post("/compare/report", dependencies=[require_permission("resources:write")])
async def compare_report(a: UploadFile, b: UploadFile):
    workdir = new_workdir()
    try:
        src_a = await save_upload(a, workdir, ACCEPTS)
        src_b = await save_upload(b, workdir, ACCEPTS)
        return await anyio.to_thread.run_sync(
            lambda: _build_report(ensure_pdf(src_a, workdir), ensure_pdf(src_b, workdir))
        )
    except ImportError as exc:
        raise HTTPException(status_code=424, detail=f"PDF comparison is unavailable on this deployment ({exc}).")
    finally:
        cleanup(workdir)
