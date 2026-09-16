"""Persistent storage for saved receipt files.

`STORAGE_DIR` mirrors the `LOCAL_STORAGE_DIR` env var the platform-dev
container sets in docker-compose.platform.yml; standalone dev defaults to a
folder under `backend/data/` (gitignored) so nothing needs to be configured
to run the app.
"""

from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile

from .files import safe_name

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _storage_dir() -> Path:
    configured = os.environ.get("STORAGE_DIR") or os.environ.get("LOCAL_STORAGE_DIR")
    root = Path(configured) if configured else _BACKEND_DIR / "data" / "receipts"
    root.mkdir(parents=True, exist_ok=True)
    return root


def receipt_path(stored_filename: str) -> Path:
    return _storage_dir() / stored_filename


async def save_receipt(upload: UploadFile) -> tuple[str, str, str]:
    """Persist an uploaded receipt permanently.

    Returns (stored_filename, original_filename, content_type).
    """
    original_name = safe_name(upload.filename, "receipt")
    ext = Path(original_name).suffix
    stored_filename = f"{uuid.uuid4().hex}{ext}"
    target = receipt_path(stored_filename)
    with target.open("wb") as fh:
        shutil.copyfileobj(upload.file, fh)
    content_type = upload.content_type or "application/octet-stream"
    return stored_filename, original_name, content_type


def delete_receipt(stored_filename: str | None) -> None:
    if not stored_filename:
        return
    receipt_path(stored_filename).unlink(missing_ok=True)
