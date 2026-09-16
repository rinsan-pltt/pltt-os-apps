"""Render a newsletter to self-contained HTML and to PDF (via WeasyPrint).

Every image URL on a newsletter (block images, overlays, brand logo) is an
absolute storage URL (see storage.py) — this module always inlines them as
base64 data URIs (storage.to_data_uri) rather than depending on WeasyPrint
being able to fetch them live at render time, which keeps both the exported
HTML and PDF genuinely self-contained regardless of runtime (pltt dev,
hosted sandbox, standalone). No image_map plumbing needed from the caller."""

import html as _html
import io
import logging
import re

from newsletter_backend.api import storage
from newsletter_backend.api import typography as ty
from newsletter_backend.api.models import Newsletter
from newsletter_backend.api.sanitize import safe_html as _safe

logger = logging.getLogger(__name__)


def _resolve(url: str) -> str:
    if not url:
        return url
    return storage.to_data_uri(url) or url


def _type_css(token: dict, color: str | None = None) -> str:
    """Build the inline-style fragment for a typography token."""
    parts = [
        f"font-size:{token['size']}px",
        f"font-weight:{token['weight']}",
        f"line-height:{token['leading']}",
    ]
    if token.get("tracking"):
        parts.append(f"letter-spacing:{token['tracking']}em")
    if color:
        parts.append(f"color:{color}")
    return ";".join(parts)


def _overlays_html(nl: Newsletter) -> str:
    items = []
    for ov in nl.overlays or []:
        otype = ov.get("type", "mascot")
        x = float(ov.get("xPct", 0))
        y = float(ov.get("yPct", 0))
        w = float(ov.get("wPct", 18))
        rot = float(ov.get("rotation", 0))
        h = ov.get("hPct")
        pos = f"position:absolute;left:{x}%;top:{y}%;width:{w}%;transform:rotate({rot}deg);"
        if otype in ("mascot", "image"):
            url = _resolve(str(ov.get("imageUrl", "")))
            if not url:
                continue
            items.append(f'<img src="{url}" style="{pos}" />')
        elif otype == "text":
            color = str(ov.get("color", "#0f172a"))
            bg = str(ov.get("bgColor", "transparent"))
            hs = f"height:{float(h)}%;" if h is not None else ""
            items.append(
                f'<div style="{pos}{hs}color:{color};background:{bg};'
                f'padding:2px 6px;font-size:13px">{_safe(str(ov.get("content", "")))}</div>'
            )
        elif otype == "line":
            color = str(ov.get("color", "#0f172a"))
            sw = float(ov.get("strokeWidth", 2))
            items.append(f'<div style="{pos}height:{sw}px;background:{color}"></div>')
    return "".join(items)


CSS_PAGE_SIZE = {"a4": "A4", "a3": "A3", "b4": "B4", "letter": "Letter"}


def _img_slot(b, slot: int, height_px: int, accent: str) -> str:
    imgs = getattr(b, "images", None) or []
    url = imgs[slot] if slot < len(imgs) and imgs[slot] else ""
    if url:
        return (
            f'<img src="{_resolve(str(url))}" style="width:100%;height:{height_px}px;'
            'object-fit:cover;border-radius:8px;display:block" />'
        )
    return f'<div style="height:{height_px}px;border:1px dashed {accent}66;background:{accent}0f;border-radius:8px"></div>'


def _cols(cells: list[tuple[int, str]]) -> str:
    tds = "".join(f'<td style="width:{w}%;vertical-align:top;padding:0 6px">{h}</td>' for w, h in cells)
    return f'<table style="width:100%;border-collapse:collapse;margin:0"><tr>{tds}</tr></table>'


def _img_row(b, slots: list[int], height_px: int, accent: str) -> str:
    w = round(100 / len(slots))
    tds = "".join(f'<td style="width:{w}%;padding:0 3px">{_img_slot(b, s, height_px, accent)}</td>' for s in slots)
    return f'<table style="width:100%;border-collapse:collapse;margin:6px 0"><tr>{tds}</tr></table>'


