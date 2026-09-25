"""High-fidelity document editing support: document -> HTML -> document.

Extraction keeps layout: PDFs use PyMuPDF's HTML export (positioned text +
embedded images); Office formats go through LibreOffice's HTML filter with
referenced images inlined as data URIs. Export converts the edited HTML back
to PDF/DOCX via LibreOffice, with dependency-light fallbacks so the tool
still functions on deployments without it.
"""

from __future__ import annotations

import base64
import html as html_lib
import logging
import mimetypes
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import NamedTuple

import anyio
from fastapi import HTTPException

from .files import output_dir
from .hwpx_ops import HWP_EXTS
from .office import convert_with_soffice, find_soffice
from .sheet_grid import SPREADSHEET_EXTS

logger = logging.getLogger(__name__)

# Generous cap on the whole extract (pdf2docx + LibreOffice reconstruction
# for PDFs is the slow, occasionally-unbounded leg) — without this, a
# pathological document can block `pdf2docx.Converter.convert()` forever
# with no way for the request to ever come back, which looks exactly like
# the whole app being "stuck". A real, table-heavy one-page invoice was
# measured taking ~40s through this path, so the cap has real headroom above it.
EXTRACTION_TIMEOUT_S = 120

TEXT_EXTS = {".txt", ".md", ".log"}
PDF_EXTS = {".pdf"}
SOFFICE_EXTS = {
    ".docx", ".doc", ".odt", ".rtf",
    ".xlsx", ".xlsm", ".xls", ".ods", ".csv",
    ".pptx", ".ppt", ".odp",
}
# .hwp/.hwpx are read by `hwpx_ops.hwp_to_html` (python-hwpx for .hwpx,
# LibreOffice's read-only import filter for legacy .hwp) rather than by the
# SOFFICE path: no LibreOffice build imports the .hwpx container.
EDIT_SUPPORTED_EXTS = TEXT_EXTS | PDF_EXTS | SOFFICE_EXTS | HWP_EXTS

_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL)
_BODY_RE = re.compile(r"<body\b[^>]*>(.*)</body>", re.IGNORECASE | re.DOTALL)
_IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', re.IGNORECASE)
_DATA_IMG_RE = re.compile(r'src="data:[^"]*"', re.IGNORECASE)


def extract_data_images(html: str) -> tuple[str, dict[str, str]]:
    """Replace every embedded base64 image with a short placeholder token.
    Used before sending document HTML to an LLM (e.g. Translate PDF) — image
    data can be megabytes of tokens the model doesn't need to see and could
    corrupt, and it never needs to touch a third-party API."""
    mapping: dict[str, str] = {}
    counter = 0

    def repl(match: re.Match) -> str:
        nonlocal counter
        key = f"__IMG_PLACEHOLDER_{counter}__"
        mapping[key] = match.group(0)
        counter += 1
        return f'src="{key}"'

    return _DATA_IMG_RE.sub(repl, html), mapping


def restore_data_images(html: str, mapping: dict[str, str]) -> str:
    for key, original in mapping.items():
        html = html.replace(f'src="{key}"', original)
    return html


def extract_html(src: Path, workdir: Path, *, prefer_positioned: bool = False) -> str:
    """`prefer_positioned` only affects PDFs: True places every line at its
    real (top, left) from the source -- an exact visual match, which is what
    the Edit Document editor promises. False (the default, used by tools
    that consume the HTML's *structure* rather than display it -- PDF to
    Markdown, PDF to HWP) prefers pdf2docx + LibreOffice's reconstruction,
    which rebuilds real `<table>` elements and heading levels that the
    positioned path can't infer, at the cost of visual-fidelity drift on
    multi-column layouts or space-aligned text."""
    ext = src.suffix.lower()
    if ext in PDF_EXTS:
        return _pdf_to_html(src, workdir, prefer_positioned=prefer_positioned)
    if ext in TEXT_EXTS:
        text = src.read_text(encoding="utf-8", errors="replace")
        paragraphs = "".join(
            f"<p>{html_lib.escape(line) or '<br>'}</p>" for line in text.splitlines()
        )
        return paragraphs or "<p><br></p>"
    if ext in HWP_EXTS:
        # Legacy .hwp opens in LibreOffice, so it can take the same positioned
        # PDF route as Office docs for an exact visual match. .hwpx cannot —
        # LibreOffice has no importer for that container — so it is read
        # structurally (paragraphs, headings, tables) and edited as a flowing
        # page instead.
        from .hwpx_ops import hwp_to_html

        if prefer_positioned and ext == ".hwp":
            pdf = _office_to_pdf(src, workdir)
            if pdf is not None:
                return _pdf_to_positioned_html(pdf)
        return hwp_to_html(src, workdir)
    if ext in SPREADSHEET_EXTS and prefer_positioned:
        # A workbook is a grid, not a page: rendering it to PDF (the branch
        # below) produces a flat picture of Calc's print area with no cells,
        # no column letters and no row numbers -- nothing that can be edited
        # as a spreadsheet. Read the real grid instead, and only fall through
        # if the file turns out not to be a readable workbook.
        from .sheet_grid import spreadsheet_to_html

        grid = spreadsheet_to_html(src, workdir)
        if grid:
            return grid
    if ext in SOFFICE_EXTS:
        # For the editor (positioned), render the document to PDF via
        # LibreOffice first, then reuse the exact positioned-PDF pipeline. This
        # is far more faithful than LibreOffice's HTML export — which for
        # PPTX collapses to a text outline (no slide pages, no shapes, no
        # placement) and for DOCX mishandles image sizing. Going through PDF
        # gives every slide/page its real geometry, images via
        # `_page_images_html`, and shapes/table rules via `_page_drawings_html`.
        if prefer_positioned:
            pdf = _office_to_pdf(src, workdir)
            if pdf is not None:
                return _pdf_to_positioned_html(pdf)
        return _office_to_html(src, workdir)
    raise HTTPException(
        status_code=422,
        detail=f"'{src.name}' can't be used here — this tool works with: {', '.join(sorted(EDIT_SUPPORTED_EXTS))}.",
    )


