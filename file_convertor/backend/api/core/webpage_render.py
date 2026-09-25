"""Turn a fetched web page into a PDF that resembles the page.

`html-to-pdf` used to hand the raw markup straight to PyMuPDF's Story layout
engine. Two things came out of that:

  * nothing but the interstitial, when the URL led to a "redirecting…" stub —
    fixed in `core.net`, which now follows what a browser would follow; and
  * text on a white page, when it did reach the article. Story renders `<img>`
    as the literal placeholder "[image]" (verified on PyMuPDF 1.28), it has no
    notion of a relative URL, and its CSS support is a small subset.

So the page is first made self-contained — links absolute, images downloaded
next to it — and then rendered by LibreOffice where that is installed, which
draws the images and honours far more of the CSS. Story remains the fallback
for hosts without it, and is still what the document editor's PDF export uses.
"""

from __future__ import annotations

import logging
import mimetypes
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from .html_edit import render_html_to_pdf
from .net import FetchedPage, fetch_binary
from .office import convert_with_soffice, find_soffice

logger = logging.getLogger(__name__)

# Caps on what one page may pull in. A page with two hundred tracking pixels
# should not turn a conversion into a crawl.
MAX_IMAGES = 40
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024

# Elements that mean nothing on paper and actively harm the render: scripts do
# not run, `<noscript>` shows the "turn on JavaScript" plea the reader never
# needed to see, and an iframe is at best an empty box.
_DROP_ELEMENTS = ("script", "noscript", "iframe", "object", "embed", "template")
_DROP_RE = re.compile(
    r"(?is)<(%s)\b.*?</\1\s*>" % "|".join(_DROP_ELEMENTS),
)
_SELF_CLOSING_DROP_RE = re.compile(r"(?is)<(?:%s)\b[^>]*/?>" % "|".join(_DROP_ELEMENTS))

_IMG_TAG_RE = re.compile(r"(?is)<img\b[^>]*>")
_ATTR_RE = re.compile(r"""(?is)\b(%s)\s*=\s*(["'])(.*?)\2""")
_SRCSET_RE = re.compile(r"""(?is)\ssrcset\s*=\s*(["']).*?\1""")
_LAZY_ATTRS = ("data-src", "data-original", "data-lazy-src")


# Site chrome: menus, breadcrumb rails, cookie bars, footers. On screen CSS
# puts these in a sidebar or a strip; with no CSS engine they are simply the
# first elements in the document, which is why the first page of a converted
# Wikipedia article was a bare list of "Main page / Contents / Random article".
_CHROME_ELEMENTS = ("nav", "aside", "footer")
_CHROME_RE = re.compile(r"(?is)<(%s)\b.*?</\1\s*>" % "|".join(_CHROME_ELEMENTS))
_CHROME_ROLE_RE = re.compile(
    r"""(?is)<(\w+)\b[^>]*\brole\s*=\s*["'](?:navigation|banner|contentinfo|search|complementary)["'][^>]*>.*?</\1\s*>"""
)

# Enough text to believe a region is the article rather than a stray wrapper.
MIN_MAIN_TEXT = 200


def _visible_text(html: str) -> str:
    without = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html)
    return " ".join(re.sub(r"(?s)<[^>]+>", " ", without).split())


def _element_slice(html: str, tag: str) -> str | None:
    """The first complete `<tag>…</tag>`, counting nesting so an inner
    `<article>` inside an outer one does not truncate the outer."""
    open_re = re.compile(r"(?is)<%s\b[^>]*?(/?)>" % tag)
    close_re = re.compile(r"(?is)</%s\s*>" % tag)
    first = open_re.search(html)
    if not first or first.group(1) == "/":
        return None
    depth = 1
    pos = first.end()
    while depth:
        nxt_open = open_re.search(html, pos)
        nxt_close = close_re.search(html, pos)
        if not nxt_close:
            return None
        if nxt_open and nxt_open.start() < nxt_close.start():
            if nxt_open.group(1) != "/":
                depth += 1
            pos = nxt_open.end()
            continue
        depth -= 1
        pos = nxt_close.end()
    return html[first.start():pos]


def _strip_outer_tag(fragment: str, tag: str) -> str:
    """The contents of `<tag>…</tag>`, without the tag itself."""
    inner = re.sub(r"(?is)^<%s\b[^>]*>" % tag, "", fragment)
    return re.sub(r"(?is)</%s\s*>$" % tag, "", inner)


