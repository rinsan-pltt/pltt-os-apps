"""LibreOffice (soffice) wrapper for Office <-> PDF conversions.

Word/Excel/PowerPoint to PDF needs a real layout engine; LibreOffice headless
is the standard open-source answer. We locate the binary at request time and
return a clear 424 error when it is not installed instead of failing cryptically.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi import HTTPException

logger = logging.getLogger(__name__)

_SOFFICE_CANDIDATES = (
    "soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/opt/homebrew/bin/soffice",
)


def find_soffice() -> str | None:
    for candidate in _SOFFICE_CANDIDATES:
        found = shutil.which(candidate) or (candidate if Path(candidate).is_file() else None)
        if found:
            return found
    return None


def require_soffice() -> str:
    binary = find_soffice()
    if not binary:
        raise HTTPException(
            status_code=424,
            detail=(
                "Office document conversion needs the LibreOffice (soffice) engine, which is "
                "not installed on this deployment. It is a system package baked into the server "
                "image — add `libreoffice` (Debian/Ubuntu: `apt-get install -y libreoffice`) to "
                "the deployment image. For local development on macOS, "
                "`brew install --cask libreoffice`."
            ),
        )
    return binary


def convert_with_soffice(src: Path, out_dir: Path, target_format: str = "pdf", *, infilter: "str | None" = None) -> Path:
    """Convert `src` to `target_format` into `out_dir`, returning the produced file.

    `infilter` forces the LibreOffice import filter, e.g. "impress_pdf_import" /
    "writer_pdf_import" to open a PDF in Impress/Writer so it can be re-exported
    as pptx/docx (a plain PDF otherwise loads in Draw, which has no such export
    filter)."""
    binary = require_soffice()
    # A private profile dir avoids clashes when several conversions run at once.
    with tempfile.TemporaryDirectory(prefix="soffice-profile-") as profile:
        cmd = [
            binary,
            "--headless",
            "--norestore",
            f"-env:UserInstallation=file://{profile}",
        ]
        if infilter:
            cmd.append(f"--infilter={infilter}")
        cmd += [
            "--convert-to",
            target_format,
            "--outdir",
            str(out_dir),
            str(src),
        ]
        logger.info("Converting %s to %s via LibreOffice...", src.name, target_format)
        start = time.monotonic()
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="LibreOffice conversion timed out.")
        logger.info("LibreOffice finished in %.2fs.", time.monotonic() - start)

    suffix = target_format.split(":", 1)[0]
    produced = out_dir / f"{src.stem}.{suffix}"
    if proc.returncode != 0 or not produced.exists():
        detail = (proc.stderr or proc.stdout or "unknown error").strip()[:500]
        raise HTTPException(status_code=500, detail=f"LibreOffice conversion failed: {detail}")
    return produced