async def extract_html_bounded(
    src: Path, workdir: Path, timeout: float = EXTRACTION_TIMEOUT_S, *, prefer_positioned: bool = False,
) -> str:
    """`extract_html`, run off the event loop with a hard time cap. Every
    caller needs this, not the raw sync function, so a slow-or-hung
    conversion always returns an error instead of hanging the request."""
    try:
        with anyio.fail_after(timeout):
            return await anyio.to_thread.run_sync(
                lambda: extract_html(src, workdir, prefer_positioned=prefer_positioned),
                abandon_on_cancel=True,
            )
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="This document took too long to process. Try a smaller or simpler file.",
        )


class PageChunk(NamedTuple):
    """One rendered unit of the opened document. `kind="page"` is a paper
    page (a real PDF/Office page, sized in points); `kind="sheet"` is a
    worksheet grid, which has no page size at all -- it is as wide as its
    columns and as long as its rows."""

    html: str
    width_pt: "float | None"
    height_pt: "float | None"
    positioned: bool
    kind: str = "page"
    name: "str | None" = None
    # Sheet chunks only: {rows, cols, used_rows, used_cols, truncated} — the
    # grid is capped (see sheet_grid.MAX_ROWS/MAX_COLS), and the editor has to
    # be able to tell the user when it is showing less than the whole sheet.
    meta: "dict | None" = None


# The positioned-HTML fallback wraps each PDF page in its own
# `<div id="pageN" style="width:...pt;height:...pt">` (see
# `_pdf_to_positioned_html`) -- real per-page geometry, no extra work needed.
_POSITIONED_PAGE_RE = re.compile(
    r'<div class="pdf-page"><div id="page\d+" style="width:([\d.]+)pt;height:([\d.]+)pt[^"]*">(.*?)</div>\s*</div>',
    re.DOTALL,
)
# A spreadsheet arrives as one `<div class="xl-sheet" data-sheet-name="...">`
# per worksheet (see sheet_grid.py) -- each becomes its own grid in the editor.
_SHEET_RE = re.compile(r'<div class="xl-sheet"([^>]*)>(.*?)</div>', re.DOTALL)
_SHEET_ATTR_RE = re.compile(r'data-([a-z-]+)="([^"]*)"')


def _sheet_attrs(attrs: str) -> dict:
    return {k: html_lib.unescape(v) for k, v in _SHEET_ATTR_RE.findall(attrs)}


def _sheet_meta(attrs: dict) -> dict:
    def number(key: str) -> int:
        try:
            return int(attrs.get(key, "0"))
        except ValueError:
            return 0

    return {
        "rows": number("rows"),
        "cols": number("cols"),
        "used_rows": number("used-rows"),
        "used_cols": number("used-cols"),
        "truncated": attrs.get("truncated") == "true",
    }


# The pdf2docx/LibreOffice pipeline marks the first paragraph of each new
# source page this way -- pdf2docx inserts a real hard page break for every
# original PDF page boundary when it rebuilds the DOCX.
_PAGE_BREAK_RE = re.compile(
    r'<(?:p|div)\b[^>]*style="[^"]*page-break-before\s*:\s*always[^"]*"[^>]*>',
    re.IGNORECASE,
)


def split_into_pages(html: str) -> list[PageChunk]:
    """Split extracted document HTML into per-page chunks the editor can
    render as separate, correctly-sized pages. Returns the whole thing as a
    single chunk (size unknown -- caller falls back to `real_page_sizes`)
    when no page markers are present.

    `positioned=True` means every element in that chunk carries a real
    `top`/`left`/`position:absolute` matching the source PDF exactly -- the
    editor must render it edge-to-edge (no padding, no scrollbar) or those
    coordinates land in the wrong place. `positioned=False` is normal
    flowing prose (pdf2docx/LibreOffice reconstruction, or plain text),
    which wants the padded "document" look and can safely scroll if
    reconstructed content runs longer than the original page.

    `kind="sheet"` chunks (one per worksheet of an uploaded spreadsheet)
    have no page geometry at all: the editor renders them as a scrollable
    grid named after the worksheet, not as a paper page."""
    sheets = [(_sheet_attrs(attrs), body) for attrs, body in _SHEET_RE.findall(html)]
    if sheets:
        return [
            PageChunk(
                body, None, None, False, "sheet",
                attrs.get("sheet-name") or f"Sheet{i + 1}",
                _sheet_meta(attrs),
            )
            for i, (attrs, body) in enumerate(sheets)
        ]

    positioned = _POSITIONED_PAGE_RE.findall(html)
    if positioned:
        return [PageChunk(body, float(w), float(h), True) for w, h, body in positioned]

    breaks = list(_PAGE_BREAK_RE.finditer(html))
    if not breaks:
        return [PageChunk(html, None, None, False)]
    chunks: list[str] = []
    start = 0
    for m in breaks:
        chunks.append(html[start : m.start()])
        start = m.start()
    chunks.append(html[start:])
    return [PageChunk(c, None, None, False) for c in chunks if c.strip()] or [
        PageChunk(html, None, None, False)
    ]


def real_page_sizes(src: Path, workdir: Path) -> list[tuple[float, float]]:
    """Real per-page (width_pt, height_pt) for `src`, in document order --
    read directly for a PDF, or by rendering to a throwaway PDF first (via
    LibreOffice, which does real page layout unlike its HTML export) for
    every other format. Returns `[]` if it can't be determined, so callers
    can fall back to a sane default rather than fail the whole extraction."""
    import fitz

    pdf_path = src
    if src.suffix.lower() != ".pdf":
        from .office import convert_with_soffice, find_soffice

        if not find_soffice():
            return []
        try:
            pdf_dir = workdir / "pagesize"
            pdf_dir.mkdir(exist_ok=True)
            pdf_path = convert_with_soffice(src, pdf_dir, "pdf")
        except Exception:  # noqa: BLE001
            return []
    try:
        doc = fitz.open(str(pdf_path))
    except Exception:  # noqa: BLE001
        return []
    try:
        return [(page.rect.width, page.rect.height) for page in doc]
    finally:
        doc.close()