def _page_title(html: str) -> str:
    match = re.search(r"(?is)<title\b[^>]*>(.*?)</title>", html)
    return _visible_text(match.group(1)) if match else ""


def extract_readable(html: str) -> str:
    """Reduce a page to the part a reader came for.

    A browser lays the chrome out around the content with CSS. LibreOffice has
    no such engine, so it prints the document in source order — and on a modern
    site that means several pages of menus before the first sentence. Where the
    page marks its content (`<main>`, `<article>`, `role="main"`), that region
    is used; otherwise the chrome elements are removed and the rest kept.
    """
    for tag in ("main", "article"):
        region = _element_slice(html, tag)
        if region and len(_visible_text(region)) >= MIN_MAIN_TEXT:
            body = region
            break
    else:
        # No marked content region: keep the page, but only its body — the
        # whole document would otherwise be nested inside the new one, putting
        # a second <head> (and its <style>) in the middle of the output.
        whole_body = _element_slice(html, "body")
        body = _strip_outer_tag(whole_body, "body") if whole_body else html

    body = _CHROME_RE.sub(" ", body)
    body = _CHROME_ROLE_RE.sub(" ", body)

    title = _page_title(html)
    heading = f"<h1>{title}</h1>" if title and title.lower() not in _visible_text(body)[:400].lower() else ""
    return f'<html><head><meta charset="utf-8"><title>{title}</title></head><body>{heading}{body}</body></html>'


def _attr(tag: str, name: str) -> str | None:
    match = re.search(_ATTR_RE.pattern % re.escape(name), tag)
    return match.group(3).strip() if match else None


def _set_attr(tag: str, name: str, value: str) -> str:
    pattern = _ATTR_RE.pattern % re.escape(name)
    if re.search(pattern, tag):
        return re.sub(pattern, lambda m: f'{m.group(1)}="{value}"', tag, count=1)
    return tag[:-1].rstrip("/") + f' {name}="{value}">'


def _absolutize(html: str, base_url: str) -> str:
    """Make `href` and `src` absolute so nothing points at a path that only
    existed on the origin server."""

    def fix(match: re.Match[str]) -> str:
        attr, quote, value = match.group(1), match.group(2), match.group(3)
        value = value.strip()
        if not value or value.startswith(("#", "data:", "mailto:", "tel:", "javascript:")):
            return match.group(0)
        return f'{attr}={quote}{urljoin(base_url, value)}{quote}'

    return re.sub(_ATTR_RE.pattern % "href|src", fix, html)


def _extension_for(url: str, content_type: str) -> str:
    guessed = mimetypes.guess_extension(content_type) or ""
    if guessed in (".jpe", ".jpeg"):
        guessed = ".jpg"
    if guessed:
        return guessed
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in (".png", ".jpg", ".gif", ".webp", ".bmp") else ".img"


def _localize_images(html: str, base_url: str, assets_dir: Path) -> str:
    """Download each `<img>` beside the page and point the tag at the copy."""
    downloaded = 0
    total_bytes = 0
    counter = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal downloaded, total_bytes, counter
        tag = match.group(0)
        src = _attr(tag, "src")
        # Lazy-loaded images carry a placeholder in `src` and the real URL in a
        # data attribute; without this the page renders a row of grey 1px GIFs.
        for lazy in _LAZY_ATTRS:
            candidate = _attr(tag, lazy)
            if candidate and (not src or src.startswith("data:")):
                src = candidate
                break
        if not src or src.startswith("data:"):
            return tag
        if downloaded >= MAX_IMAGES or total_bytes >= MAX_TOTAL_IMAGE_BYTES:
            return ""

        absolute = urljoin(base_url, src)
        fetched = fetch_binary(absolute, MAX_IMAGE_BYTES)
        if not fetched:
            # A missing asset drops out rather than leaving a broken reference
            # that LibreOffice would draw as an error box.
            return ""
        payload, content_type = fetched
        counter += 1
        name = f"asset-{counter:03d}{_extension_for(absolute, content_type)}"
        (assets_dir / name).write_bytes(payload)
        downloaded += 1
        total_bytes += len(payload)

        tag = _SRCSET_RE.sub("", tag)
        return _set_attr(tag, "src", name)

    return _IMG_TAG_RE.sub(replace, html)


