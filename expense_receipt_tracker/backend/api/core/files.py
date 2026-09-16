"""Temp-file workspace helpers for ephemeral uploads (receipt scanning).

`POST /receipts/scan` only needs to *read* an uploaded receipt to extract
text — it never keeps the file. Each request gets an isolated temp dir that
is removed right after the response, same approach as the reference
file-convertor plugin's tool endpoints.
"""

from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path

from fastapi import HTTPException, UploadFile

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB — receipts are small photos/PDFs

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def new_workdir() -> Path:
    return Path(tempfile.mkdtemp(prefix="expense-receipt-"))


def cleanup(workdir: Path) -> None:
    shutil.rmtree(workdir, ignore_errors=True)


def safe_name(filename: str | None, fallback: str = "receipt") -> str:
    name = Path(filename or fallback).name
    name = _SAFE_NAME.sub("_", name).strip() or fallback
    return name


async def save_upload(upload: UploadFile, workdir: Path, allowed_exts: set[str] | None = None) -> Path:
    """Persist one UploadFile into the working dir and validate its extension."""
    name = safe_name(upload.filename)
    ext = Path(name).suffix.lower()
    if allowed_exts is not None and ext not in allowed_exts:
        raise HTTPException(
            status_code=422,
            detail=f"'{name}' can't be used here — accepted types: {', '.join(sorted(allowed_exts))}.",
        )
    target = workdir / name
    size = 0
    with target.open("wb") as fh:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Receipt file exceeds the 25 MB limit.")
            fh.write(chunk)
    if size == 0:
        raise HTTPException(status_code=422, detail=f"Uploaded file '{name}' is empty.")
    return target