def _pdf_to_html(src: Path, workdir: Path, *, prefer_positioned: bool = False) -> str:
    import fitz

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")
    doc.close()

    if prefer_positioned:
        # Exact visual match: every line at its real (top, left) from the
        # source. Falls back to the reconstruction below only if the page has
        # no extractable text at all (e.g. a scanned image with no text layer).
        positioned = _pdf_to_positioned_html(src)
        if _has_text_content(positioned):
            return positioned
        reconstructed = _pdf_via_docx(src, workdir)
        return reconstructed if reconstructed is not None else positioned

    # Default: pdf2docx reconstructs REAL structure from the PDF -- tables
    # become <table>, text flows with its alignment -- then LibreOffice
    # renders that DOCX as HTML exactly like a Word upload. Best-effort: it
    # can drift from the source on multi-column layouts or space-aligned
    # text, which is why the editor (see `prefer_positioned` above) doesn't
    # use this as its primary path. The positioned-HTML fallback below can't
    # rebuild tables (PDF stores them as drawn lines, not markup).
    reconstructed = _pdf_via_docx(src, workdir)
    if reconstructed is not None:
        return reconstructed
    return _pdf_to_positioned_html(src)


def _has_text_content(html: str) -> bool:
    return bool(re.search(r">\s*[^\s<][^<]*<", html))


def _pdf_via_docx(src: Path, workdir: Path) -> str | None:
    if not find_soffice():
        return None
    try:
        from pdf2docx import Converter
    except ImportError:
        return None
    docx_dir = workdir / "pdfdocx"
    docx_dir.mkdir(exist_ok=True)
    docx_path = docx_dir / f"{src.stem}.docx"
    try:
        converter = Converter(str(src))
        converter.convert(str(docx_path))
        converter.close()
        if not docx_path.is_file():
            return None
        html = _office_to_html(docx_path, workdir)
        return html if html.strip() else None
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — reconstruction failed, use positioned HTML
        return None


_PAGE_DIV_RE = re.compile(r'(<div id="page\d+" style=")([^"]*)(")')
_POSITIONED_P_RE = re.compile(r'(<p style=")([^"]*\btop\s*:[^"]*)(")')
_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_LINE_EPSILON_PT = 0.5  # treat near-horizontal/near-vertical strokes as exactly so


def _rgb(color: "tuple[float, float, float] | None", default: str = "0,0,0") -> str:
    if color is None:
        return default
    return ",".join(str(round(c * 255)) for c in color)


def _drawing_bbox(items: list) -> "tuple[float, float, float, float] | None":
    """Axis-aligned bounding box of a vector drawing's points/rects."""
    xs: list[float] = []
    ys: list[float] = []
    for item in items:
        for comp in item[1:]:
            if hasattr(comp, "x0"):  # Rect
                xs.extend([comp.x0, comp.x1])
                ys.extend([comp.y0, comp.y1])
            elif hasattr(comp, "x") and hasattr(comp, "y"):  # Point
                xs.append(comp.x)
                ys.append(comp.y)
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _page_drawings_html(page) -> "tuple[str, str]":  # noqa: ANN001
    """Rebuild the page's vector graphics as `position:absolute` divs, since
    `page.get_text("html")` emits only text. FILLED shapes (solid boxes, and
    the thin slivers a gradient is drawn as) become a div at the shape's
    bounding rectangle with its fill colour/opacity; STROKES become thin divs
    (table grids, rules, borders).

    Returns (background, foreground): fills that cover most of the page (the
    page/slide background) go in `background` so they render UNDER images, while
    smaller shape fills and all strokes go in `foreground` so they render OVER
    images (e.g. a gradient box over its own soft shadow). This keeps the
    layering right without needing the PDF's exact paint order."""
    page_area = max(1.0, page.rect.width * page.rect.height)
    background: list[str] = []
    foreground: list[str] = []
    for drawing in page.get_drawings():
        dtype = drawing.get("type", "")
        has_stroke = "s" in dtype
        has_fill = "f" in dtype
        stroke_w = drawing.get("width") or 1.0
        stroke_color = _rgb(drawing.get("color")) if has_stroke else None
        items = drawing.get("items", [])

        # Fill: approximate any filled path by its bounding rectangle.
        fill_color = drawing.get("fill")
        if has_fill and fill_color is not None:
            r, g, b = (round(c * 255) for c in fill_color)
            opacity = drawing.get("fill_opacity")
            opacity = 1 if opacity is None else opacity
            bbox = _drawing_bbox(items)
            if bbox and (bbox[2] - bbox[0]) > 0.1 and (bbox[3] - bbox[1]) > 0.1:
                x0, y0, x1, y1 = bbox
                covers_page = ((x1 - x0) * (y1 - y0)) >= 0.6 * page_area
                # `fc-shape` = a movable/resizable shape fill; `fc-shape-bg` = the
                # page/slide background (never groups into a shape selection).
                cls = "fc-shape-bg" if covers_page else "fc-shape"
                div = (
                    f'<div class="{cls}" style="position:absolute;left:{x0:.2f}pt;top:{y0:.2f}pt;'
                    f'width:{x1 - x0:.2f}pt;height:{y1 - y0:.2f}pt;'
                    f'background-color:rgba({r},{g},{b},{opacity});"></div>'
                )
                (background if covers_page else foreground).append(div)

        # Stroke: ruled lines and rectangle borders (table grids, underlines).
        if has_stroke:
            for item in items:
                kind = item[0]
                if kind == "re":
                    rect = item[1]
                    foreground.append(
                        f'<div class="fc-shape" style="position:absolute;left:{rect.x0:.2f}pt;top:{rect.y0:.2f}pt;'
                        f'width:{rect.width:.2f}pt;height:{rect.height:.2f}pt;'
                        f'border:{stroke_w:.2f}pt solid rgb({stroke_color});"></div>'
                    )
                elif kind == "l":
                    p1, p2 = item[1], item[2]
                    if abs(p1.y - p2.y) <= _LINE_EPSILON_PT:  # horizontal
                        left, width_pt = min(p1.x, p2.x), abs(p2.x - p1.x)
                        top = min(p1.y, p2.y) - stroke_w / 2
                        foreground.append(
                            f'<div class="fc-shape" style="position:absolute;left:{left:.2f}pt;top:{top:.2f}pt;'
                            f'width:{width_pt:.2f}pt;height:{stroke_w:.2f}pt;background-color:rgb({stroke_color});"></div>'
                        )
                    elif abs(p1.x - p2.x) <= _LINE_EPSILON_PT:  # vertical
                        top, height_pt = min(p1.y, p2.y), abs(p2.y - p1.y)
                        left = min(p1.x, p2.x) - stroke_w / 2
                        foreground.append(
                            f'<div class="fc-shape" style="position:absolute;left:{left:.2f}pt;top:{top:.2f}pt;'
                            f'width:{stroke_w:.2f}pt;height:{height_pt:.2f}pt;background-color:rgb({stroke_color});"></div>'
                        )
                    # Diagonal strokes are rare outside decorative art (not
                    # table grids) and aren't worth a rotated div.
    return "".join(background), "".join(foreground)


