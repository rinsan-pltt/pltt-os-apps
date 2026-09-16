"""Media storage for the newsletter plugin.

Two-tier upload helper — this is the "helper based GCS upload" service layer:

  1. Platform storage (``ctx.storage.upload_file``) — the ONLY tier used on the
     hosted server. Available whenever ``platform_services: ["storage"]`` is
     declared and the runtime provides it (``pltt dev``, hosted sandbox,
     production). GCS-backed by the platform in every real environment; mirrors
     ``3pages/backend/api/storage.py``. On the server we go through this
     SDK-provided service and nothing else.
  2. Direct-GCS tier using local service-account credentials — LOCAL DEV ONLY.
     Consulted only when ``ctx.storage`` is unavailable/unusable AND the local
     opt-in ``APP_MEDIA_GCS_ENABLED`` is set (see ``_local_gcs_configured``).
     ``pltt dev``'s local simulator only ever returns ``file://`` URLs that a
     browser ``<img>`` / the LLM gateway can't fetch, so this tier gives local
     development a real, fetchable bucket URL. It is gated so it can never run on
     the hosted server: ``APP_MEDIA_GCS_ENABLED`` / ``GCS_CREDENTIALS_PATH`` are
     not plugin-scoped secrets, and the credentials file only exists on the
     developer's machine. Configured via ``GCS_BUCKET_NAME`` /
     ``GCS_CREDENTIALS_PATH`` (same shape as the source app's own
     service-account-file GCS client).

Object keys are laid out as ``<prefix_root>/inputs/...`` for user-supplied
uploads and ``<prefix_root>/outputs/...`` for AI-generated/derived media, so
the two are cleanly separated in the bucket (``category`` arg of ``save_media``).

If neither tier is usable, ``save_media`` raises ``HTTPException(503)`` —
uploads fail loudly rather than silently returning an unusable URL.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import logging
import mimetypes
import os
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import HTTPException
from palette_sdk.platform_services import UnavailablePlatformService

from newsletter_backend.api.config import settings

logger = logging.getLogger(__name__)

# Short-lived in-process cache of bytes we uploaded, keyed by the returned URL.
# ctx.storage exposes no read/download method, so PDF export — which must inline
# images as base64 data URIs because WeasyPrint can't HTTP-fetch its own backend
# — reads back through this cache instead of a storage read call. Entries only
# need to survive one request/process lifetime: export always targets an image
# this same process just generated, edited, or fetched.
_RECENT_BYTES: dict[str, tuple[bytes, str]] = {}
_RECENT_BYTES_MAX = 256


def _remember(url: str, content: bytes, content_type: str) -> None:
    if len(_RECENT_BYTES) >= _RECENT_BYTES_MAX:
        _RECENT_BYTES.pop(next(iter(_RECENT_BYTES)))
    _RECENT_BYTES[url] = (content, content_type)


def cached_bytes(url: str) -> tuple[bytes, str] | None:
    """Return (content, content_type) for a URL this process previously wrote via
    save_media/persist_external_url, or None (e.g. after a restart, or a URL this
    plugin never uploaded — such an image is left as a live URL for the renderer
    to fetch directly instead of being inlined)."""
    return _RECENT_BYTES.get(url)


@lru_cache(maxsize=1)
def _local_gcs_bucket():
    """Direct GCS client for the standalone-mode fallback tier. Built once per
    process; only called when _local_gcs_configured() is true."""
    from google.cloud import storage as gcs_storage
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_file(
        settings.gcs_credentials_path
    )
    client = gcs_storage.Client(credentials=creds, project=creds.project_id)
    return client.bucket(settings.gcs_bucket_name)


def _local_gcs_configured() -> bool:
    """True only for local development: the direct-GCS tier requires the explicit
    ``APP_MEDIA_GCS_ENABLED`` opt-in AND local service-account credentials that
    actually exist on disk. On the hosted server none of these are present (the
    flag isn't a plugin secret and the creds file isn't packaged), so this is
    always False there and uploads go exclusively through platform storage."""
    return bool(
        settings.app_media_gcs_enabled
        and settings.gcs_bucket_name
        and settings.gcs_credentials_path
        and os.path.exists(settings.gcs_credentials_path)
    )


def _platform_storage(ctx: Any) -> Any | None:
    storage_service = getattr(ctx, "storage", None)
    if storage_service is None or isinstance(storage_service, UnavailablePlatformService):
        return None
    return storage_service


def _accepts_key(upload_fn: Any) -> bool:
    """True if this ctx.storage.upload_file accepts the `key=` keyword.

    `key=` (explicit object path under the app's storage prefix) is not present
    in every backend-SDK revision the platform may inject at runtime — the
    manifest pins a RANGE (`sdk.backend`), and the hosted runtime supplies its
    own storage service rather than the SDK's LocalStorageService. Passing an
    unsupported keyword raises TypeError inside the route, which surfaces to the
    browser as an opaque 500 with no usable body. Probe the signature instead
    and fall back to the positional-only form, letting the service pick the
    object path itself. `pltt dev`'s LocalStorageService always accepts `key`,
    which is exactly why this gap can only ever show up on the server.
    """
    try:
        params = inspect.signature(upload_fn).parameters
    except (TypeError, ValueError):  # builtins / C-implemented / proxied callables
        return True
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return True
    return "key" in params


async def _platform_upload(storage_service: Any, filename: str, content: bytes, content_type: str, key: str) -> dict:
    """Call ctx.storage.upload_file, translating any provider failure into a
    502 that names the real cause. Without this an exception from the platform
    storage client escapes the route as a bare 500 whose body the browser shows
    as "Failed to load response data" — which is what makes this class of
    hosted-only upload failure so hard to diagnose from the network tab."""
    upload_fn = storage_service.upload_file
    try:
        if _accepts_key(upload_fn):
            return await upload_fn(filename, content, content_type, key=key)
        logger.warning(
            "Platform storage upload_file does not accept key= — uploading without an "
            "explicit object path (the service will choose one). Object-key layout "
            "(%s) is not applied on this runtime.",
            key,
        )
        return await upload_fn(filename, content, content_type)
    except Exception as exc:  # noqa: BLE001 — re-raised as a legible HTTP error below
        logger.exception("Platform storage upload failed for key %s", key)
        raise HTTPException(
            status_code=502,
            detail=f"Platform storage upload failed: {type(exc).__name__}: {exc}",
        ) from exc


async def save_media(
    ctx: Any,
    content: bytes,
    *,
    prefix: str,
    category: str = "inputs",
    suffix: str = ".png",
    content_type: str = "image/png",
    require_public_url: bool = True,
) -> str:
    """Upload raw bytes and return an absolute URL.

    ``category`` selects the top-level bucket folder: ``"inputs"`` for
    user-supplied uploads (documents, logos, mascot art, overlay uploads) and
    ``"outputs"`` for AI-generated/derived media. The object key is
    ``<gcs_object_prefix>/<category>/<prefix>/<uuid><suffix>``, e.g.
    ``newsletter/inputs/documents/<uuid>.pdf`` or
    ``newsletter/outputs/generated/<uuid>.png``.

    Tries platform storage first (the only tier on the hosted server), then the
    local-dev-only direct-GCS tier. Raises HTTPException(503) if neither tier
    produces a usable URL.

    `pltt dev`'s LocalStorageService writes to disk and returns `file_url` as a
    `file://` URI (confirmed in palette_sdk/storage.py — it has no HTTP-serving
    path at all in local dev mode). A `file://` URL can't be loaded by a browser
    `<img>` or fetched by the LLM gateway, so by default it's treated the same
    as platform storage being unavailable: fall through to the local-GCS tier
    instead of returning a URL nothing can actually use.

    Pass `require_public_url=False` for callers that only ever read the bytes
    back in-process via `cached_bytes()` (e.g. dataroom document extraction)
    and never hand the URL to a browser or an external API — for those, the
    `file://` URL from pltt dev's local simulator is perfectly usable, and
    demanding a real bucket (this plugin's GCS-credentials fallback tier,
    meant for the standalone Docker runtime that has no ctx.storage at all)
    is unnecessary friction. Mirrors how palette-creative-labs's
    storage_helper.py accepts pltt dev's local file instead of fighting for a
    publicly-fetchable URL it doesn't actually need.
    """
    safe_suffix = suffix if suffix.startswith(".") else f".{suffix}"
    filename = f"{uuid4().hex}{safe_suffix}"
    folder = category if category in ("inputs", "outputs") else "inputs"
    root = settings.gcs_object_prefix or "newsletter"
    key = f"{root}/{folder}/{prefix}/{filename}"

    storage_service = _platform_storage(ctx)
    if storage_service is not None:
        saved = await _platform_upload(storage_service, filename, content, content_type, key)
        url = str(saved.get("file_url") or saved.get("object_path") or "")
        if url.startswith(("http://", "https://")):
            _remember(url, content, content_type)
            logger.info("Uploaded media to platform storage: %s", url)
            return url
        if not require_public_url and url:
            _remember(url, content, content_type)
            logger.info(
                "Platform storage returned a non-http(s) URL (%s) — pltt dev's "
                "local simulator never serves files over HTTP, but this caller "
                "only reads bytes back in-process, so the local URL is kept as-is "
                "instead of requiring a real GCS bucket.",
                url,
            )
            return url
        logger.warning(
            "Platform storage returned a non-http(s) URL (%s) — likely pltt dev's "
            "local simulator, which never serves files over HTTP. Falling back to "
            "the local-GCS tier.",
            url or "<empty>",
        )

    if _local_gcs_configured():
        url = await _upload_to_local_gcs(key, content, content_type)
        _remember(url, content, content_type)
        logger.info("Uploaded media to local-credentials GCS fallback: %s", url)
        return url

    raise HTTPException(
        status_code=503,
        detail=(
            "Media storage unavailable — no platform storage produced a fetchable "
            "URL (pltt dev's local simulator only writes file:// paths), and the "
            "local-dev direct-GCS tier is not enabled. For local uploads set "
            "APP_MEDIA_GCS_ENABLED=true + GCS_BUCKET_NAME + GCS_CREDENTIALS_PATH in "
            ".env, or run against a hosted sandbox (pltt dev --sandbox) for real "
            "ctx.storage. On the hosted server this means platform storage "
            "(ctx.storage) is not being provided — check the plugin's "
            "platform_services declaration."
        ),
    )


async def _upload_to_local_gcs(key: str, content: bytes, content_type: str) -> str:
    def _upload() -> str:
        blob = _local_gcs_bucket().blob(key)
        blob.upload_from_string(content, content_type=content_type)
        return f"https://storage.googleapis.com/{settings.gcs_bucket_name}/{key}"

    return await asyncio.to_thread(_upload)


def to_data_uri(url: str) -> str | None:
    """Best-effort base64 data URI for an absolute http(s) URL this plugin may
    have produced. Tries the in-process cache first (works regardless of what
    URL shape ctx.storage returns, e.g. in pltt dev), then falls back to a
    direct fetch of the URL as a public resource (works for GCS / the
    local-GCS fallback / production). Returns None if url isn't http(s) or
    both paths fail — callers should fall back to using the raw URL as-is.

    Used by server-side rendering (PDF/HTML export, header/footer preview)
    that can't depend on the renderer itself being able to fetch the URL.
    """
    if not (url.startswith("http://") or url.startswith("https://")):
        return None
    cached = cached_bytes(url)
    if cached:
        data, content_type = cached
        return f"data:{content_type};base64,{base64.b64encode(data).decode()}"
    try:
        import urllib.request

        with urllib.request.urlopen(url, timeout=15) as response:  # noqa: S310 — our own public storage URL
            data = response.read()
            mime = response.headers.get_content_type() or "application/octet-stream"
        return f"data:{mime};base64,{base64.b64encode(data).decode()}"
    except Exception:  # noqa: BLE001
        return None


async def read_bytes(url: str) -> tuple[bytes, str] | None:
    """Best-effort fetch of bytes this plugin previously stored.

    `cached_bytes` only knows what THIS process uploaded, so it goes empty after
    a restart — which is exactly when a user reopens an old document. Fall back
    to fetching the URL: platform storage hands back absolute http(s) URLs, and
    the local-dev tier can hand back a `file://` path, so both are handled.
    Returns None when the bytes cannot be recovered; callers degrade rather than
    fail, because a document's text is already in the database either way.
    """
    cached = cached_bytes(url)
    if cached is not None:
        return cached

    if url.startswith("file://"):
        from urllib.parse import unquote, urlparse

        path = Path(unquote(urlparse(url).path))
        try:
            return path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        except OSError:
            logger.warning("storage: could not read %s from disk", url, exc_info=True)
            return None

    if not url.startswith("http"):
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.content, response.headers.get("content-type", "application/octet-stream")
    except Exception:  # noqa: BLE001 — degrade to "no preview", never 500
        logger.warning("storage: could not fetch %s", url, exc_info=True)
        return None


async def persist_external_url(
    ctx: Any,
    url: str,
    *,
    prefix: str,
    category: str = "inputs",
    suffix: str = ".png",
    content_type: str = "image/png",
) -> str:
    """Download bytes from any URL — e.g. a gateway response that resolves to a
    bare loopback address in local dev and is unreachable from a hosted sandbox
    or a teammate's browser — and re-upload via save_media, returning a durable
    absolute URL. Prefer this over ever handing a raw external/loopback URL back
    to a route response or to export rendering."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        content = response.content
    return await save_media(
        ctx, content, prefix=prefix, category=category, suffix=suffix, content_type=content_type
    )
