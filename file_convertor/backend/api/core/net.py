"""Guarded outbound HTTP fetch for tools that take a user-supplied URL.

HTML to PDF fetches whatever URL the user pastes. Without checks that's a
textbook SSRF: a user could point the backend at the cloud metadata endpoint
(169.254.169.254), a loopback admin panel, or an internal service. Every
hostname resolution (initial request AND each redirect hop) is checked
against private/loopback/link-local/reserved ranges before the request goes
out.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException

MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 15 * 1024 * 1024
FETCH_TIMEOUT = httpx.Timeout(20.0, connect=10.0)

# Sent on every outbound fetch.
#
# This used to be `FileConvertorBot/1.0`, and that alone was enough to get the
# wrong page: a great many sites answer an unrecognised agent with a consent
# wall, a challenge, or a "redirecting…" splash rather than the article, so the
# PDF came out holding one line of interstitial text. The Accept headers matter
# for the same reason — servers negotiate on them.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# `<meta http-equiv="refresh" content="0; url=...">`, in the spellings that
# actually occur: any attribute order, quoted or bare, `url=` case-insensitive.
_META_REFRESH_RE = re.compile(
    r"""<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>""", re.IGNORECASE
)
_CONTENT_ATTR_RE = re.compile(r"""content\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
_REFRESH_TARGET_RE = re.compile(r"""^\s*(\d+(?:\.\d+)?)\s*;?\s*url\s*=\s*['"]?([^'"]+)""", re.IGNORECASE)

# A script that sends the browser somewhere else the moment the page loads.
_JS_REDIRECT_RE = re.compile(
    r"""(?:window\.)?location(?:\.href|\.replace\(|\s*=\s*)\s*['"]([^'"]{1,2000})['"]""",
    re.IGNORECASE,
)

# A meta refresh a browser performs immediately. A long delay is a real page
# that happens to move on afterwards (a slideshow, a "session expires in 30s"
# notice) and should be rendered as it stands.
MAX_AUTO_REFRESH_DELAY = 10.0

# How much visible text a page can hold and still be treated as a redirect
# stub rather than content worth rendering.
INTERSTITIAL_TEXT_LIMIT = 600


def _is_public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False
    return True


def is_public_host(host: str) -> bool:
    """Whether a hostname resolves only to public addresses.

    The public spelling of the SSRF check. `browser_render` needs the same
    rule for every request Chromium makes, and importing the private name
    bound it to this function object — patching the module in a test then had
    no effect on the browser path, which is exactly the sort of divergence
    this indirection exists to prevent.
    """
    return _is_public(host)


def _check_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=422, detail="Only http:// and https:// URLs are supported.")
    if not parsed.hostname:
        raise HTTPException(status_code=422, detail="That URL is missing a hostname.")
    if not _is_public(parsed.hostname):
        raise HTTPException(status_code=422, detail="That URL points to a private or internal address, which isn't allowed.")


@dataclass(frozen=True)
class FetchedPage:
    """A fetched page and the URL it was finally served from — the second is
    what relative links and image sources have to be resolved against."""

    url: str
    html: str


def _visible_text_length(html: str) -> int:
    without_head = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", html)
    return len(" ".join(re.sub(r"(?s)<[^>]+>", " ", without_head).split()))


def _meta_refresh_target(html: str) -> str | None:
    """The URL of an immediate `<meta http-equiv="refresh">`, if there is one."""
    for tag in _META_REFRESH_RE.findall(html):
        content = _CONTENT_ATTR_RE.search(tag)
        if not content:
            continue
        target = _REFRESH_TARGET_RE.match(content.group(1))
        if not target:
            continue
        delay, dest = float(target.group(1)), target.group(2).strip()
        if delay <= MAX_AUTO_REFRESH_DELAY and dest:
            return dest
    return None


def _interstitial_target(html: str) -> str | None:
    """Where this page sends a browser on its own, or None if it is content.

    Two mechanisms, and a browser follows both without the reader ever seeing
    the page: a `<meta refresh>`, and a script that assigns `location` on load.
    Fetching the HTML and rendering it verbatim is what produced a PDF whose
    entire content was "Please click here if you are not redirected within a
    few seconds."

    The script case is deliberately conditional on the page being nearly empty.
    Plenty of real articles assign `location` in some handler far down the
    page; a redirect stub is a title, a line of apology and a link.
    """
    meta = _meta_refresh_target(html)
    if meta:
        return meta
    if _visible_text_length(html) <= INTERSTITIAL_TEXT_LIMIT:
        script = _JS_REDIRECT_RE.search(html)
        if script:
            target = script.group(1).strip()
            if target and not target.lower().startswith("javascript:"):
                return target
    return None


def fetch_page(url: str) -> FetchedPage:
    """Fetch a URL as HTML, following redirects — including the ones a browser
    performs from inside the page — and validating every hop to block SSRF.

    Synchronous; call via anyio.to_thread from the route handler.
    """
    _check_url(url)
    current = url
    with httpx.Client(follow_redirects=False, timeout=FETCH_TIMEOUT) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                resp = client.get(current, headers=BROWSER_HEADERS)
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=422, detail=f"Could not fetch that URL: {exc}")

            if resp.is_redirect:
                location = resp.headers.get("location")
                if not location:
                    raise HTTPException(status_code=422, detail="The server sent a redirect with no destination.")
                current = str(resp.next_request.url) if resp.next_request else location
                _check_url(current)
                continue

            if resp.status_code >= 400:
                raise HTTPException(status_code=422, detail=f"That URL returned HTTP {resp.status_code}.")
            if len(resp.content) > MAX_RESPONSE_BYTES:
                raise HTTPException(status_code=422, detail="That page is too large to convert.")
            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                raise HTTPException(status_code=422, detail=f"That URL isn't an HTML page (content-type: {content_type or 'unknown'}).")

            final_url = str(resp.url)
            target = _interstitial_target(resp.text)
            if target:
                current = urljoin(final_url, target)
                _check_url(current)
                continue

            return FetchedPage(url=final_url, html=resp.text)

    raise HTTPException(status_code=422, detail="Too many redirects.")


def fetch_html(url: str) -> str:
    """The page's HTML alone, for callers that do not need the final URL."""
    return fetch_page(url).html


def fetch_binary(url: str, max_bytes: int) -> tuple[bytes, str] | None:
    """Fetch a sub-resource (an image) through the same SSRF guard.

    Returns `(bytes, content-type)`, or None for anything that fails, is too
    large, or is not actually an image — one broken asset must not fail the
    conversion of the page that references it.
    """
    try:
        _check_url(url)
    except HTTPException:
        return None
    try:
        with httpx.Client(follow_redirects=False, timeout=FETCH_TIMEOUT) as client:
            current = url
            for _ in range(MAX_REDIRECTS + 1):
                resp = client.get(current, headers=BROWSER_HEADERS)
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        return None
                    current = str(resp.next_request.url) if resp.next_request else location
                    try:
                        _check_url(current)
                    except HTTPException:
                        return None
                    continue
                if resp.status_code >= 400 or len(resp.content) > max_bytes:
                    return None
                content_type = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if not content_type.startswith("image/"):
                    return None
                return resp.content, content_type
    except httpx.HTTPError:
        return None
    return None