_IMAGE_MAX_DIM = 1600  # cap embedded images so the base64 payload stays sane
_PIX_MODE = {1: "L", 2: "LA", 3: "RGB", 4: "RGBA"}


def _pixmap_data_uri(pix) -> str:  # noqa: ANN001
    """Encode a PyMuPDF pixmap as a data URI, downscaling oversized images and
    using JPEG for opaque ones — so an image-heavy document doesn't produce a
    huge base64 blob (which the editor round-trips and which would otherwise
    blow past the export upload limit). Transparent images stay PNG."""
    import base64
    import io

    from PIL import Image

    img = Image.frombytes(_PIX_MODE.get(pix.n, "RGB"), (pix.width, pix.height), pix.samples)
    if max(img.width, img.height) > _IMAGE_MAX_DIM:
        scale = _IMAGE_MAX_DIM / max(img.width, img.height)
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))))
    buf = io.BytesIO()
    if img.mode in ("LA", "RGBA"):
        img.save(buf, "PNG", optimize=True)
        mime = "png"
    else:
        img.convert("RGB").save(buf, "JPEG", quality=82)
        mime = "jpeg"
    return f"data:image/{mime};base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _page_images_html(page, doc) -> str:  # noqa: ANN001
    """Emit each raster image (logos, QR codes, photos) as a `position:absolute`
    `<img>` with EXPLICIT left/top/width/height in points, taken from the page's
    real image placement rectangles. PyMuPDF's own `get_text("html")` positions
    images with a `transform:matrix(...)` in a scaled space that neither our PDF
    re-renderer nor a plain coordinate reader can place reliably — so those are
    stripped and replaced by these coordinate-based tags, which the editor and
    the export renderer both handle identically."""
    import fitz

    # Soft mask per image xref, so a shape's soft shadow (a grey image + alpha
    # mask) composites to a transparent shadow instead of a solid black box.
    smasks = {img[0]: img[1] for img in page.get_images(full=True)}

    divs: list[str] = []
    cache: dict[int, str] = {}
    # get_image_info lists only images actually painted on the page (with their
    # placement bbox), so standalone mask xrefs used as sub-components are
    # excluded — exactly what we want.
    for info in page.get_image_info(xrefs=True):
        xref = info.get("xref", 0)
        rect = fitz.Rect(info["bbox"])
        if not xref or rect.width <= 0 or rect.height <= 0:
            continue
        data_uri = cache.get(xref)
        if data_uri is None:
            try:
                pix = fitz.Pixmap(doc, xref)
                smask = smasks.get(xref, 0)
                if smask:
                    pix = fitz.Pixmap(pix, fitz.Pixmap(doc, smask))
                if pix.colorspace and pix.n - pix.alpha >= 4:  # CMYK → RGB
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                data_uri = _pixmap_data_uri(pix)
            except Exception:  # noqa: BLE001 — unreadable image, skip it
                continue
            cache[xref] = data_uri
        style = (
            f"position:absolute;left:{rect.x0:.2f}pt;top:{rect.y0:.2f}pt;"
            f"width:{rect.width:.2f}pt;height:{rect.height:.2f}pt;"
        )
        divs.append(f'<img style="{style}" src="{data_uri}">')
    return "".join(divs)


def _pdf_to_positioned_html(src: Path) -> str:
    import fitz

    doc = fitz.open(str(src))
    # `page.get_text("html")` gives every paragraph a `top`/`left` in its
    # inline style, but never sets `position: absolute` -- without that,
    # `top`/`left` do nothing on a normal (statically positioned) element and
    # every paragraph just flows top-to-bottom instead, losing the original
    # layout (including any whitespace that came from vertical position
    # alone, not real spacing). Make the position real: the page div becomes
    # the positioning context, and each positioned paragraph is pinned to it.
    # (<img> tags already carry `position:absolute` from PyMuPDF itself.)
    pages = []
    for page in doc:
        html = page.get_text("html")
        # Drop PyMuPDF's own transform-positioned <img> tags; they're re-added
        # below with explicit point coordinates (see _page_images_html).
        html = _IMG_TAG_RE.sub("", html)
        html = _PAGE_DIV_RE.sub(r"\1\2;position:relative;overflow:hidden\3", html)
        html = _POSITIONED_P_RE.sub(r"\1\2;position:absolute;margin:0\3", html)
        # Reinsert non-text content under the text layer, layered bottom→top:
        # page background fill → images (incl. shape shadows) → shape fills &
        # rules. This keeps a slide background behind its images, yet a gradient
        # shape's fill above its own soft shadow.
        background, foreground = _page_drawings_html(page)
        overlay = background + _page_images_html(page, doc) + foreground
        if overlay:
            html = re.sub(r'<div id="page\d+"[^>]*>', lambda m: m.group(0) + overlay, html, count=1)
        pages.append(f'<div class="pdf-page">{html}</div>')
    doc.close()
    return "\n".join(pages)


