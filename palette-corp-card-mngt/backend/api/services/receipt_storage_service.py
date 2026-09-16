"""Receipt storage adapters for local dev and Palette platform storage."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import Request as FastAPIRequest

from services.storage_paths import RECEIPTS, input_key


@dataclass(frozen=True)
class StoredReceipt:
    filename: str
    content_type: str
    size: int
    url: str
    object_path: str | None = None
    backend: str = "local"


class LocalReceiptStorage:
    def __init__(self, root: Path) -> None:
        self.root = root

    def upload(
        self,
        *,
        request: FastAPIRequest,
        organization_id: Any,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> StoredReceipt:
        storage_root = self.root / _safe_path_segment(organization_id)
        storage_root.mkdir(parents=True, exist_ok=True)
        stored_filename = _safe_upload_filename(filename)
        destination = storage_root / stored_filename
        destination.write_bytes(content)
        return StoredReceipt(
            filename=stored_filename,
            content_type=content_type,
            size=len(content),
            url=_receipt_download_url(request, stored_filename),
            object_path=str(destination),
            backend="local",
        )

    def path_for(self, organization_id: Any, filename: str) -> Path:
        return self.root / _safe_path_segment(organization_id) / filename

    def delete_org(self, organization_id: Any) -> int:
        storage_root = self.root / _safe_path_segment(organization_id)
        if not storage_root.exists():
            return 0
        count = sum(1 for path in storage_root.iterdir() if path.is_file())
        shutil.rmtree(storage_root, ignore_errors=True)
        return count


class PlatformReceiptStorage:
    def __init__(self, platform_storage: Any) -> None:
        self.platform_storage = platform_storage

    async def upload(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> StoredReceipt:
        stored_filename = _safe_upload_filename(filename)
        saved = await self.platform_storage.upload_file(
            stored_filename,
            content,
            content_type,
            key=input_key(RECEIPTS, stored_filename),
        )
        return StoredReceipt(
            filename=stored_filename,
            content_type=str(saved.get("content_type") or content_type),
            size=int(saved.get("size") or len(content)),
            url=str(saved.get("file_url") or ""),
            object_path=str(saved.get("object_path") or ""),
            backend="platform",
        )


def local_receipt_storage(root: Path) -> LocalReceiptStorage:
    return LocalReceiptStorage(root)


def should_use_platform_storage(mode: str, platform_storage: Any) -> bool:
    normalized = mode.strip().lower()
    if normalized == "platform":
        return True
    if normalized == "local":
        return False
    return platform_storage.__class__.__name__ not in {"LocalStorageService", "UnavailablePlatformService"}


def _safe_path_segment(value: Any) -> str:
    cleaned = "".join("-" if char in '/\\:*?"<>|' else char for char in str(value or "default")).strip(".-")
    return cleaned or "default"


def _safe_upload_filename(filename: str | None) -> str:
    source = Path(filename or "receipt").name
    suffix = Path(source).suffix.lower()
    stem = Path(source).stem if source else "receipt"
    safe_stem = "".join(char if char.isalnum() or char in "._-" else "-" for char in stem).strip(".-")[:80] or "receipt"
    prefix = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    return f"{prefix}-{uuid4().hex[:12]}-{safe_stem}{suffix if suffix and len(suffix) <= 12 else ''}"


def _receipt_download_url(request: FastAPIRequest, filename: str) -> str:
    upload_url = str(request.url)
    if upload_url.endswith("/receipts/upload"):
        return f"{upload_url.removesuffix('/receipts/upload')}/receipts/{filename}"
    return f"/api/v1/plugins/corporate-card-system/receipts/{filename}"
