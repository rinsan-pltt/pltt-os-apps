"""Receipt text extraction + best-effort field parsing.

PDF receipts always extract text (via pymupdf — no external binary needed).
Image receipts need OCR, which wraps the system `tesseract` binary through
`pytesseract`; when that binary isn't installed the import is caught and
image scans just return no extracted text, so the user fills the form in by
hand instead of the request failing (same "degrade gracefully when an
optional dependency is missing" approach as the reference file-convertor
plugin uses for pdf2docx).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

from dateutil import parser as date_parser

from .categories import default_category_dicts
from .categorize import llm_classify_one
from .extraction import detect_currency_in_text, llm_extract_receipt_fields

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}
PDF_EXTS = {".pdf"}
SUPPORTED_EXTS = IMAGE_EXTS | PDF_EXTS

try:
    import pytesseract
    from PIL import Image

    # Confirms the tesseract *binary* is actually on PATH, not just the
    # pytesseract Python wrapper — importing pytesseract always succeeds even
    # when the binary is missing; the failure only shows up on first call.
    pytesseract.get_tesseract_version()
    OCR_AVAILABLE = True
except Exception:  # noqa: BLE001 — ImportError, or pytesseract.TesseractNotFoundError
    OCR_AVAILABLE = False


def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in PDF_EXTS:
        return _extract_pdf_text(path)
    if ext in IMAGE_EXTS:
        return _extract_image_text(path)
    return ""


def _extract_pdf_text(path: Path) -> str:
    import fitz

    try:
        doc = fitz.open(str(path))
    except Exception:  # noqa: BLE001 — corrupt/unreadable PDF
        return ""
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


def _ocr_langs() -> str:
    """Use whatever language packs are installed, so non-Latin receipts (e.g.
    Korean) still OCR when the `kor` traineddata is present. Falls back to
    plain English — the vision LLM reads the image directly regardless."""
    langs = ["eng"]
    try:
        available = set(pytesseract.get_languages(config=""))
    except Exception:  # noqa: BLE001 — older pytesseract / tesseract without the query
        available = set()
    for lang in ("kor", "jpn", "chi_sim"):
        if lang in available:
            langs.append(lang)
    return "+".join(langs)


def _extract_image_text(path: Path) -> str:
    if not OCR_AVAILABLE:
        return ""
    try:
        with Image.open(path) as image:
            return pytesseract.image_to_string(image, lang=_ocr_langs())
    except Exception:  # noqa: BLE001 — unreadable image, OCR failure, etc.
        return ""


def load_receipt_image(path: Path, *, max_dim: int = 1600) -> tuple[bytes, str] | None:
    """Render the receipt to a PNG the vision LLM can read directly.

    Currency symbols (₹, etc.) and other glyphs are routinely lost or mangled
    by PDF/OCR *text* extraction — pymupdf turns ₹ into "·", tesseract may drop
    it entirely — so text alone can't tell us the document's currency. Handing
    the model the actual image lets it read the real symbol. PDFs render their
    first page; images are downscaled and re-encoded. Returns (png_bytes,
    mime) or None if the file can't be rasterised."""
    ext = path.suffix.lower()
    try:
        if ext in PDF_EXTS:
            import fitz

            doc = fitz.open(str(path))
            try:
                if doc.page_count == 0:
                    return None
                pix = doc.load_page(0).get_pixmap(dpi=150)
                return pix.tobytes("png"), "image/png"
            finally:
                doc.close()
        if ext in IMAGE_EXTS:
            import io

            from PIL import Image as _Image

            with _Image.open(path) as image:
                image = image.convert("RGB")
                image.thumbnail((max_dim, max_dim))
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                return buffer.getvalue(), "image/png"
    except Exception:  # noqa: BLE001 — unreadable/corrupt file; skip vision
        return None
    return None


# "Total" (or similar) followed by a currency amount is the strongest signal
# on a receipt; only fall back to "largest dollar amount on the page" below.
_AMOUNT_LINE = re.compile(
    r"(?:grand\s+total|amount\s+due|balance\s+due|total\s+due|total)\s*[:\-]?\s*\$?\s*"
    r"([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})?)",
    re.IGNORECASE,
)
_ANY_MONEY = re.compile(r"\$\s?([0-9]{1,3}(?:[,\s][0-9]{3})*\.[0-9]{2})|(?<!\d)([0-9]{1,3}(?:[,\s][0-9]{3})*\.[0-9]{2})(?!\d)")

_DATE_CANDIDATE = re.compile(
    r"(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}|"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})",
    re.IGNORECASE,
)


def _to_float(raw: str) -> float | None:
    try:
        return float(raw.replace(",", "").replace(" ", ""))
    except ValueError:
        return None


def _parse_amount(text: str) -> float | None:
    match = _AMOUNT_LINE.search(text)
    if match:
        value = _to_float(match.group(1))
        if value is not None:
            return value
    candidates = [
        value
        for m in _ANY_MONEY.finditer(text)
        if (value := _to_float(m.group(1) or m.group(2))) is not None
    ]
    return max(candidates) if candidates else None


def _parse_date(text: str) -> date | None:
    for match in _DATE_CANDIDATE.finditer(text):
        try:
            parsed = date_parser.parse(match.group(1), fuzzy=True, default=datetime(1900, 1, 1))
        except (ValueError, OverflowError):
            continue
        if parsed.year == 1900:
            continue  # dateutil couldn't find a real year — unreliable match
        return parsed.date()
    return None


def _parse_vendor(text: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if len(stripped) >= 3 and not stripped.isdigit():
            return stripped[:80]
    return None


def parse_receipt(
    text: str,
    api_key: str | None = None,
    image: tuple[bytes, str] | None = None,
    categories: list[dict] | None = None,
) -> dict:
    """Best-effort structured fields from raw receipt text — the caller
    always lets the user review/edit these before saving an expense.

    The regex heuristics below always run first and work with no LLM
    configured at all. When `api_key` is set, the LLM gets a chance to fill
    in fields those heuristics missed or extract them more accurately from a
    less-structured document (e.g. a multi-line invoice) — but only a value
    that's been checked against the actual document text (see
    `extraction.py`) is ever allowed to override the heuristic result.

    When `image` (png_bytes, mime) is supplied the model also *sees* the
    document, so it can read glyphs like the currency symbol that PDF/OCR text
    extraction garbles; a currency read from the image is trusted directly.
    """
    vendor = _parse_vendor(text)
    amount = _parse_amount(text)
    heuristic_date = _parse_date(text)
    expense_date_iso = heuristic_date.isoformat() if heuristic_date else None
    currency = detect_currency_in_text(text)

    llm_assisted = False
    if api_key:
        validated = llm_extract_receipt_fields(text, api_key, image=image)
        if validated:
            llm_assisted = True
            vendor = validated.get("vendor", vendor)
            amount = validated.get("amount", amount)
            expense_date_iso = validated.get("expense_date", expense_date_iso)
            currency = validated.get("currency", currency)

    # Categorize with the LLM against the org's current categories; with no key
    # this falls back to keyword matching over the same set.
    cats = categories if categories else default_category_dicts()
    category = llm_classify_one(f"{vendor or ''} {text[:400]}", cats, api_key)

    return {
        "vendor": vendor,
        "amount": amount,
        "currency": currency,
        "expense_date": expense_date_iso,
        "category": category,
        "raw_text_preview": text.strip()[:800],
        "ocr_available": OCR_AVAILABLE,
        "llm_assisted": llm_assisted,
    }
