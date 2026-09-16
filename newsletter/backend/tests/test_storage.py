"""save_media tries platform storage first, then the local-credentials GCS
fallback (used only when ctx.storage is unavailable, e.g. the plugin's
standalone runtime), then raises 503 if neither is usable.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from palette_sdk.platform_services import UnavailablePlatformService

from newsletter_backend.api import storage


class _RecordingStorage:
    """Fake platform storage capturing the upload_file call."""

    def __init__(self, result: dict):
        self.result = result
        self.calls: list[dict] = []

    async def upload_file(self, filename, content, content_type, *, key):
        self.calls.append(
            {"filename": filename, "content": content, "content_type": content_type, "key": key}
        )
        return self.result


def setup_function() -> None:
    storage._RECENT_BYTES.clear()
    storage._local_gcs_bucket.cache_clear()


def test_save_media_returns_absolute_file_url():
    fake = _RecordingStorage(
        {"file_url": "https://cdn.example.com/newsletter/mascots/x.png", "object_path": "newsletter/mascots/x.png"}
    )
    ctx = SimpleNamespace(storage=fake)
    url = asyncio.run(storage.save_media(ctx, b"DATA", prefix="mascots", content_type="image/png"))
    assert url == "https://cdn.example.com/newsletter/mascots/x.png"
    call = fake.calls[0]
    # default category is "inputs" (user-supplied upload)
    assert call["key"].startswith("newsletter/inputs/mascots/")
    assert call["key"].endswith(".png")
    assert call["content"] == b"DATA"
    assert call["content_type"] == "image/png"


def test_save_media_rejects_file_url_from_local_dev_simulator(monkeypatch):
    """pltt dev's LocalStorageService always returns file_url as a file:// URI
    (palette_sdk/storage.py: `file_url=target.as_uri()`, no HTTP-serving path
    exists in local dev mode) — a browser <img> and the LLM gateway can't fetch
    that, so save_media must NOT return it, and must fall through to the
    local-GCS tier instead (or 503 if that isn't configured either)."""
    monkeypatch.setattr(storage, "_local_gcs_configured", lambda: False)
    fake = _RecordingStorage(
        {"file_url": "file:///Users/dev/.palette/dev-storage/uploads/newsletter/edits/y.png"}
    )
    ctx = SimpleNamespace(storage=fake)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(storage.save_media(ctx, b"PAYLOAD", prefix="edits"))
    assert ei.value.status_code == 503


def test_save_media_falls_back_to_local_gcs_when_platform_storage_returns_file_url(monkeypatch):
    """Same file:// response as above, but GCS_BUCKET_NAME/GCS_CREDENTIALS_PATH
    ARE configured — save_media must use the local-GCS tier instead of raising,
    so pltt dev produces real, usable image URLs."""
    monkeypatch.setattr(storage, "_local_gcs_configured", lambda: True)
    monkeypatch.setattr(storage.settings, "gcs_bucket_name", "test-bucket")

    fake = _RecordingStorage({"file_url": "file:///Users/dev/.palette/dev-storage/uploads/y.png"})
    ctx = SimpleNamespace(storage=fake)

    uploaded: dict = {}

    class _FakeBlob:
        def upload_from_string(self, content, content_type=None):
            uploaded["content"] = content

    class _FakeBucket:
        def blob(self, key):
            uploaded["key"] = key
            return _FakeBlob()

    monkeypatch.setattr(storage, "_local_gcs_bucket", lambda: _FakeBucket())

    url = asyncio.run(storage.save_media(ctx, b"PAYLOAD", prefix="edits"))
    assert url == "https://storage.googleapis.com/test-bucket/" + uploaded["key"]
    assert uploaded["content"] == b"PAYLOAD"
    assert fake.calls  # platform storage was tried first


def test_save_media_caches_bytes_for_export_inlining():
    fake = _RecordingStorage({"file_url": "https://cdn.example.com/newsletter/uploads/z.png"})
    ctx = SimpleNamespace(storage=fake)
    url = asyncio.run(storage.save_media(ctx, b"BYTES", prefix="uploads", content_type="image/png"))
    cached = storage.cached_bytes(url)
    assert cached == (b"BYTES", "image/png")


def test_save_media_raises_when_neither_tier_available(monkeypatch):
    monkeypatch.setattr(storage, "_local_gcs_configured", lambda: False)
    ctx = SimpleNamespace(storage=UnavailablePlatformService("storage"))
    with pytest.raises(HTTPException) as ei:
        asyncio.run(storage.save_media(ctx, b"DATA", prefix="mascots"))
    assert ei.value.status_code == 503


def test_save_media_raises_when_storage_none_and_no_local_gcs(monkeypatch):
    monkeypatch.setattr(storage, "_local_gcs_configured", lambda: False)
    ctx = SimpleNamespace(storage=None)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(storage.save_media(ctx, b"DATA", prefix="mascots"))
    assert ei.value.status_code == 503


def test_save_media_falls_back_to_local_gcs_when_platform_storage_unavailable(monkeypatch):
    """Standalone-mode fallback: ctx.storage is unavailable (no pltt/platform
    context), but GCS_BUCKET_NAME + GCS_CREDENTIALS_PATH are configured — save_media
    must use the direct-GCS tier instead of raising."""
    monkeypatch.setattr(storage, "_local_gcs_configured", lambda: True)
    monkeypatch.setattr(storage.settings, "gcs_bucket_name", "test-bucket")

    uploaded: dict = {}

    class _FakeBlob:
        def upload_from_string(self, content, content_type=None):
            uploaded["content"] = content
            uploaded["content_type"] = content_type

    class _FakeBucket:
        def blob(self, key):
            uploaded["key"] = key
            return _FakeBlob()

    monkeypatch.setattr(storage, "_local_gcs_bucket", lambda: _FakeBucket())

    ctx = SimpleNamespace(storage=UnavailablePlatformService("storage"))
    url = asyncio.run(storage.save_media(ctx, b"LOCAL", prefix="mascots", content_type="image/png"))

    assert url == "https://storage.googleapis.com/test-bucket/" + uploaded["key"]
    assert uploaded["content"] == b"LOCAL"
    assert uploaded["key"].startswith("newsletter/inputs/mascots/")


def test_save_media_outputs_category_uses_outputs_folder():
    """AI-generated/derived media is keyed under <root>/outputs/... so it's
    cleanly separated from user-supplied uploads (which go under inputs/)."""
    fake = _RecordingStorage({"file_url": "https://cdn.example.com/newsletter/outputs/generated/g.png"})
    ctx = SimpleNamespace(storage=fake)
    asyncio.run(
        storage.save_media(ctx, b"GEN", prefix="generated", category="outputs", content_type="image/png")
    )
    assert fake.calls[0]["key"].startswith("newsletter/outputs/generated/")


def test_local_gcs_disabled_without_explicit_opt_in(monkeypatch):
    """The direct-GCS tier is LOCAL-DEV-ONLY: even with a bucket + a real creds
    file, it stays off unless APP_MEDIA_GCS_ENABLED is set. This is what keeps
    the hosted server on platform storage (ctx.storage) exclusively — the flag
    is not a plugin secret, so it can never be true there."""
    monkeypatch.setattr(storage.settings, "gcs_bucket_name", "test-bucket")
    monkeypatch.setattr(storage.settings, "gcs_credentials_path", __file__)  # a file that exists
    monkeypatch.setattr(storage.settings, "app_media_gcs_enabled", False)
    assert storage._local_gcs_configured() is False
    monkeypatch.setattr(storage.settings, "app_media_gcs_enabled", True)
    assert storage._local_gcs_configured() is True


class _LegacyStorage:
    """A platform storage service from an older backend-SDK revision: no `key=`.

    `pltt dev`'s LocalStorageService always accepts `key`, so a runtime whose
    service doesn't is only ever reachable on the hosted server — passing the
    keyword there raised TypeError inside the route and surfaced as an opaque
    500 with an unreadable body."""

    def __init__(self, result: dict):
        self.result = result
        self.calls: list[dict] = []

    async def upload_file(self, filename, content, content_type=None):
        self.calls.append({"filename": filename, "content": content, "content_type": content_type})
        return self.result


class _ExplodingStorage:
    async def upload_file(self, filename, content, content_type, *, key):
        raise RuntimeError("bucket not provisioned for this organization")


def test_save_media_falls_back_when_platform_storage_has_no_key_kwarg():
    fake = _LegacyStorage({"file_url": "https://cdn.example.com/uploads/legacy.pdf"})
    ctx = SimpleNamespace(storage=fake)
    url = asyncio.run(
        storage.save_media(ctx, b"DOC", prefix="documents", suffix=".pdf", content_type="application/pdf")
    )
    assert url == "https://cdn.example.com/uploads/legacy.pdf"
    # uploaded positionally, without the unsupported keyword
    assert fake.calls[0]["content"] == b"DOC"
    assert fake.calls[0]["content_type"] == "application/pdf"


def test_save_media_reports_platform_storage_failure_as_502():
    """A provider failure must name its cause rather than escaping as a bare 500
    whose body DevTools reports as 'Failed to load response data'."""
    ctx = SimpleNamespace(storage=_ExplodingStorage())
    with pytest.raises(HTTPException) as ei:
        asyncio.run(storage.save_media(ctx, b"DOC", prefix="documents", require_public_url=False))
    assert ei.value.status_code == 502
    assert "bucket not provisioned" in ei.value.detail


def test_accepts_key_detects_signature_support():
    async def with_key(filename, content, content_type, *, key): ...
    async def without_key(filename, content, content_type): ...
    async def with_kwargs(filename, content, content_type, **kw): ...

    assert storage._accepts_key(with_key) is True
    assert storage._accepts_key(without_key) is False
    assert storage._accepts_key(with_kwargs) is True


def test_persist_external_url_downloads_then_reuploads(monkeypatch):
    fake = _RecordingStorage({"file_url": "https://cdn.example.com/newsletter/edits/reposted.png"})
    ctx = SimpleNamespace(storage=fake)

    class _FakeResponse:
        content = b"DOWNLOADED"

        def raise_for_status(self):
            pass

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url):
            assert url == "http://localhost:4444/media/abc.png"
            return _FakeResponse()

    monkeypatch.setattr(storage.httpx, "AsyncClient", lambda **kwargs: _FakeClient())

    url = asyncio.run(
        storage.persist_external_url(
            ctx, "http://localhost:4444/media/abc.png", prefix="edits", content_type="image/png"
        )
    )
    assert url == "https://cdn.example.com/newsletter/edits/reposted.png"
    assert fake.calls[0]["content"] == b"DOWNLOADED"