def _office_to_html(src: Path, workdir: Path) -> str:
    html_dir = workdir / "html"
    html_dir.mkdir(exist_ok=True)
    produced = convert_with_soffice(src, html_dir, "html")
    raw = produced.read_text(encoding="utf-8", errors="replace")
    raw = _SCRIPT_RE.sub("", raw)
    raw = _inline_local_images(raw, produced.parent)
    body = _BODY_RE.search(raw)
    return body.group(1) if body else raw


def _office_to_pdf(src: Path, workdir: Path) -> "Path | None":
    """Render a Word/PowerPoint/etc. document to PDF via LibreOffice, so the
    positioned-PDF editor pipeline can open it with full visual fidelity
    (slides as pages, images, shapes). Returns None when LibreOffice is absent
    or the conversion fails, so the caller can fall back to HTML export."""
    if not find_soffice():
        return None
    pdf_dir = workdir / "office_pdf"
    pdf_dir.mkdir(exist_ok=True)
    try:
        return convert_with_soffice(src, pdf_dir, "pdf")
    except Exception:  # noqa: BLE001 — fall back to the HTML export path
        return None


def _inline_local_images(html: str, base_dir: Path) -> str:
    """LibreOffice writes <img> files next to the HTML — embed them as data URIs."""

    def repl(match: re.Match) -> str:
        src_value = match.group(2)
        if src_value.startswith(("data:", "http:", "https:")):
            return match.group(0)
        candidate = (base_dir / Path(src_value).name).resolve()
        if not str(candidate).startswith(str(base_dir.resolve())) or not candidate.is_file():
            return match.group(0)
        mime = mimetypes.guess_type(candidate.name)[0] or "image/png"
        data = base64.b64encode(candidate.read_bytes()).decode("ascii")
        return f"{match.group(1)}data:{mime};base64,{data}{match.group(3)}"

    return _IMG_SRC_RE.sub(repl, html)


# ------------------------------------------------------------------- export

class _TextExtractor(HTMLParser):
    _BLOCK_TAGS = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        collapsed = re.sub(r"[ \t]+", " ", "".join(self.parts))
        return re.sub(r"\n{3,}", "\n\n", collapsed).strip()


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return parser.text()


class _MarkdownConverter(HTMLParser):
    """Best-effort HTML -> Markdown: headings, paragraphs, lists, tables,
    bold/italic, links and images. Unknown tags are ignored (their text still
    flows through)."""

    _INLINE_WRAP = {"b": "**", "strong": "**", "i": "*", "em": "*", "code": "`"}

    def __init__(self) -> None:
        super().__init__()
        self.out: list[str] = []
        self._list_stack: list[str] = []  # "ul" | "ol"
        self._ol_counters: list[int] = []
        self._table_row: list[str] | None = None
        self._table_rows: list[list[str]] = []
        self._in_table = False
        self._cell_buf: list[str] = []
        self._link_href: str | None = None
        self._skip_depth = 0  # inside <script>/<style>

    def _write(self, text: str) -> None:
        if self._in_table:
            self._cell_buf.append(text)
        else:
            self.out.append(text)

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        attrs_d = dict(attrs)
        if tag in ("script", "style"):
            self._skip_depth += 1
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._write("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "p" or tag == "div":
            self._write("\n\n")
        elif tag == "br":
            self._write("  \n")
        elif tag in self._INLINE_WRAP:
            self._write(self._INLINE_WRAP[tag])
        elif tag == "a":
            self._link_href = attrs_d.get("href")
            self._write("[")
        elif tag == "img":
            alt = attrs_d.get("alt", "image")
            src = attrs_d.get("src", "")
            if not src.startswith("data:"):  # skip inlined base64 blobs
                self._write(f"![{alt}]({src})")
        elif tag == "ul":
            self._list_stack.append("ul")
        elif tag == "ol":
            self._list_stack.append("ol")
            self._ol_counters.append(0)
        elif tag == "li":
            depth = max(0, len(self._list_stack) - 1)
            indent = "  " * depth
            if self._list_stack and self._list_stack[-1] == "ol":
                self._ol_counters[-1] += 1
                self._write(f"\n{indent}{self._ol_counters[-1]}. ")
            else:
                self._write(f"\n{indent}- ")
        elif tag == "table":
            self._in_table = True
            self._table_rows = []
        elif tag == "tr":
            self._table_row = []
        elif tag in ("td", "th"):
            self._cell_buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in self._INLINE_WRAP:
            self._write(self._INLINE_WRAP[tag])
        elif tag == "a":
            href = self._link_href or ""
            self._write(f"]({href})")
            self._link_href = None
        elif tag == "ul" and self._list_stack:
            self._list_stack.pop()
        elif tag == "ol" and self._list_stack:
            self._list_stack.pop()
            if self._ol_counters:
                self._ol_counters.pop()
        elif tag in ("td", "th"):
            if self._table_row is not None:
                self._table_row.append(" ".join("".join(self._cell_buf).split()))
            self._cell_buf = []
        elif tag == "tr":
            if self._table_row is not None:
                self._table_rows.append(self._table_row)
            self._table_row = None
        elif tag == "table":
            self._in_table = False
            self.out.append(self._render_table(self._table_rows))
            self._table_rows = []

    def _render_table(self, rows: list[list[str]]) -> str:
        if not rows:
            return ""
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        lines = ["\n\n" + "| " + " | ".join(rows[0]) + " |"]
        lines.append("| " + " | ".join(["---"] * width) + " |")
        for row in rows[1:]:
            lines.append("| " + " | ".join(row) + " |")
        return "\n".join(lines) + "\n"

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        self._write(data)

    def markdown(self) -> str:
        text = "".join(self.out)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip() + "\n"


def html_to_markdown(html: str) -> str:
    converter = _MarkdownConverter()
    converter.feed(html)
    return converter.markdown()


def _full_html_document(html: str) -> str:
    if re.search(r"<html\b", html, re.IGNORECASE):
        return html
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        "<style>body{font-family:Helvetica,Arial,sans-serif;} table{border-collapse:collapse;} "
        "td,th{border:1px solid #999;padding:4px;}</style></head>"
        f"<body>{html}</body></html>"
    )