def _block_html(b, cs: dict) -> str:
    """Render one block to match the editor preview (block-view.tsx)."""
    accent = cs.get("accent", "#4f46e5")
    title_c = cs.get("title", "#0f172a")
    body_c = cs.get("body", "#334155")
    page_bg = cs.get("bg", "#ffffff")
    typo = ty.typo_for(b.layout_key)

    T = f'<div style="{_type_css(typo["title"], title_c)};margin:0 0 6px">{_safe(b.title)}</div>'
    S = f'<div style="{_type_css(typo["summary"], body_c)};margin:0 0 6px">{_safe(b.summary)}</div>'
    C = f'<div style="{_type_css(typo["content"], body_c)}">{_safe(b.content)}</div>'
    L = b.layout_key

    def im(slot: int, h: int) -> str:
        return _img_slot(b, slot, h, accent)

    if L == "hero_image":
        return f'<div style="margin:0 0 10px">{im(0, 180)}</div>{T}{S}{C}'
    if L == "two_column":
        right = f'<div style="background:{accent}14;border-radius:8px;padding:10px">{S}<div style="margin-top:8px">{im(0, 90)}</div></div>'
        return _cols([(60, T + C), (40, right)])
    if L == "feature_split":
        return f'<div style="border-left:4px solid {accent};background:{accent}0d;border-radius:8px;padding:10px 12px">{T}{S}{C}</div>'
    if L == "sidebar":
        right = f'<div style="background:{accent};color:{page_bg};border-radius:8px;padding:12px;{_type_css(typo["summary"])}">{_safe(b.summary)}</div>'
        return _cols([(66, T + C), (34, right)])
    if L == "gallery":
        return T + S + _img_row(b, [0, 1, 2], 72, accent)
    if L == "text_only":
        pill = f'<span style="background:{accent}14;color:{body_c};border-radius:9999px;padding:4px 10px;font-size:12px">{_safe(b.summary)}</span>'
        head = _cols([(70, T), (30, f'<div style="text-align:right">{pill}</div>')])
        return head + C
    if L == "image_right":
        return f'{T}<div><div style="float:right;width:40%;margin:0 0 8px 12px">{im(0, 160)}</div>{S}{C}</div>'
    if L == "six_image_grid":
        return T + S + _img_row(b, [0, 1, 2], 72, accent) + _img_row(b, [3, 4, 5], 72, accent)
    if L == "three_across":
        return f'<div style="text-align:center">{T}</div>' + _img_row(b, [0, 1, 2], 90, accent) + C
    if L == "image_trio":
        right = f'{im(1, 90)}<div style="height:6px"></div>{im(2, 90)}'
        return T + S + _cols([(60, im(0, 186)), (40, right)]) + C
    if L == "two_image_single_column":
        left = f'{im(0, 96)}<div style="height:6px"></div>{im(1, 96)}'
        return T + S + _cols([(40, left), (60, C)])
    if L == "banner_text":
        bar = f'<div style="background:{accent}1a;border-bottom:1px solid {accent}40;padding:8px 12px">{T}{S}</div>'
        return (
            f'<div style="border:1px solid #eef2ff;border-radius:8px;overflow:hidden">{bar}{im(0, 120)}'
            f'<div style="column-count:2;column-gap:16px;padding:12px;text-align:justify">{C}</div></div>'
        )
    if L == "paired_column":
        left = f'<div style="border-right:1px solid #e2e8f0;padding-right:12px">{T}{S}</div>'
        return _cols([(50, left), (50, C)])
    return T + S + C


FONT_STACKS = {
    "sans": "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    "serif": "Georgia,'Times New Roman',serif",
    "mono": "ui-monospace,'Courier New',monospace",
}


