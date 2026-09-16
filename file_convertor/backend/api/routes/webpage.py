"""HTML to PDF: convert a URL's page content to PDF (no browser engine, so
JavaScript-rendered content and heavy CSS layouts are not reproduced —
articles and text-focused pages convert well)."""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Form

from ..core.files import cleanup, new_workdir, output_dir, respond_with, safe_name
from ..core.html_edit import render_html_to_pdf
from ..core.net import fetch_html
from ..core.palette import require_permission

router = APIRouter(tags=["webpage"])


def _convert(url: str, workdir):
    html = fetch_html(url)
    stem = safe_name(url.split("//", 1)[-1].split("/")[0] or "page", "page").rsplit(".", 1)[0] or "page"
    out = output_dir(workdir) / f"{stem}.pdf"
    render_html_to_pdf(html, out)
    return [out]


@router.post("/tools/html-to-pdf", dependencies=[require_permission("resources:write")])
async def html_to_pdf(url: str = Form(...)):
    workdir = new_workdir()
    try:
        outputs = await anyio.to_thread.run_sync(_convert, url.strip(), workdir)
        return respond_with(workdir, outputs)
    except Exception:
        cleanup(workdir)
        raise
