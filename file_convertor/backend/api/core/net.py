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
import socket
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 15 * 1024 * 1024
FETCH_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


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


def _check_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=422, detail="Only http:// and https:// URLs are supported.")
    if not parsed.hostname:
        raise HTTPException(status_code=422, detail="That URL is missing a hostname.")
    if not _is_public(parsed.hostname):
        raise HTTPException(status_code=422, detail="That URL points to a private or internal address, which isn't allowed.")


def fetch_html(url: str) -> str:
    """Fetch a URL as text, validating every hop to block SSRF. Synchronous —
    call via anyio.to_thread from the route handler."""
    _check_url(url)
    current = url
    with httpx.Client(follow_redirects=False, timeout=FETCH_TIMEOUT) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                resp = client.get(current, headers={"User-Agent": "FileConvertorBot/1.0"})
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
            return resp.text

    raise HTTPException(status_code=422, detail="Too many redirects.")