_BORDER_DIV_RE = re.compile(r'<div style="position:absolute;left:[^"]*"></div>')
_POSITIONED_TOP_LEFT_RE = re.compile(r"top:[-\d.]+pt;left:[-\d.]+pt;")
_ABSOLUTE_MARGIN_RE = re.compile(r";position:absolute;margin:0")
_PAGE_RELATIVE_RE = re.compile(r";position:relative;overflow:hidden")


def _strip_positioned_markup(html: str) -> str:
    """Undo the `position:absolute` layout added for on-screen editing (see
    `_pdf_to_positioned_html`/`_page_drawings_html`) before handing HTML to a
    renderer that has no support for CSS positioning at all -- LibreOffice's
    HTML importer and the `fitz.Story` fallback both just flow every element
    in DOM order regardless of `top`/`left`, so left as-is: every "line" of
    text collapses onto its own default-height block in whatever order
    Writer's layout picks, and the empty divs used to draw table border/fill
    lines -- correctly tiny on screen -- get Writer's minimum paragraph
    height and render as oversized bars covering the page.

    Since the markup already lists content in correct reading order (that's
    how PyMuPDF extracted it), dropping the position entirely and letting it
    flow normally is a safe, faithful *approximation* for plain text: only
    the exact pixel position and the table border/fill lines are lost for
    this export path specifically -- on-screen editing and the raw HTML
    download are unaffected, since real CSS positioning works fine there."""
    html = _BORDER_DIV_RE.sub("", html)
    html = _POSITIONED_TOP_LEFT_RE.sub("", html)
    html = _ABSOLUTE_MARGIN_RE.sub("", html)
    html = _PAGE_RELATIVE_RE.sub("", html)
    return html


def _parse_style(style: str) -> dict:
    props: dict[str, str] = {}
    for part in (style or "").split(";"):
        if ":" in part:
            key, value = part.split(":", 1)
            props[key.strip().lower()] = value.strip()
    return props


def _style_pt(value: "str | None") -> "float | None":
    if not value:
        return None
    match = re.match(r"\s*(-?[\d.]+)", value)
    return float(match.group(1)) if match else None


def _css_color_alpha(value: "str | None") -> "tuple[tuple[float, float, float] | None, float]":
    """Parse an rgb()/rgba()/#hex colour into ((r,g,b) 0-1, alpha 0-1)."""
    value = (value or "").strip()
    rgb = re.match(r"rgba?\(([^)]+)\)", value)
    if rgb:
        try:
            parts = [float(p) for p in rgb.group(1).split(",")]
            color = (parts[0] / 255, parts[1] / 255, parts[2] / 255)
            alpha = parts[3] if len(parts) > 3 else 1.0
            return color, max(0.0, min(1.0, alpha))
        except (ValueError, IndexError):
            return None, 1.0
    if value.startswith("#") and len(value) >= 7:
        try:
            return tuple(int(value[i : i + 2], 16) / 255 for i in (1, 3, 5)), 1.0  # type: ignore[return-value]
        except ValueError:
            return None, 1.0
    return None, 1.0


def _css_color(value: "str | None") -> "tuple[float, float, float] | None":
    return _css_color_alpha(value)[0]


_BORDER_RE = re.compile(r"([\d.]+)pt\s+\w+\s+(rgb\([^)]*\)|#[0-9a-fA-F]{6})")


def _parse_border(border: str) -> "tuple[tuple[float, float, float] | None, float]":
    match = _BORDER_RE.search(border or "")
    if not match:
        return None, 1.0
    return _css_color(match.group(2)), float(match.group(1))


def _parse_export_pages(html: str) -> list[dict]:
    """Parse the editor's export payload into per-page records. The editor wraps
    each page's edited content in `<div class="fc-page" data-positioned data-w
    data-h ...>`; returns [] for anything without those wrappers (e.g. the
    Translate editor), so the legacy flowing-export path is used."""
    from lxml import html as lxml_html

    try:
        root = lxml_html.fromstring("<div>" + html + "</div>")
    except Exception:  # noqa: BLE001
        return []
    pages: list[dict] = []
    for el in root:
        classes = (el.get("class") or "").split()
        if "fc-page" not in classes:
            continue
        props = _parse_style(el.get("style") or "")
        w = _style_pt(el.get("data-w")) or _style_pt(props.get("width"))
        h = _style_pt(el.get("data-h")) or _style_pt(props.get("height"))
        inner = el.text or ""
        for child in el:
            inner += lxml_html.tostring(child, encoding="unicode")
        pages.append({
            "inner": inner,
            "w": w,
            "h": h,
            "positioned": (el.get("data-positioned") == "true"),
            # "page" (paper) or "sheet" (a worksheet grid) — a sheet exports
            # back to a real workbook rather than through a PDF render.
            "kind": el.get("data-kind") or "page",
            "name": el.get("data-sheet-name") or None,
        })
    return pages


