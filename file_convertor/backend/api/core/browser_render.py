"""Render a URL the way a browser sees it.

The fetch-and-lay-out path in `webpage_render` cannot run JavaScript, and a
large part of the web no longer produces its content without it. Two failures
reported from the field:

  * a Google search URL converted to its "Enable JavaScript to use search"
    help page — a real page, served deliberately to clients without JS;
  * a Dribbble shot converted to nothing at all, because the markup is an
    empty shell that React fills in on the client.

Neither is fixable by parsing harder. This module drives a real Chromium
through Playwright and asks it to print the page, which is the only way the
result matches what the reader sees.

Chromium is optional: `browser_available()` reports whether this host actually
has one, and the caller falls back to the text path when it does not. The
guarantee that survives either way is the SSRF one — every request the browser
makes, main frame and sub-resource alike, is checked against the same
private-address rules as the plain fetcher, and aborted if it points inward.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException

from .net import BROWSER_HEADERS, _check_url, is_public_host

logger = logging.getLogger(__name__)

# A page gets this long to load before we give up on it entirely.
NAVIGATION_TIMEOUT_MS = 30_000
# …and this long for its XHRs to go quiet. Plenty of pages never reach idle
# (polling, analytics beacons, video); missing it is not an error.
IDLE_TIMEOUT_MS = 8_000

VIEWPORT = {"width": 1280, "height": 1600}

_available: bool | None = None


def browser_available() -> bool:
    """Whether this host can render with Chromium. Probed once, then cached —
    the answer cannot change without a restart, and launching a browser to
    answer it on every request would be absurd."""
    global _available
    if _available is not None:
        return _available
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--no-sandbox"])
            browser.close()
        _available = True
    except Exception as exc:  # noqa: BLE001 — any failure means "no browser here"
        logger.info("No browser engine available for HTML to PDF: %s", exc)
        _available = False
    return _available


@dataclass(frozen=True)
class RenderedPage:
    url: str
    title: str
    text: str


def _guard_request(route, request) -> None:
    """Abort anything aimed at a private address, wherever it came from.

    The plain fetcher validates each redirect hop itself. A browser follows
    redirects, loads sub-resources and honours in-page navigation on its own,
    so the check has to sit on the request itself — otherwise a page could
    reach the metadata endpoint through an <img> tag.
    """
    host = urlparse(request.url).hostname
    if host and not is_public_host(host):
        route.abort()
        return
    route.continue_()


def render_url_to_pdf(url: str, out_path: Path) -> RenderedPage:
    """Print `url` to `out_path` with a real browser. Raises HTTPException with
    a user-facing message when the page cannot be loaded at all."""
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import TimeoutError as PlaywrightTimeout
    from playwright.sync_api import sync_playwright

    _check_url(url)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            context = browser.new_context(
                viewport=VIEWPORT,
                user_agent=BROWSER_HEADERS["User-Agent"],
                locale="en-US",
                ignore_https_errors=False,
            )
            context.set_extra_http_headers({"Accept-Language": BROWSER_HEADERS["Accept-Language"]})
            context.route("**/*", _guard_request)
            page = context.new_page()
            page.set_default_timeout(NAVIGATION_TIMEOUT_MS)

            try:
                response = page.goto(url, wait_until="load", timeout=NAVIGATION_TIMEOUT_MS)
            except PlaywrightTimeout:
                raise HTTPException(
                    status_code=422,
                    detail="That page took too long to load. It may be very large, or blocking automated browsers.",
                )
            except PlaywrightError as exc:
                raise HTTPException(status_code=422, detail=f"Could not open that URL: {exc.message.splitlines()[0]}")

            if response is not None and response.status >= 400:
                raise HTTPException(
                    status_code=422,
                    detail=f"That URL returned HTTP {response.status}.",
                )

            # Client-rendered pages finish after `load`; give the XHRs a moment,
            # but do not fail a page that simply never goes quiet.
            try:
                page.wait_for_load_state("networkidle", timeout=IDLE_TIMEOUT_MS)
            except PlaywrightTimeout:
                pass

            # Lazy-loaded images only fetch once they approach the viewport, so
            # walk the page before printing or the PDF is full of empty boxes.
            try:
                page.evaluate(
                    """async () => {
                        const step = window.innerHeight;
                        const height = document.body ? document.body.scrollHeight : 0;
                        for (let y = 0; y < height; y += step) {
                            window.scrollTo(0, y);
                            await new Promise((r) => setTimeout(r, 120));
                        }
                        window.scrollTo(0, 0);
                    }"""
                )
                page.wait_for_timeout(400)
            except PlaywrightError:
                pass

            title = (page.title() or "").strip()
            try:
                text = page.inner_text("body")
            except PlaywrightError:
                text = ""
            final_url = page.url

            page.emulate_media(media="print")
            page.pdf(
                path=str(out_path),
                format="A4",
                print_background=True,
                margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"},
            )
            return RenderedPage(url=final_url, title=title, text=" ".join(text.split()))
        finally:
            browser.close()
