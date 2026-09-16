"""Temp-file workspace helpers shared by every tool endpoint.

Each request gets an isolated working directory. Results are streamed back
with FileResponse and the whole directory is removed afterwards via a
BackgroundTask, so nothing accumulates on disk.
"""

from __future__ import annotations

import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB per file

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def new_workdir() -> Path:
    return Path(tempfile.mkdtemp(prefix="fileconv-"))


def cleanup(workdir: Path) -> None:
    shutil.rmtree(workdir, ignore_errors=True)


def safe_name(filename: str | None, fallback: str = "file") -> str:
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
            detail=f"'{name}' can't be used here — this tool works with: {', '.join(sorted(allowed_exts))}.",
        )
    dest = workdir / "in"
    dest.mkdir(exist_ok=True)
    target = dest / name
    # Avoid clobbering when two uploads share a name.
    counter = 1
    while target.exists():
        target = dest / f"{Path(name).stem}_{counter}{Path(name).suffix}"
        counter += 1

    size = 0
    with target.open("wb") as fh:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="File exceeds the 100 MB limit.")
            fh.write(chunk)
    if size == 0:
        raise HTTPException(status_code=422, detail=f"Uploaded file '{name}' is empty.")
    return target


def save_bytes(
    workdir: Path,
    filename: str | None,
    content: bytes,
    allowed_exts: set[str] | None = None,
) -> Path:
    """`save_upload` for content the server already holds.

    Used for Data Room files, which arrive as bytes from
    `ctx.data_rooms.read_file_bytes` rather than as a multipart part. It applies
    exactly the same rules — extension allow-list, name sanitising, collision
    suffixing, size cap, empty-file rejection — because a file chosen from the
    Data Room must be accepted or refused on the same terms as one uploaded
    from disk. Diverging here would mean a tool accepting a document through one
    door that it rejects through the other.
    """
    name = safe_name(filename)
    ext = Path(name).suffix.lower()
    if allowed_exts is not None and ext not in allowed_exts:
        raise HTTPException(
            status_code=422,
            detail=f"'{name}' can't be used here — this tool works with: {', '.join(sorted(allowed_exts))}.",
        )
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 100 MB limit.")
    if not content:
        raise HTTPException(status_code=422, detail=f"Uploaded file '{name}' is empty.")

    dest = workdir / "in"
    dest.mkdir(exist_ok=True)
    target = dest / name
    counter = 1
    while target.exists():
        target = dest / f"{Path(name).stem}_{counter}{Path(name).suffix}"
        counter += 1
    target.write_bytes(content)
    return target


def output_dir(workdir: Path) -> Path:
    out = workdir / "out"
    out.mkdir(exist_ok=True)
    return out


MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".html": "text/html",
    ".md": "text/markdown",
}


def respond_with(workdir: Path, outputs: list[Path], zip_name: str = "converted.zip") -> FileResponse:
    """Return one file directly, or zip multiple outputs into a single download."""
    if not outputs:
        cleanup(workdir)
        raise HTTPException(status_code=500, detail="Conversion produced no output.")

    if len(outputs) == 1:
        result = outputs[0]
    else:
        result = workdir / safe_name(zip_name, "converted.zip")
        with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in outputs:
                zf.write(path, arcname=path.name)

    media_type = MEDIA_TYPES.get(result.suffix.lower(), "application/octet-stream")
    return FileResponse(
        path=result,
        media_type=media_type,
        filename=result.name,
        background=BackgroundTask(cleanup, workdir),
        # The frontend (:7321) and backend (:8732) are different origins under
        # `pltt dev`, and browsers hide Content-Disposition from JS on
        # cross-origin responses unless it's explicitly exposed — neither the
        # platform's CORS middleware nor ours does this by default. Without
        # it, `resp.headers.get("content-disposition")` silently returns null
        # in the real app (curl doesn't enforce CORS, so this was invisible to
        # curl-based testing), the frontend falls back to an extension-less
        # filename, and any tool consuming that file straight from a Workflow
        # rejects it as "unsupported" — this is what actually fixes that.
        headers={"Access-Control-Expose-Headers": "Content-Disposition"},
    )
