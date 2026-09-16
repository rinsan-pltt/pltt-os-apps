"""POST /receipts/scan — read an uploaded receipt and draft expense fields.

Ephemeral only: the file is analyzed and discarded. The frontend shows the
draft for the user to review/correct, then re-submits the same file to
`POST /expenses` to actually save it (see lib/api.ts on the frontend).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, UploadFile

from ..core.category_store import category_dicts
from ..core.files import cleanup, new_workdir, save_upload
from ..core.ocr import SUPPORTED_EXTS, extract_text, load_receipt_image, parse_receipt
from ..core.palette import ctx_dependency, require_permission
from ..core.secrets import read_secret

router = APIRouter(tags=["receipts"])


@router.post("/receipts/scan", dependencies=[require_permission("resources:write")])
async def scan_receipt(file: UploadFile = File(...), ctx: Any = ctx_dependency) -> dict:
    # OPENAI_KEY is optional (see palette-plugin.json) — with none configured
    # this is just the regex heuristics in ocr.py, no LLM call happens at all.
    api_key = read_secret(ctx, "OPENAI_KEY") or None
    categories = await category_dicts(ctx)
    workdir = new_workdir()
    try:
        saved = await save_upload(file, workdir, allowed_exts=SUPPORTED_EXTS)
        text = extract_text(saved)
        # Only rasterise for vision when an LLM is configured to read it —
        # the model sees the real currency symbol that text extraction garbles.
        image = load_receipt_image(saved) if api_key else None
        return parse_receipt(text, api_key=api_key, image=image, categories=categories)
    finally:
        cleanup(workdir)
