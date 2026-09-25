"""HTML to PDF: convert a URL's page to PDF.

Three engines, best first:

  1. Chromium through Playwright, when the host has it. Scripts run, so a page
     whose content is assembled in the browser converts like any other, and the
     PDF is Chromium's own print output — what the reader would have got from
     File > Print.
  2. LibreOffice over the fetched HTML, with the images downloaded alongside.
     No scripts, but the page's pictures, tables and most of its CSS survive.
  3. PyMuPDF's Story engine, which is text-only.

Whatever renders it, the result is checked before it is returned: a sign-in
wall, a bot check, a "turn on JavaScript" notice or an empty shell is reported
to the user as such rather than handed over as a PDF of itself.
"""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Form, HTTPException

from ..core.browser_render import browser_available, render_url_to_pdf
from ..core.files import cleanup, new_workdir, output_dir, respond_with, safe_name
from ..core.net import fetch_page
from ..core.palette import require_permission
from ..core.webpage_render import _visible_text, content_problem, render_page_pdf

router = APIRouter(tags=["webpage"])


def _stem_for(url: str) -> str:
    """Name the file after the host of the page actually rendered, which after
    a redirect chain is not always the host that was pasted."""
    host = safe_name(url.split("//", 1)[-1].split("/")[0] or "page", "page")
    return host.rsplit(".", 1)[0] or "page"


def _convert(url: str, workdir):
    if browser_available():
        staged = workdir / "rendered.pdf"
        rendered = render_url_to_pdf(url, staged)
        problem = content_problem(rendered.text, had_browser=True)
        if problem:
            raise HTTPException(status_code=422, detail=problem)
        out = output_dir(workdir) / f"{_stem_for(rendered.url)}.pdf"
        staged.replace(out)
        return [out]

    page = fetch_page(url)
    problem = content_problem(_visible_text(page.html), had_browser=False)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    out = output_dir(workdir) / f"{_stem_for(page.url)}.pdf"
    render_page_pdf(page, workdir, out)
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