def _draw_positioned_image(page, el, rect, rotation: float = 0.0) -> None:  # noqa: ANN001
    import base64

    src = el.get("src", "")
    if not src.startswith("data:") or "," not in src:
        return
    try:
        data = base64.b64decode(src.split(",", 1)[1])
    except Exception:  # noqa: BLE001 — undecodable image, skip
        return
    if not rotation:
        try:
            page.insert_image(rect, stream=data)
        except Exception:  # noqa: BLE001 — a bad/oversized image just gets skipped
            pass
        return
    # Arbitrary rotation (CSS `rotate(θdeg)`, clockwise): rotate the raster and
    # place it in the axis-aligned bbox centred on the image's own centre, so it
    # matches exactly what the editor showed.
    import io
    import math

    import fitz
    from PIL import Image

    try:
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        rotated = im.rotate(-rotation, expand=True, resample=Image.BICUBIC)
        th = math.radians(rotation)
        w, h = rect.width, rect.height
        bw = abs(w * math.cos(th)) + abs(h * math.sin(th))
        bh = abs(w * math.sin(th)) + abs(h * math.cos(th))
        cx, cy = rect.x0 + w / 2, rect.y0 + h / 2
        out_rect = fitz.Rect(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
        buf = io.BytesIO()
        rotated.save(buf, "PNG")
        page.insert_image(out_rect, stream=buf.getvalue())
    except Exception:  # noqa: BLE001 — fall back to the unrotated image
        try:
            page.insert_image(rect, stream=data)
        except Exception:  # noqa: BLE001
            pass


def _render_positioned_pdf(pages: list[dict], out_path: Path) -> Path:
    """Rebuild a PDF that matches the edited on-screen layout EXACTLY: each page
    is created at its real point size and every absolutely-positioned element is
    re-placed at its own coordinates — text via `insert_htmlbox` (keeping font
    size/colour and any edits), and the ruled/filled divs that form table grids
    as real vector rectangles. This preserves tables (and empty cells) instead
    of flattening everything into a single flowing column."""
    import fitz
    from lxml import html as lxml_html

    doc = fitz.open()
    for pg in pages:
        width = pg["w"] or 595.0
        height = pg["h"] or 842.0
        page = doc.new_page(width=width, height=height)
        try:
            root = lxml_html.fromstring("<div>" + pg["inner"] + "</div>")
        except Exception:  # noqa: BLE001
            continue
        for el in root.iter():
            style = el.get("style") or ""
            if "position:absolute" not in style.replace(" ", ""):
                continue
            props = _parse_style(style)
            left = _style_pt(props.get("left"))
            top = _style_pt(props.get("top"))
            if left is None or top is None:
                continue
            box_w = _style_pt(props.get("width"))
            box_h = _style_pt(props.get("height"))

            if el.tag.lower() == "img" and box_w and box_h:
                rot_match = re.search(r"rotate\((-?[\d.]+)deg\)", props.get("transform", ""))
                rotation = float(rot_match.group(1)) if rot_match else 0.0
                _draw_positioned_image(page, el, fitz.Rect(left, top, left + box_w, top + box_h), rotation)
                continue

            text = el.text_content().strip()
            if not text:
                # A ruled line or filled rectangle — i.e. a table border/fill or
                # a shape fill/gradient sliver.
                if box_w is not None and box_h is not None:
                    rect = fitz.Rect(left, top, left + max(box_w, 0.1), top + max(box_h, 0.1))
                    fill, fill_opacity = _css_color_alpha(props.get("background-color"))
                    if fill is not None:
                        page.draw_rect(rect, color=None, fill=fill, width=0, fill_opacity=fill_opacity)
                    border_color, border_w = _parse_border(props.get("border", ""))
                    if border_color is not None:
                        page.draw_rect(rect, color=border_color, width=border_w)
                continue

            # Positioned text: render its inner markup at (left, top). A generous
            # box avoids clipping/downscaling; the text draws from the top-left.
            inner = el.text or ""
            for child in el:
                inner += lxml_html.tostring(child, encoding="unicode")
            rect = fitz.Rect(left, max(0.0, top - 1.0), width, height)
            try:
                page.insert_htmlbox(rect, inner)
            except Exception:  # noqa: BLE001 — fall back to plain positioned text
                size = _style_pt(props.get("font-size")) or 11.0
                page.insert_text((left, top + size), text, fontsize=size)
    doc.save(str(out_path))
    doc.close()
    return out_path


# LibreOffice import filters that force a PDF to open in Writer/Impress/Calc,
# so it can be re-exported to that Office format (a PDF otherwise opens in Draw,
# which can't export docx/pptx/xlsx).
_PDF_IMPORT_FILTER = {
    "docx": "writer_pdf_import", "doc": "writer_pdf_import",
    "odt": "writer_pdf_import", "rtf": "writer_pdf_import",
    "pptx": "impress_pdf_import", "ppt": "impress_pdf_import", "odp": "impress_pdf_import",
    "xlsx": "calc_pdf_import", "xls": "calc_pdf_import", "ods": "calc_pdf_import",
}


def _build_export_pdf(html: str, stem: str, workdir: Path) -> Path:
    """Render the edited document to a faithful PDF — the basis for every binary
    download format. Positioned (PDF/Office-sourced) pages are rebuilt at their
    exact coordinates; anything else falls back to a flowing LibreOffice render."""
    pages = _parse_export_pages(html)
    if pages and all(p["positioned"] and p["w"] and p["h"] for p in pages):
        return _render_positioned_pdf(pages, workdir / f"{stem}.pdf")

    content = "".join(p["inner"] for p in pages) if pages else html
    flowable = _strip_positioned_markup(content)
    src = workdir / f"{stem}__flow.html"
    src.write_text(_full_html_document(flowable), encoding="utf-8")
    if find_soffice():
        return convert_with_soffice(src, workdir, "pdf")
    return _html_to_pdf_fallback(flowable, stem, workdir)


SPREADSHEET_EXTS_NO_DOT = {ext.lstrip(".") for ext in SPREADSHEET_EXTS}


def _export_spreadsheet(grids: list[dict], fmt: str, stem: str, workdir: Path) -> Path:
    """Edited worksheet grids back to a workbook in `fmt`. .xlsx is written
    directly by openpyxl; .xls/.ods are converted from it by LibreOffice (and
    fall back to the .xlsx when LibreOffice is absent, which still opens in
    Excel/Calc — unlike a PDF)."""
    from .sheet_grid import grid_page_to_csv, grid_pages_to_workbook

    out_dir = output_dir(workdir)
    if fmt == "csv":
        # A .csv is a single sheet of text — take it straight from the grid.
        return grid_page_to_csv(grids[0], out_dir / f"{stem}.csv")
    xlsx = grid_pages_to_workbook(grids, workdir / f"{stem}__grid.xlsx")
    if fmt in ("xlsx", "xlsm"):
        final = out_dir / f"{stem}.xlsx"
        xlsx.replace(final)
        return final
    if find_soffice():
        try:
            return convert_with_soffice(xlsx, out_dir, fmt)
        except HTTPException:
            pass  # fall through to handing back the .xlsx
    final = out_dir / f"{stem}.xlsx"
    xlsx.replace(final)
    return final


def export_html(html: str, fmt: str, stem: str, workdir: Path) -> Path:
    """Export the edited HTML in `fmt` — normally the document's ORIGINAL
    extension, so a PDF downloads as PDF, a DOCX as DOCX, a PPTX as PPTX, etc.
    Binary Office formats are produced from the faithful PDF via LibreOffice's
    PDF-import filters; if that can't be done the PDF is returned instead."""
    import shutil

    out_dir = output_dir(workdir)
    html = _SCRIPT_RE.sub("", html)
    fmt = (fmt or "pdf").lower().lstrip(".")

    if fmt in ("html", "htm"):
        out = out_dir / f"{stem}.html"
        out.write_text(_full_html_document(html), encoding="utf-8")
        return out

    if fmt in ("txt", "text", "md", "markdown", "log"):
        pages = _parse_export_pages(html)
        content = "".join(p["inner"] for p in pages) if pages else html
        ext = "md" if fmt in ("md", "markdown") else "txt"
        out = out_dir / f"{stem}.{ext}"
        out.write_text(html_to_text(content), encoding="utf-8")
        return out

    if fmt in ("hwpx", "hwp"):
        # Both download as .hwpx: nothing can write the legacy binary .hwp
        # (see hwpx_ops). The writer replays block-level markup, so hand it the
        # flowing version of the edited HTML — absolute page coordinates mean
        # nothing to it.
        from .hwpx_ops import PageGeometry, html_to_hwpx

        pages = _parse_export_pages(html)
        content = "".join(p["inner"] for p in pages) if pages else html
        # Keep the edited document's own sheet size (the editor carries each
        # page's real size in data-w/data-h) instead of the template's A4.
        page = None
        if pages and pages[0].get("w") and pages[0].get("h"):
            page = PageGeometry.from_pt(pages[0]["w"], pages[0]["h"])
        return html_to_hwpx(_strip_positioned_markup(content), stem, workdir, page=page)

    if fmt in SPREADSHEET_EXTS_NO_DOT:
        grids = [p for p in _parse_export_pages(html) if p["kind"] == "sheet"]
        if grids:
            # The document arrived as a grid, so it leaves as one: cells stay
            # live cells instead of being flattened into a PDF and re-imported.
            return _export_spreadsheet(grids, fmt, stem, workdir)

    pdf_path = _build_export_pdf(html, stem, workdir)

    if fmt == "pdf":
        final = out_dir / f"{stem}.pdf"
        if pdf_path.resolve() != final.resolve():
            shutil.copyfile(pdf_path, final)
        return final

    # Office format: convert the faithful PDF using the matching import filter.
    infilter = _PDF_IMPORT_FILTER.get(fmt)
    if infilter and find_soffice():
        try:
            return convert_with_soffice(pdf_path, out_dir, fmt, infilter=infilter)
        except HTTPException:
            pass  # fall through to returning the PDF

    # Unknown/unsupported target — hand back the faithful PDF.
    final = out_dir / f"{stem}.pdf"
    if pdf_path.resolve() != final.resolve():
        shutil.copyfile(pdf_path, final)
    return final


def render_html_to_pdf(html: str, out_path: Path) -> Path:
    """Render HTML to PDF using PyMuPDF's Story layout engine — no browser
    engine involved, so JavaScript doesn't run and complex CSS is
    approximated. Good enough for articles/text pages and as a
    LibreOffice-free fallback for the document editor's PDF export."""
    import fitz

    try:
        story = fitz.Story(html=_full_html_document(html))
        writer = fitz.DocumentWriter(str(out_path))
        page_rect = fitz.paper_rect("a4")
        content_rect = page_rect + (36, 36, -36, -36)
        more = 1
        while more:
            device = writer.begin_page(page_rect)
            more, _ = story.place(content_rect)
            story.draw(device)
            writer.end_page()
        writer.close()
    except Exception:  # noqa: BLE001 — last resort: plain-text PDF, written directly
        _write_plain_text_pdf(html_to_text(html), out_path)
    return out_path


def _write_plain_text_pdf(content: str, out_path: Path) -> None:
    import fitz

    doc = fitz.open()
    rect = fitz.paper_rect("a4")
    margin = 54
    text_rect = fitz.Rect(rect.x0 + margin, rect.y0 + margin, rect.x1 - margin, rect.y1 - margin)
    remaining = content or " "
    per_page = max(1, int(text_rect.height / (11 * 1.2)) - 1)
    while remaining:
        lines = remaining.splitlines()
        page_text = "\n".join(lines[:per_page])
        remaining = "\n".join(lines[per_page:])
        page = doc.new_page(width=rect.width, height=rect.height)
        page.insert_textbox(text_rect, page_text, fontsize=11, fontname="cour")
    doc.save(str(out_path))
    doc.close()


def _html_to_pdf_fallback(html: str, stem: str, out_dir: Path) -> Path:
    return render_html_to_pdf(html, out_dir / f"{stem}.pdf")


def _html_to_docx_fallback(html: str, stem: str, out_dir: Path) -> Path:
    from docx import Document

    document = Document()
    for paragraph in html_to_text(html).split("\n"):
        document.add_paragraph(paragraph)
    out = out_dir / f"{stem}.docx"
    document.save(str(out))
    return out
