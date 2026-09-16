"""PDF export must work on a runtime without WeasyPrint.

The hosted image has no weasyprint (importing it raises ModuleNotFoundError),
so render_pdf falls back to PyMuPDF's Story engine, which is always installed
because dataroom PDF text extraction depends on it.
"""

from __future__ import annotations

import base64
import sys
from types import SimpleNamespace

import pytest

from newsletter_backend.api import export

# 1x1 PNG, inlined the same way export.py inlines every image.
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_DATA_URI = "data:image/png;base64," + base64.b64encode(_PNG).decode()


def _block(**kw):
    base = dict(
        id="b1",
        order_index=0,
        layout_key="single_column",
        title="Quarterly update",
        summary="A short <mark>summary</mark>.",
        content="<p>Body copy with <b>bold</b> text.</p>",
        image_desc="",
        images=[],
        citations=[],
        continuation_of=None,
        force_page_break=False,
        keep_next=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _newsletter(page_size="a4", blocks=None):
    return SimpleNamespace(
        id="nl-1",
        title="Título — 제목",  # non-ASCII: Story must embed suitable fonts
        theme_snapshot={
            "palette": {"bg": "#ffffff", "title": "#1e1b4b", "body": "#334155", "accent": "#4f46e5"},
            "typography": {"fontFamily": "sans", "scale": 1},
            "headers": [],
            "footers": [],
        },
        layout={"pageSize": page_size, "showPageNumbers": True},
        overlays=[],
        created_at=None,
        blocks=blocks if blocks is not None else [_block(layout_key="title_only"), _block(id="b2", order_index=1)],
    )


def _is_pdf(data: bytes) -> bool:
    return data.startswith(b"%PDF-")


def test_render_pdf_falls_back_to_pymupdf_without_weasyprint(monkeypatch):
    # Simulate the hosted runtime: importing weasyprint raises.
    monkeypatch.setitem(sys.modules, "weasyprint", None)
    pdf = export.render_pdf(_newsletter())
    assert _is_pdf(pdf)
    assert len(pdf) > 1000


def test_story_pdf_contains_the_newsletter_text(monkeypatch):
    monkeypatch.setitem(sys.modules, "weasyprint", None)
    import fitz

    pdf = export.render_pdf(_newsletter())
    doc = fitz.open(stream=pdf, filetype="pdf")
    text = "".join(page.get_text() for page in doc)
    assert "Quarterly update" in text
    assert "Body copy with" in text


def test_story_pdf_embeds_inlined_images(monkeypatch):
    """export.py inlines images as data URIs precisely so no engine has to fetch
    them at render time — Story must actually place them."""
    monkeypatch.setitem(sys.modules, "weasyprint", None)
    import fitz

    nl = _newsletter(blocks=[_block(layout_key="hero_image", images=[_DATA_URI])])
    doc = fitz.open(stream=export.render_pdf(nl), filetype="pdf")
    assert sum(len(page.get_images(full=True)) for page in doc) >= 1


@pytest.mark.parametrize("size", ["a4", "a3", "b4", "letter", "nonsense"])
def test_every_page_size_renders(size, monkeypatch):
    """An unknown key must fall back to A4 — fitz.paper_rect returns an invalid
    rect for names it doesn't recognise, which would produce a broken file."""
    monkeypatch.setitem(sys.modules, "weasyprint", None)
    import fitz

    pdf = export.render_pdf(_newsletter(page_size=size))
    assert _is_pdf(pdf)
    page = fitz.open(stream=pdf, filetype="pdf")[0]
    assert page.rect.width > 0 and page.rect.height > 0


def test_weasyprint_is_used_when_available(monkeypatch):
    """When the engine exists it stays preferred — it is the faithful renderer."""
    calls: dict = {}

    class _FakeHTML:
        def __init__(self, string=None):
            calls["html"] = string

        def write_pdf(self):
            return b"%PDF-fake"

    monkeypatch.setitem(sys.modules, "weasyprint", SimpleNamespace(HTML=_FakeHTML))
    assert export.render_pdf(_newsletter()) == b"%PDF-fake"
    assert "Quarterly update" in calls["html"]
