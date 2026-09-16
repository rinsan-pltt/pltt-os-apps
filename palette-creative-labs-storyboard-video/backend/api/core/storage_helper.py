"""Storage helper: download an arbitrary URL and re-upload to Palette-managed
app storage via `ctx.storage`. Replaces pltt-agg's direct GCS helper.
"""

from __future__ import annotations

import base64
import functools
import logging
import mimetypes
import os
import re
import tempfile
import uuid
from pathlib import Path, PurePosixPath
from typing import Optional
from urllib.parse import unquote, urlparse

import anyio
import httpx

from .video_merge import extract_first_frame, find_ffmpeg

logger = logging.getLogger("pltt_creative_video.storage")

_FOLDER = {
    "images": "story_board_video/outputs/images",
    "videos": "story_board_video/outputs/videos",
    "masks": "story_board_video/outputs/masks",
}


def _infer_extension(content_type: str, source_url: str) -> str:
    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if ext and ext != ".jpe":
            return ext if ext != ".jpeg" else ".jpg"
    suffix = PurePosixPath(urlparse(source_url).path).suffix
    return suffix or ".bin"


async def resize_and_store(
    ctx, source_url: str, width: int, height: int, media_type: str = "images"
) -> str:
    """Download `source_url`, resize to exactly (width, height), store it, and
    return the stored URL. Used to normalize Midjourney output (which renders at
    its own native resolution) to the same pixel dimensions other models produce
    for a given aspect + resolution. Falls back to storing the original on any
    failure (or when the size already matches)."""
    import asyncio
    import io

    if not (width and height) or width <= 0 or height <= 0:
        return await upload_media_to_storage(ctx, source_url, media_type)
    try:
        from PIL import Image

        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            resp = await client.get(source_url)
            resp.raise_for_status()
            raw = resp.content

        def _resize() -> bytes:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            if img.size == (width, height):
                return b""  # already correct — signal "no change"
            img = img.resize((width, height), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

        data = await asyncio.to_thread(_resize)
        if not data:
            return await upload_media_to_storage(ctx, source_url, media_type)
        b64 = base64.b64encode(data).decode("ascii")
        return await upload_data_url_to_storage(
            ctx, f"data:image/png;base64,{b64}", media_type
        )
    except Exception as exc:
        logger.warning(f"⚠️ resize to {width}x{height} failed ({exc}); storing original")
        return await upload_media_to_storage(ctx, source_url, media_type)


async def upload_media_to_storage(ctx, source_url: str, media_type: str) -> str:
    """Downloads `source_url` and uploads it to app storage under
    `story_board_video/outputs/<media>/<uuid>.<ext>`. Returns the canonical file URL.

    `ctx` is the PluginContext so the upload lands in the org-scoped bucket
    that Palette manages (no per-developer GCS credentials required).
    """
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        resp = await client.get(source_url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "application/octet-stream")
        data = resp.content

    ext = _infer_extension(content_type, source_url)
    folder = _FOLDER.get(media_type, f"story_board_video/outputs/{media_type}")
    key = f"{folder}/{uuid.uuid4()}{ext}"
    name = key.rsplit("/", 1)[-1]

    saved = await ctx.storage.upload_file(name, data, content_type, key=key)
    url = saved.get("file_url") or saved.get("fileUrl") or saved.get("url")
    # Local dev storage returns file:// URLs which browsers refuse to load
    # from a web page (the iframe renders "about:blank#blocked"). Fall back
    # to the upstream provider URL — it's already a public CDN — and remove
    # the local cache file so `.palette/dev-storage` doesn't grow unbounded
    # (the file we just wrote is never served).
    if isinstance(url, str) and url.startswith("file://"):
        _unlink_local(url)
        logger.info(f"📁 Local dev storage skipped for {media_type}; serving upstream URL")
        return source_url
    logger.info(f"☁️  Uploaded {media_type} → {url}")
    return url


_DATA_URL_RE = re.compile(r"^data:(?P<type>[\w/+.-]+);base64,(?P<b64>.+)$", re.DOTALL)


async def upload_data_url_to_storage(ctx, data_url: str, media_type: str) -> str:
    """Uploads an inline base64 `data:` URL (e.g. a mask PNG painted in the
    browser) to app storage under `story_board_video/outputs/<media>/<uuid>.<ext>` and
    returns the canonical file URL.

    Local dev storage serves file:// URLs that providers can't fetch — there
    the original data URL is returned instead (fal accepts data URIs in image
    payloads), so masking still works without hosted storage.
    """
    m = _DATA_URL_RE.match(data_url.strip())
    if not m:
        raise ValueError("Expected a base64 data: URL")
    content_type = m.group("type") or "image/png"
    data = base64.b64decode(m.group("b64"))

    ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".png"
    folder = _FOLDER.get(media_type, f"story_board_video/outputs/{media_type}")
    key = f"{folder}/{uuid.uuid4()}{ext}"
    name = key.rsplit("/", 1)[-1]

    saved = await ctx.storage.upload_file(name, data, content_type, key=key)
    url = saved.get("file_url") or saved.get("fileUrl") or saved.get("url")
    if isinstance(url, str) and url.startswith("file://"):
        _unlink_local(url)
        logger.info(f"📁 Local dev storage skipped for {media_type}; passing the data URL through")
        return data_url
    logger.info(f"☁️  Uploaded {media_type} → {url}")
    return url


def provider_safe_image_url(url: str) -> str:
    """Make an image URL fetchable by external providers (fal / runware / the
    router). Local dev storage hands out `file://` URLs which those services
    can't reach; read the backing file and return a base64 `data:` URI instead
    (providers accept data URIs in image inputs). http(s) and data: URLs pass
    through unchanged."""
    if not isinstance(url, str) or not url.startswith("file://"):
        return url
    try:
        path = Path(unquote(urlparse(url).path))
        data = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "image/png"
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{ctype};base64,{b64}"
    except Exception as exc:
        logger.warning(f"⚠️ could not inline local reference {url}: {exc}")
        return url


async def _thumbnail_from_file(ctx, video_path: str) -> Optional[str]:
    """Extract a local video's first frame as a JPEG and store it via
    `upload_data_url_to_storage` (which already handles the local-dev
    file:// fallback by handing back the data: URL itself — directly
    renderable in an <img>, no separate serving route needed).

    Thumbnails are a nice-to-have, never allowed to block a video's own
    completion — any failure (ffmpeg missing, extraction error, …) is logged
    and swallowed, returning None."""
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        logger.warning("⚠️ ffmpeg not available; skipping video thumbnail")
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="video-thumb-") as tmp:
            out_path = str(Path(tmp) / "thumb.jpg")
            await anyio.to_thread.run_sync(
                functools.partial(extract_first_frame, ffmpeg, video_path, out_path)
            )
            jpeg_bytes = Path(out_path).read_bytes()
        b64 = base64.b64encode(jpeg_bytes).decode("ascii")
        return await upload_data_url_to_storage(ctx, f"data:image/jpeg;base64,{b64}", "images")
    except Exception as exc:
        logger.warning(f"⚠️ video thumbnail generation failed: {exc}")
        return None