def build_page_document(page: FetchedPage, workdir: Path) -> Path:
    """Write the fetched page, and the images it references, into `workdir`."""
    html = _DROP_RE.sub(" ", page.html)
    html = _SELF_CLOSING_DROP_RE.sub(" ", html)
    # Before the images are fetched, so a page's menu icons and social badges
    # are never downloaded at all.
    html = extract_readable(html)
    html = _absolutize(html, page.url)
    html = _localize_images(html, page.url, workdir)

    document = workdir / "page.html"
    document.write_text(html, encoding="utf-8", errors="replace")
    return document


def render_page_pdf(page: FetchedPage, workdir: Path, out_path: Path) -> Path:
    """Render a fetched page to `out_path`, best engine first."""
    document = build_page_document(page, workdir)

    if find_soffice():
        try:
            produced = convert_with_soffice(document, out_path.parent, "pdf")
            if produced != out_path:
                produced.replace(out_path)
            return out_path
        except Exception:  # noqa: BLE001 — fall back rather than fail the request
            logger.warning("LibreOffice could not render %s; using the text renderer", page.url, exc_info=True)

    # No LibreOffice on this host: text-only, but the right page's text.
    render_html_to_pdf(document.read_text(encoding="utf-8", errors="replace"), out_path)
    return out_path

# --------------------------------------------------------------- what we got
#
# A conversion can "succeed" and still hand the user a PDF of something they
# never asked for: a help page about turning JavaScript on, a sign-in wall, a
# bot check, or the empty shell of a client-rendered app. Each of those is a
# page, with a title and a 200 status, so nothing upstream notices. They are
# recognised here and reported instead of being printed.

# Below this much visible text, nothing was rendered at all.
#
# Deliberately low. The first cut used 200 and rejected example.com, which is
# a real page that happens to be 127 characters long — a converter that
# refuses short pages is worse than one that occasionally prints a thin one.
# An un-hydrated app shell comes back with nothing, not with a paragraph.
MIN_CONTENT_CHARS = 60

_NEEDS_JS = (
    "enable javascript",
    "turn on javascript",
    "javascript is required",
    "javascript is disabled",
    "requires javascript",
)
_NEEDS_SIGN_IN = (
    "sign in to continue",
    "log in to continue",
    "please sign in",
    "please log in",
    "you must be logged in",
    "create an account to continue",
    "members only",
    "subscribe to read",
)
_CHALLENGED = (
    "verify you are human",
    "are you a robot",
    "unusual traffic",
    "checking your browser",
    "security check",
    "access denied",
    "captcha",
)


def content_problem(text: str, *, had_browser: bool) -> str | None:
    """A user-facing reason this page could not be converted, or None.

    `had_browser` changes what a JavaScript notice means. Without an engine it
    is our own limitation and should say so; with one, the page ran its scripts
    and still served that notice, which means it is refusing the request.
    """
    sample = " ".join(text.lower().split())

    if any(phrase in sample for phrase in _NEEDS_SIGN_IN):
        return (
            "That page is behind a sign-in, so there was nothing public to convert. "
            "Open it in your browser, save or print it to PDF, and use the other tools on that file."
        )
    if any(phrase in sample for phrase in _CHALLENGED):
        return (
            "That site blocked the request with a bot check, so there was nothing to convert. "
            "Sites that guard against automated visitors usually cannot be converted from a URL."
        )
    if any(phrase in sample for phrase in _NEEDS_JS):
        if had_browser:
            return (
                "That site served its \u201cturn on JavaScript\u201d page instead of its content, which means it "
                "is refusing automated browsers. Searching and social sites commonly do."
            )
        return (
            "That page builds its content with JavaScript, and this server has no browser engine installed "
            "to run it. Ask an administrator to add Chromium (`python -m playwright install chromium`), "
            "or save the page to PDF from your own browser."
        )
    if len(sample) < MIN_CONTENT_CHARS:
        if had_browser:
            return (
                "That page came back empty. It may need you to sign in, or it may block automated browsers."
            )
        return (
            "That page came back empty \u2014 its content is assembled in the browser, and this server has no "
            "browser engine installed to run it. Ask an administrator to add Chromium "
            "(`python -m playwright install chromium`)."
        )
    return None
