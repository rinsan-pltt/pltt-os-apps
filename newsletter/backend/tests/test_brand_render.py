"""Brand header/footer templates must still resolve without Jinja2.

Jinja2 is imported lazily, and the hosted runtime doesn't always have it
(declared in pyproject.toml, missing at runtime — the same gap as WeasyPrint).
The old behaviour emitted the template text verbatim, so a footer rendered as a
literal `{{ page.num }} / {{ page.total }}` — far longer than "1 / 2", so it
wrapped and overlapped inside its fixed-percentage element box and looked like a
broken footer on the printed page.
"""

from __future__ import annotations

import pytest

from newsletter_backend.api import brand

_PALETTE = {"bg": "#ffffff", "title": "#1e1b4b", "body": "#334155", "accent": "#4f46e5"}


@pytest.fixture
def no_jinja(monkeypatch):
    """Make _jinja_env() raise, exactly as a missing jinja2 install would."""

    def boom():
        raise ModuleNotFoundError("No module named 'jinja2'")

    # monkeypatch restores the original (still-cached) callable on teardown.
    monkeypatch.setattr(brand, "_jinja_env", boom)


def _footer(text: str) -> dict:
    return {
        "id": "f1",
        "name": "Footer",
        "rule": "all",
        "height": 40,
        "elements": [
            {"id": "e1", "type": "text", "xPct": 4, "yPct": 32, "wPct": 50, "hPct": 60, "text": text},
        ],
    }


def _render(templates: list[dict]) -> str:
    out = brand.render_templates(
        headers=[],
        footers=templates,
        brand_name="Acme Corp",
        logo_url=None,
        title="August Report",
        palette=_PALETTE,
    )
    return "".join(f["html"] for f in out["footers"])


def test_simple_render_resolves_dotted_paths():
    ctx = {"brand": {"name": "Acme"}, "page": {"num": 1, "total": 3}}
    assert brand._simple_render("{{ brand.name }}", ctx) == "Acme"
    assert brand._simple_render("{{page.num}} / {{ page.total }}", ctx) == "1 / 3"


def test_simple_render_keeps_unknown_placeholders_visible():
    """A typo should stay legible rather than silently blanking the element."""
    assert brand._simple_render("{{ nope.here }}", {"brand": {}}) == "{{ nope.here }}"


def test_brand_name_resolves_without_jinja(no_jinja):
    html = _render([_footer("{{ brand.name }}")])
    assert "Acme Corp" in html
    assert "{{" not in html


def test_page_numbers_keep_client_placeholders_without_jinja(no_jinja):
    """num/total render as __NUM__/__TOTAL__ — preview.tsx substitutes them per
    page, so they must survive as those markers, not as raw `{{ page.num }}`."""
    html = _render([_footer("{{ page.num }} / {{ page.total }}")])
    assert "__NUM__ / __TOTAL__" in html
    assert "{{" not in html


def test_newsletter_title_resolves_without_jinja(no_jinja):
    html = _render([_footer("{{ newsletter.title }}")])
    assert "August Report" in html


def test_jinja_is_still_preferred_when_installed():
    """The real engine stays in charge where it exists."""
    html = _render([_footer("{{ brand.name }}")])
    assert "Acme Corp" in html
    assert "{{" not in html