async def generate_video_thumbnail(ctx, video_url: str) -> Optional[str]:
    """Download a completed video and store its first frame as a JPEG
    thumbnail, returning the stored URL (or None on any failure)."""
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            resp = await client.get(video_url)
            resp.raise_for_status()
            data = resp.content
    except Exception as exc:
        logger.warning(f"⚠️ could not download video for thumbnail: {exc}")
        return None
    with tempfile.TemporaryDirectory(prefix="video-thumb-src-") as tmp:
        video_path = str(Path(tmp) / "clip.mp4")
        Path(video_path).write_bytes(data)
        return await _thumbnail_from_file(ctx, video_path)


async def generate_video_thumbnail_from_file(ctx, video_path: str) -> Optional[str]:
    """Same as `generate_video_thumbnail`, but for a video that's already a
    local file (e.g. the story merge's freshly-produced mp4) — skips the
    redundant download."""
    return await _thumbnail_from_file(ctx, video_path)


def _unlink_local(file_url: str) -> None:
    """Delete the local file backing a file:// URL. Silently ignores anything
    outside `.palette/dev-storage` so we can never remove unrelated paths."""
    try:
        path = Path(unquote(urlparse(file_url).path))
    except Exception:
        return
    if "dev-storage" not in path.parts:
        return
    try:
        path.unlink(missing_ok=True)
        # Best-effort cleanup of empty parent dirs (e.g. the outputs/<id>
        # folder when this was its only file).
        parent = path.parent
        while parent.name and "dev-storage" in parent.parts and parent.name != "dev-storage":
            try:
                os.rmdir(parent)
            except OSError:
                break
            parent = parent.parent
    except Exception as exc:
        logger.debug(f"could not unlink local dev file {path}: {exc}")
