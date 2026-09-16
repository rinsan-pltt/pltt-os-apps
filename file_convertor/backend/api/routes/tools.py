"""Single dispatch endpoint for every conversion tool.

POST /api/tools/{slug} with multipart form data:
  files:              one or more uploads
  data_room_file_ids: instead of (or alongside) `files` — ids of files already
                      in the app's Data Room folders, fetched server-side
  plus any tool-specific string options declared in that Tool's `options` list

The response is the converted file, or a zip when a tool yields several files.
GET /api/tools lists the registry so the frontend stays in sync.

Every input and every output is also archived to the Data Room
(`Document Toolbox/Uploads` and `.../Results`) when the platform provides one.
That archiving can never fail a conversion — see `core/data_room.try_save_*`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import anyio
from fastapi import APIRouter, HTTPException, Request, UploadFile
from starlette.datastructures import UploadFile as StarletteUploadFile

from ..core import convert_ops, data_room, hwpx_ops, pdf_ops
from ..core.files import cleanup, new_workdir, respond_with, save_bytes, save_upload
from ..core.palette import ctx_dependency, require_permission

router = APIRouter(tags=["tools"])

PDF = {".pdf"}
WORD = {".doc", ".docx", ".odt", ".rtf"}
EXCEL = {".xls", ".xlsx", ".ods", ".csv"}
POWERPOINT = {".ppt", ".pptx", ".odp"}
IMAGES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}
TEXT = {".txt", ".md", ".log"}
HWP = hwpx_ops.HWP_EXTS  # {".hwp", ".hwpx"}


@dataclass(frozen=True)
class Tool:
    slug: str
    title: str
    accepts: set[str]
    multiple: bool
    # handler(inputs, workdir, options) -> list of output paths
    run: Callable[[list[Path], Path, dict[str, str]], list[Path]]
    zip_name: str = "converted.zip"
    options: list[str] = field(default_factory=list)


def _single(inputs: list[Path]) -> Path:
    if len(inputs) != 1:
        raise HTTPException(status_code=422, detail="This tool takes exactly one file.")
    return inputs[0]


def _pair(inputs: list[Path]) -> tuple[Path, Path]:
    if len(inputs) != 2:
        raise HTTPException(status_code=422, detail="This tool takes exactly two files.")
    return inputs[0], inputs[1]


TOOLS: dict[str, Tool] = {
    tool.slug: tool
    for tool in [
        # ---- Organize
        Tool("merge-pdf", "Merge PDF", PDF, True,
             lambda ins, wd, opts: pdf_ops.merge_pdfs(ins, wd)),
        Tool("split-pdf", "Split PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.split_pdf(_single(ins), wd, opts.get("ranges")),
             zip_name="split_pages.zip", options=["ranges"]),
        Tool("rotate-pdf", "Rotate PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.rotate_pdf(_single(ins), wd, int(opts.get("angle", "90"))),
             options=["angle"]),
        Tool("compare-pdf", "Compare PDF", PDF, True,
             lambda ins, wd, opts: pdf_ops.compare_pdfs(*_pair(ins), wd)),
        # ---- Optimize
        Tool("compress-pdf", "Compress PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.compress_pdf(_single(ins), wd, opts.get("level", "medium")),
             options=["level"]),
        Tool("repair-pdf", "Repair PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.repair_pdf(_single(ins), wd)),
        Tool("crop-pdf", "Crop PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.crop_pdf(
                 _single(ins), wd, opts.get("margins", "0,0,0,0"), rect=opts.get("rect")),
             options=["margins", "rect"]),
        Tool("pdf-to-pdfa", "PDF to PDF/A", PDF, False,
             lambda ins, wd, opts: pdf_ops.pdf_to_pdfa(_single(ins), wd)),
        # ---- Convert to PDF
        Tool("word-to-pdf", "Word to PDF", WORD, False,
             lambda ins, wd, opts: convert_ops.office_to_pdf(_single(ins), wd)),
        Tool("powerpoint-to-pdf", "PowerPoint to PDF", POWERPOINT, False,
             lambda ins, wd, opts: convert_ops.office_to_pdf(_single(ins), wd)),
        Tool("excel-to-pdf", "Excel to PDF", EXCEL, False,
             lambda ins, wd, opts: convert_ops.office_to_pdf(_single(ins), wd)),
        Tool("jpg-to-pdf", "JPG to PDF", IMAGES, True,
             lambda ins, wd, opts: convert_ops.images_to_pdf(ins, wd)),
        Tool("scan-to-pdf", "Scan to PDF", IMAGES, True,
             lambda ins, wd, opts: convert_ops.images_to_pdf(ins, wd, enhance=True)),
        Tool("text-to-pdf", "Text to PDF", TEXT, False,
             lambda ins, wd, opts: convert_ops.text_to_pdf(_single(ins), wd)),
        Tool("hwp-to-pdf", "HWP to PDF", HWP, False,
             lambda ins, wd, opts: hwpx_ops.hwp_to_pdf(_single(ins), wd)),
        # ---- Convert from PDF
        Tool("pdf-to-word", "PDF to Word", PDF, False,
             lambda ins, wd, opts: convert_ops.pdf_to_word(_single(ins), wd)),
        Tool("pdf-to-powerpoint", "PDF to PowerPoint", PDF, False,
             lambda ins, wd, opts: convert_ops.pdf_to_powerpoint(_single(ins), wd)),
        Tool("pdf-to-excel", "PDF to Excel", PDF, False,
             lambda ins, wd, opts: convert_ops.pdf_to_excel(_single(ins), wd)),
        Tool("pdf-to-jpg", "PDF to JPG", PDF, False,
             lambda ins, wd, opts: convert_ops.pdf_to_jpg(_single(ins), wd),
             zip_name="pdf_images.zip"),
        Tool("pdf-to-text", "PDF to Text", PDF, False,
             lambda ins, wd, opts: convert_ops.pdf_to_text(_single(ins), wd)),
        Tool("pdf-to-markdown", "PDF to Markdown", PDF, False,
             lambda ins, wd, opts: convert_ops.pdf_to_markdown(_single(ins), wd)),
        Tool("pdf-to-hwp", "PDF to HWPX", PDF, False,
             lambda ins, wd, opts: hwpx_ops.pdf_to_hwpx(_single(ins), wd)),
        Tool("ocr-pdf", "OCR PDF", PDF, False,
             lambda ins, wd, opts: convert_ops.ocr_pdf(_single(ins), wd, opts.get("language", "eng")),
             options=["language"]),
        # ---- Edit
        Tool("watermark-pdf", "Watermark", PDF, False,
             lambda ins, wd, opts: pdf_ops.watermark_pdf(
                 _single(ins), wd,
                 text=opts.get("text", ""),
                 position=opts.get("position", "center"),
                 opacity=int(opts.get("opacity", "35")),
                 color=opts.get("color", "#FF0000"),
                 x=opts.get("x"), y=opts.get("y"),
                 width=opts.get("width"), rotate=opts.get("rotate"),
             ),
             options=["text", "position", "opacity", "color", "x", "y", "width", "rotate"]),
        Tool("page-numbers-pdf", "Page numbers", PDF, False,
             lambda ins, wd, opts: pdf_ops.add_page_numbers(
                 _single(ins), wd,
                 position=opts.get("position", "bottom-center"),
                 start=int(opts.get("start", "1")),
                 fmt=opts.get("format", "{n}"),
             ),
             options=["position", "start", "format"]),
        Tool("redact-pdf", "Redact PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.redact_pdf(_single(ins), wd, opts.get("term", "")),
             options=["term"]),
        Tool("sign-pdf", "Sign PDF", PDF | IMAGES, True,
             lambda ins, wd, opts: pdf_ops.sign_pdf(
                 ins, wd,
                 page=opts.get("page", "last"),
                 position=opts.get("position", "bottom-right"),
                 width_pt=float(opts.get("width", "160")),
                 x=opts.get("x"), y=opts.get("y"),
             ),
             options=["page", "position", "width", "x", "y"]),
        # ---- Security
        Tool("protect-pdf", "Protect PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.protect_pdf(_single(ins), wd, opts.get("password", "")),
             options=["password"]),
        Tool("unlock-pdf", "Unlock PDF", PDF, False,
             lambda ins, wd, opts: pdf_ops.unlock_pdf(_single(ins), wd, opts.get("password", "")),
             options=["password"]),
        # ---- Images
        Tool("image-converter", "Image Converter", IMAGES, True,
             lambda ins, wd, opts: convert_ops.convert_images(ins, wd, opts.get("format", "png")),
             zip_name="converted_images.zip", options=["format"]),
        Tool("image-to-text", "Image to Text", IMAGES | {".heic", ".heif"}, True,
             lambda ins, wd, opts: convert_ops.image_to_text(
                 ins, wd, opts.get("format", "docx"), opts.get("language", "eng")),
             options=["format", "language"]),
    ]
}


@router.get("/tools", dependencies=[require_permission("resources:read")])
def list_tools() -> list[dict]:
    return [
        {
            "slug": t.slug,
            "title": t.title,
            "accepts": sorted(t.accepts),
            "multiple": t.multiple,
            "options": t.options,
        }
        for t in TOOLS.values()
    ]


@router.post("/tools/{slug}", dependencies=[require_permission("resources:write")])
async def run_tool(slug: str, request: Request, ctx: object = ctx_dependency):
    tool = TOOLS.get(slug)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Unknown tool '{slug}'.")

    # request.form() returns Starlette's UploadFile for file parts, which is a
    # different class from fastapi.UploadFile (FastAPI's own wrapper) — check
    # against both so uploads aren't silently dropped.
    form = await request.form()
    files = [v for v in form.getlist("files") if isinstance(v, (UploadFile, StarletteUploadFile))]

    # Files the user picked out of the Data Room instead of uploading. Read
    # server-side, so the browser never has to download and re-upload something
    # the platform already holds.
    room_ids: list[int] = []
    for raw in form.getlist("data_room_file_ids"):
        if isinstance(raw, (UploadFile, StarletteUploadFile)):
            continue
        for part in str(raw).split(","):
            part = part.strip()
            if not part:
                continue
            try:
                room_ids.append(int(part))
            except ValueError:
                raise HTTPException(status_code=422, detail=f"'{part}' is not a file id.")

    if not files and not room_ids:
        raise HTTPException(status_code=422, detail="No files uploaded.")
    total = len(files) + len(room_ids)
    if not tool.multiple and total > 1:
        raise HTTPException(status_code=422, detail=f"{tool.title} takes a single file.")

    # Every non-file field is passed through as a string option — new tools
    # only need a `Tool(...)` entry here, never an endpoint signature change.
    options = {
        key: str(value)
        for key, value in form.multi_items()
        if key not in ("files", "data_room_file_ids")
        and not isinstance(value, (UploadFile, StarletteUploadFile))
        and str(value) != ""
    }

    workdir = new_workdir()
    try:
        inputs = [await save_upload(f, workdir, tool.accepts) for f in files]

        for file_id in room_ids:
            try:
                name, content = await data_room.read_file(ctx, file_id)
            except data_room.DataRoomUnavailable as exc:
                raise HTTPException(status_code=424, detail=str(exc))
            except LookupError as exc:
                raise HTTPException(status_code=404, detail=str(exc))
            inputs.append(save_bytes(workdir, name, content, tool.accepts))

        # Archive the inputs before the conversion runs: if a tool crashes on a
        # particular document, the document that caused it is what you want in
        # the room.
        for path in inputs:
            await data_room.try_save_upload(ctx, path.name, path.read_bytes())

        # Conversions are CPU/subprocess-bound — keep the event loop free.
        outputs = await anyio.to_thread.run_sync(tool.run, inputs, workdir, options)
        # `tool.title`, not the slug: the folder is read by a person browsing
        # the room, so it gets the name they saw on the tool they ran.
        for path in outputs:
            await data_room.try_save_result(ctx, path.name, path.read_bytes(), tool=tool.title)
        return respond_with(workdir, outputs, tool.zip_name)
    except HTTPException:
        cleanup(workdir)
        raise
    except ImportError as exc:
        # Conversion libraries are imported lazily so a missing wheel on the
        # host only fails the one tool that needs it, never route loading.
        cleanup(workdir)
        raise HTTPException(
            status_code=424,
            detail=f"{tool.title} is unavailable on this deployment (missing dependency: {exc}).",
        )
    except Exception as exc:  # noqa: BLE001 — last-resort guard, always release the workdir
        cleanup(workdir)
        raise HTTPException(status_code=500, detail=f"Conversion failed: {exc}")