def _brand_page_css(nl: Newsletter, brand, page_size: str, accent: str, show_pages: bool) -> tuple[str, str]:
    """Build the running-element divs + @page rules for brand header/footer.
    Returns (running_divs_html, page_css)."""
    counter = (
        f'@bottom-right {{ content: counter(page) " / " counter(pages); font-size:9px; color:{accent}; }}'
        if show_pages
        else ""
    )
    if brand is None:
        return "", f"@page {{ size:{page_size}; margin: 18mm 16mm; {counter} }}"

    from newsletter_backend.api import brand as brand_module

    snapshot = nl.theme_snapshot or {}
    page_w_mm = {"A4": 210, "A3": 297, "B4": 250, "Letter": 216}.get(page_size, 210)
    band_w = round((page_w_mm - 32) * 96 / 25.4)  # content width minus 16mm margins
    rt = brand_module.render_templates(
        headers=snapshot.get("headers") or [],
        footers=snapshot.get("footers") or [],
        brand_name=brand.name,
        logo_url=brand.logo_url,
        title=nl.title,
        palette=(snapshot.get("palette") or {}),
        num="",
        total="",
        for_export=True,
        band_width=band_w,
        created_at=nl.created_at,
    )

    def pick(items, rule):
        for it in items:
            if it.get("rule") == rule and (it.get("html") or "").strip():
                return it["html"]
        return ""

    def default_of(items):
        return pick(items, "all") or pick(items, "subsequent")

    h, f = rt["headers"], rt["footers"]
    run = []
    run_rules = []  # CSS rules — position:running() is ignored inline, must be a rule
    base, first, right, left = [], [], [], []

    def slot(name, html, target, box):
        if not html:
            return
        run.append(f'<div id="run_{name}">{html}</div>')
        run_rules.append(f"#run_{name} {{ position: running({name}); }}")
        target.append(f"@{box} {{ content: element({name}); }}")

    slot("h_def", default_of(h), base, "top-center")
    slot("f_def", default_of(f), base, "bottom-center")
    slot("h_first", pick(h, "first"), first, "top-center")
    slot("f_first", pick(f, "first"), first, "bottom-center")
    slot("h_odd", pick(h, "odd"), right, "top-center")
    slot("f_odd", pick(f, "odd"), right, "bottom-center")
    slot("h_even", pick(h, "even"), left, "top-center")
    slot("f_even", pick(f, "even"), left, "bottom-center")

    css = " ".join(run_rules)
    css += f"@page {{ size:{page_size}; margin: 26mm 16mm; {' '.join(base)} {counter} }}"
    if first:
        css += f"@page:first {{ {' '.join(first)} }}"
    if right:
        css += f"@page:right {{ {' '.join(right)} }}"
    if left:
        css += f"@page:left {{ {' '.join(left)} }}"
    return "".join(run), css


