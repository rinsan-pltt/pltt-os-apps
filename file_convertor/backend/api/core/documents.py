"""Any document in, a PDF out — the front door of the document-wide tools.

Merge, Split, Rotate, Watermark and the rest work on pages, and pages are a
PDF's. Rather than teach every one of them Word, PowerPoint, Excel, Hancom and
plain text, the dispatcher converts those inputs to PDF first with the same
converters the "X to PDF" tools use, and hands the tool a PDF. The result is
therefore always a PDF, whatever went in.

Tools that are strictly about the PDF file itself (Compress, Repair, OCR, the
PDF-to-Office converters) keep accepting `.pdf` only and never come through
here. Protect and Unlock are the odd ones out: they hand Word, Excel and
PowerPoint back in their own format where the encryption allows it — see
`protect_document` and `unlock_document` below.
"""

from __future__ import annotations

from pathlib import Path

from . import convert_ops, hwpx_ops

PDF_EXTS = {".pdf"}
OFFICE_EXTS = {
    ".doc", ".docx", ".odt", ".rtf",
    ".xls", ".xlsx", ".xlsm", ".ods", ".csv",
    ".ppt", ".pptx", ".odp",
}
TEXT_EXTS = {".txt", ".md", ".log"}
HWP_EXTS = hwpx_ops.HWP_EXTS  # {".hwp", ".hwpx"}

#: Everything a document-wide tool accepts: PDF plus what converts to it.
DOCUMENT_EXTS = PDF_EXTS | OFFICE_EXTS | TEXT_EXTS | HWP_EXTS


def ensure_pdf(src: Path, workdir: Path) -> Path:
    """`src` itself when it is already a PDF (or not a document at all — a
    signature image rides along untouched), otherwise a PDF rendering of it.

    Each conversion gets its own scratch folder under `workdir`, so its output
    can never be mistaken for the tool's own output or collide with a second
    input of the same name.
    """
    ext = src.suffix.lower()
    if ext in PDF_EXTS or ext not in DOCUMENT_EXTS:
        return src
    scratch = workdir / f"as_pdf_{src.stem}_{abs(hash(src)) % 10**8}"
    scratch.mkdir(parents=True, exist_ok=True)
    if ext in HWP_EXTS:
        produced = hwpx_ops.hwp_to_pdf(src, scratch)
    elif ext in TEXT_EXTS:
        produced = convert_ops.text_to_pdf(src, scratch)
    else:
        produced = convert_ops.office_to_pdf(src, scratch)
    return produced[0]


def ensure_pdfs(inputs: list[Path], workdir: Path) -> list[Path]:
    return [ensure_pdf(path, workdir) for path in inputs]


# ----------------------------------------------------------------- Protect
#: Formats that can be password-protected IN PLACE. msoffcrypto-tool writes
#: ECMA-376 Agile encryption — what Word, Excel and PowerPoint themselves use —
#: but only for the OOXML formats; it cannot encrypt legacy .doc/.xls/.ppt, and
#: nothing can encrypt Hancom, OpenDocument or text. Those become a locked PDF.
PROTECTABLE_OFFICE_EXTS = {".docx", ".xlsx", ".xlsm", ".pptx"}


def protect_document(src: Path, workdir: Path, password: str) -> list[Path]:
    """Password-protect a document, keeping its format where that is possible.

    A .docx comes back as a .docx that Word asks the password for; a PDF stays
    a PDF; anything else is rendered to PDF and locked, as before.
    """
    from fastapi import HTTPException

    from . import pdf_ops
    from .files import output_dir

    pdf_ops.check_new_password(password)
    ext = src.suffix.lower()
    if ext not in PROTECTABLE_OFFICE_EXTS:
        return pdf_ops.protect_pdf(ensure_pdf(src, workdir), workdir, password)

    import msoffcrypto  # lazy: a host without it fails this tool only (424)
    import msoffcrypto.format.ooxml

    out = output_dir(workdir) / f"{src.stem}_protected{ext}"
    with src.open("rb") as fh:
        try:
            office = msoffcrypto.OfficeFile(fh)
            already = office.is_encrypted()
        except Exception as exc:  # noqa: BLE001 — not an Office container at all
            raise HTTPException(status_code=422, detail=f"'{src.name}' could not be read ({exc}).")
        if already:
            raise HTTPException(
                status_code=422,
                detail=f"'{src.name}' already has a password. Unlock it first to set a new one.",
            )
        fh.seek(0)
        try:
            with out.open("wb") as target:
                msoffcrypto.format.ooxml.OOXMLFile(fh).encrypt(password, target)
        except Exception as exc:  # noqa: BLE001 — damaged package
            out.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail=f"Could not protect '{src.name}' ({exc}).")
    return [out]


# ------------------------------------------------------------------ Unlock
#: Formats whose open-password can actually be removed. Microsoft Office
#: encrypts with a published scheme that msoffcrypto-tool reverses; Hancom and
#: OpenDocument encryption have no such library, and plain text has no password
#: at all — so Unlock takes exactly these and nothing it would only fail on.
UNLOCKABLE_OFFICE_EXTS = {".docx", ".doc", ".xlsx", ".xlsm", ".xls", ".pptx", ".ppt"}
UNLOCKABLE_EXTS = PDF_EXTS | UNLOCKABLE_OFFICE_EXTS


def unlock_document(src: Path, workdir: Path, password: str) -> list[Path]:
    """Remove the open-password from a PDF or a Word/Excel/PowerPoint file.

    Unlike the document-wide tools this keeps the format: an unlocked .docx
    comes back as a .docx, because the point is to get the user's own file
    back, not a PDF of it.
    """
    from fastapi import HTTPException

    from . import pdf_ops
    from .files import output_dir

    ext = src.suffix.lower()
    if ext in PDF_EXTS:
        return pdf_ops.unlock_pdf(src, workdir, password)
    if ext not in UNLOCKABLE_OFFICE_EXTS:
        raise HTTPException(status_code=422, detail=f"'{src.name}' can't be unlocked here.")

    import msoffcrypto  # lazy: a host without it fails this tool only (424)
    from msoffcrypto.exceptions import InvalidKeyError

    out = output_dir(workdir) / f"{src.stem}_unlocked{ext}"
    with src.open("rb") as fh:
        try:
            office = msoffcrypto.OfficeFile(fh)
            encrypted = office.is_encrypted()
        except Exception as exc:  # noqa: BLE001 — not an Office container at all
            raise HTTPException(status_code=422, detail=f"'{src.name}' could not be read ({exc}).")
        if not encrypted:
            raise HTTPException(
                status_code=422,
                detail=f"'{src.name}' isn't password-protected — there is nothing to unlock.",
            )
        try:
            office.load_key(password=password or "")
            with out.open("wb") as target:
                office.decrypt(target)
        except InvalidKeyError:
            out.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail=f"Wrong password for '{src.name}'.")
        except Exception as exc:  # noqa: BLE001 — unsupported cipher, damaged file
            out.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail=f"Could not unlock '{src.name}' ({exc}).")
    return [out]