def render_html(nl: Newsletter, brand=None) -> str:
    snapshot = nl.theme_snapshot or {}
    cs = snapshot.get("palette") or {}
    bg = cs.get("bg", "#ffffff")
    title_c = cs.get("title", "#0f172a")
    body_c = cs.get("body", "#334155")
    accent = cs.get("accent", "#4f46e5")
    layout = nl.layout or {}
    page_size = CSS_PAGE_SIZE.get(layout.get("pageSize", "a4"), "A4")
    show_pages = layout.get("showPageNumbers", True)

    fam = (snapshot.get("typography") or {}).get("fontFamily", "sans")
    font_stack = FONT_STACKS.get(fam, FONT_STACKS["sans"])

    running, page_css = _brand_page_css(nl, brand, page_size, accent, show_pages)

    sections = []
    for b in sorted(nl.blocks, key=lambda x: x.order_index):
        typo = ty.typo_for(b.layout_key)
        break_before = (
            ' style="break-before:page;page-break-before:always"' if getattr(b, "force_page_break", False) else ""
        )
        if b.layout_key == "title_only":
            sections.append(
                f'<header{break_before} style="text-align:center;margin:0 0 32px;'
                f'border-bottom:3px solid {accent};padding-bottom:16px">'
                f'<h1 style="{_type_css(typo["title"], title_c)};margin:0 0 6px">{_safe(b.title)}</h1>'
                f'<p style="{_type_css(typo["summary"], body_c)};margin:0">{_safe(b.summary)}</p></header>'
            )
            continue

        sections.append(f'<section{break_before} style="margin:0 0 28px">{_block_html(b, cs)}</section>')

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{_html.escape(nl.title)}</title>
<style>{page_css}
body {{ margin: 0; }}
mark {{ background: {accent}33; border-radius: 3px; padding: 0 2px; }}
a {{ color: {accent}; }}
ul {{ padding-left: 1.2em; list-style: disc; }} ol {{ padding-left: 1.4em; list-style: decimal; }}</style></head>
<body style="background:{bg};font-family:{font_stack};padding:0">
{running}
<div style="position:relative;margin:0 auto">
{''.join(sections)}
{_overlays_html(nl)}
</div></body></html>"""



# --- PDF ---------------------------------------------------------------------

# fitz.paper_rect() returns an invalid rect for names it doesn't know, so only
# hand it sizes we've confirmed. Keys mirror PAGE_SIZES in the frontend.
_STORY_PAPERS = {"a4", "a3", "b4", "letter"}
_STORY_MARGIN_PT = 36  # 0.5in, matching the HTML export's page margin
# Story returns "more content pending" each iteration; if a single element can
# never fit the frame that would loop forever, so cap it.
_STORY_MAX_PAGES = 200


_STYLE_BLOCK_RE = re.compile(r"<style>.*?</style>", re.DOTALL)


def _story_css(nl: Newsletter) -> str:
    """The handful of document-wide rules worth keeping for Story.

    The real stylesheet is dropped before Story sees it: it carries `@page`
    margin boxes (`@bottom-right { content: counter(page) }`) that MuPDF's CSS
    parser rejects outright — and one syntax error there makes it discard the
    ENTIRE block, so every rule is lost and even image placement misbehaves.
    Everything visual in this export is already an inline `style=` attribute,
    which Story does honour, so only these globals need restating.
    """
    accent = ((nl.theme_snapshot or {}).get("palette") or {}).get("accent", "#4f46e5")
    return (
        "body { margin: 0; }"
        f"mark {{ background-color: {accent}; }}"
        f"a {{ color: {accent}; }}"
        "ul { padding-left: 1.2em; }"
        "ol { padding-left: 1.4em; }"
    )


def _render_pdf_story(html: str, nl: Newsletter) -> bytes:
    """PDF via PyMuPDF's Story engine.

    Story renders a SUBSET of HTML/CSS: text, inline styles, lists, tables and
    images (data URIs included, which is why export.py inlines every image).
    It does NOT implement `@page` running headers/footers or absolute
    positioning, so brand headers/footers and mascot overlays flow inline here
    instead of being positioned — the HTML export and the on-screen preview
    remain the faithful rendering. This exists because the hosted runtime has no
    WeasyPrint, while PyMuPDF is always present (the dataroom's PDF text
    extraction depends on it).
    """
    import fitz

    paper = str((nl.layout or {}).get("pageSize") or "a4").lower()
    media = fitz.paper_rect(paper if paper in _STORY_PAPERS else "a4")
    frame = media + (_STORY_MARGIN_PT, _STORY_MARGIN_PT, -_STORY_MARGIN_PT, -_STORY_MARGIN_PT)

    buffer = io.BytesIO()
    story = fitz.Story(html=_STYLE_BLOCK_RE.sub("", html), user_css=_story_css(nl))
    writer = fitz.DocumentWriter(buffer)
    more, pages = 1, 0
    while more and pages < _STORY_MAX_PAGES:
        device = writer.begin_page(media)
        more, _ = story.place(frame)
        story.draw(device)
        writer.end_page()
        pages += 1
    writer.close()
    if pages >= _STORY_MAX_PAGES:
        logger.warning("export: Story hit the %s-page cap for newsletter %s", _STORY_MAX_PAGES, nl.id)
    return buffer.getvalue()


def render_pdf(nl: Newsletter, brand=None) -> bytes:
    """Render to PDF, preferring WeasyPrint and falling back to PyMuPDF.

    WeasyPrint honours the full CSS this module emits, so its output matches the
    preview exactly — but it is absent from the hosted runtime image (importing
    it raises ModuleNotFoundError there) because it needs system libraries the
    image doesn't carry. Rather than fail the export, fall back to an engine
    that is guaranteed to be installed.
    """
    html = render_html(nl, brand)
    try:
        from weasyprint import HTML
    except Exception:  # noqa: BLE001 — ModuleNotFoundError hosted, OSError when native libs are missing
        logger.info("export: WeasyPrint unavailable; rendering PDF with PyMuPDF Story", exc_info=True)
        return _render_pdf_story(html, nl)
    return HTML(string=html).write_pdf()
