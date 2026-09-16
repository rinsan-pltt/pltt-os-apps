"""Bulk import: parse a spreadsheet (.xlsx/.xls/.csv) or a PDF bank/credit-card
statement into draft expense rows for review before saving. Complements
`ocr.py`, which reads a single scanned receipt (one file → one expense)
instead of many transaction rows at once."""

from __future__ import annotations

import csv
import re
from datetime import date, datetime
from pathlib import Path

from dateutil import parser as date_parser

from .categories import guess_category
from .extraction import detect_currency_in_text, llm_currency_from_image, llm_extract_statement_rows
from .ocr import load_receipt_image

SPREADSHEET_EXTS = {".xlsx", ".xls", ".csv"}
STATEMENT_PDF_EXTS = {".pdf"}
SUPPORTED_IMPORT_EXTS = SPREADSHEET_EXTS | STATEMENT_PDF_EXTS

# Common column header spellings across bank/card exports and expense sheets.
_HEADER_ALIASES: dict[str, set[str]] = {
    "date": {"date", "transaction date", "posted date", "expense date", "trans date"},
    "vendor": {"vendor", "merchant", "description", "payee", "name", "details"},
    "amount": {"amount", "total", "charge", "debit", "price", "amount ($)"},
    "currency": {"currency", "curr", "ccy", "currency code"},
    "category": {"category", "type"},
    "notes": {"notes", "memo", "note"},
}

# Currency symbols stripped from amount cells before parsing a number, so
# "₹1,200" / "$12.34" / "€9,50" all yield a plain figure regardless of locale.
_CURRENCY_CHARS = "$₹£€¥₩"


def _match_header(header: str) -> str | None:
    normalized = header.strip().lower()
    for field, aliases in _HEADER_ALIASES.items():
        if normalized in aliases:
            return field
    return None


def _to_amount(raw: object) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    for ch in _CURRENCY_CHARS:
        text = text.replace(ch, "")
    text = text.replace(",", "").strip()
    if not text:
        return None
    text = text.strip("()")  # accounting-style negatives, e.g. "(12.34)"
    try:
        return abs(float(text))
    except ValueError:
        return None


def _normalize_currency(raw: object) -> str | None:
    """An explicit ISO code in a currency cell, else a symbol/word detected in
    the cell text (e.g. '₹1,200' → INR). None when nothing recognisable."""
    if raw is None:
        return None
    stripped = str(raw).strip().upper()
    if re.fullmatch(r"[A-Z]{3}", stripped):
        return stripped
    return detect_currency_in_text(str(raw))


def _to_date(raw: object) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    text = str(raw).strip()
    if not text:
        return None
    try:
        return date_parser.parse(text, fuzzy=True).date()
    except (ValueError, OverflowError):
        return None


def _row_to_draft(
    mapping: dict[str, int], row: list, row_number: int, categories: list[dict] | None
) -> dict | None:
    def cell(field: str):
        idx = mapping.get(field)
        return row[idx] if idx is not None and idx < len(row) else None

    vendor = str(cell("vendor") or "").strip()
    amount = _to_amount(cell("amount"))
    if not vendor and amount is None:
        return None  # blank/separator row

    expense_date = _to_date(cell("date"))
    raw_category = cell("category")
    category = str(raw_category).strip().lower() if raw_category else ""
    # Prefer an explicit currency column; otherwise read a symbol off the
    # amount cell (e.g. "₹1,200"). None here means "let the user's/commit
    # default apply".
    currency = _normalize_currency(cell("currency")) or _normalize_currency(cell("amount"))

    return {
        "row": row_number,
        "vendor": vendor or "Unknown vendor",
        "amount": amount,
        "currency": currency,
        "expense_date": expense_date.isoformat() if expense_date else None,
        "category": category or guess_category(vendor, categories),
        "notes": str(cell("notes") or "").strip() or None,
        "valid": bool(vendor) and amount is not None and expense_date is not None,
    }


def parse_spreadsheet(path: Path, categories: list[dict] | None = None) -> list[dict]:
    ext = path.suffix.lower()
    if ext == ".csv":
        with path.open(newline="", encoding="utf-8-sig", errors="replace") as fh:
            rows = list(csv.reader(fh))
    else:
        import openpyxl

        workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
        try:
            sheet = workbook.worksheets[0]
            rows = [list(r) for r in sheet.iter_rows(values_only=True)]
        finally:
            workbook.close()

    if not rows:
        return []

    header = [str(c or "") for c in rows[0]]
    mapping: dict[str, int] = {}
    for idx, col in enumerate(header):
        field = _match_header(col)
        if field and field not in mapping:
            mapping[field] = idx

    if "vendor" not in mapping or "amount" not in mapping:
        raise ValueError(
            "Could not find a vendor/description column and an amount column — expected "
            "headers like 'Date', 'Vendor' or 'Description', and 'Amount'."
        )

    drafts = []
    for row_number, raw_row in enumerate(rows[1:], start=2):
        draft = _row_to_draft(mapping, list(raw_row), row_number, categories)
        if draft:
            drafts.append(draft)
    return drafts


# A statement line that looks like "MM/DD/YYYY  Some Merchant Name   12.34" —
# best-effort, same "let the user review it" philosophy as receipt OCR: bank
# statement PDF layouts vary too widely to parse perfectly from raw text.
_STATEMENT_LINE = re.compile(
    r"^(?P<date>\d{1,2}[/\-]\d{1,2}(?:[/\-]\d{2,4})?)\s+"
    r"(?P<vendor>.+?)\s+"
    r"-?[$₹£€¥₩]?\s*\(?(?P<amount>[0-9][0-9,]*(?:\.[0-9]{2})?)\)?\s*$"
)


def _parse_statement_lines(
    text: str, currency: str | None = None, categories: list[dict] | None = None
) -> list[dict]:
    drafts = []
    for row_number, line in enumerate(text.splitlines(), start=1):
        match = _STATEMENT_LINE.match(line.strip())
        if not match:
            continue
        vendor = match.group("vendor").strip()
        amount = _to_amount(match.group("amount"))
        expense_date = _to_date(match.group("date"))
        if not vendor or amount is None:
            continue
        drafts.append(
            {
                "row": row_number,
                "vendor": vendor,
                "amount": amount,
                "currency": currency,
                "expense_date": expense_date.isoformat() if expense_date else None,
                "category": guess_category(vendor, categories),
                "notes": None,
                "valid": bool(vendor) and amount is not None and expense_date is not None,
            }
        )
    return drafts


def parse_statement_pdf(
    path: Path, api_key: str | None = None, categories: list[dict] | None = None
) -> list[dict]:
    """Statement PDFs vary wildly in layout, far more than a single receipt
    does, so the regex line parser (`_STATEMENT_LINE`) below is a rough
    baseline at best. When `api_key` is set, the LLM gets first crack at
    reading every transaction row — but only rows whose vendor, date and
    amount all independently verify against the raw extracted text (see
    `extraction.llm_extract_statement_rows`) are accepted; otherwise this
    falls back to the regex baseline, same as `ocr.parse_receipt`."""
    import fitz

    doc = fitz.open(str(path))
    try:
        text = "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()

    # A statement is a single-currency document, but the currency mark (₹, ₩)
    # is often a symbol that PDF text extraction drops. Detect it from the text
    # first, then fall back to reading it off a rendered page image with the
    # vision model — same reliable path the single-receipt scanner uses.
    currency = detect_currency_in_text(text)
    if currency is None and api_key:
        image = load_receipt_image(path)
        if image is not None:
            currency = llm_currency_from_image(image, api_key)

    if api_key:
        llm_rows = llm_extract_statement_rows(text, api_key)
        if llm_rows:
            return [
                {
                    "row": i,
                    "vendor": row["vendor"],
                    "amount": row["amount"],
                    "currency": row.get("currency") or currency,
                    "expense_date": row["expense_date"],
                    "category": guess_category(row["vendor"], categories),
                    "notes": None,
                    "valid": True,
                }
                for i, row in enumerate(llm_rows, start=1)
            ]

    return _parse_statement_lines(text, currency, categories)


def parse_import_file(
    path: Path, api_key: str | None = None, categories: list[dict] | None = None
) -> list[dict]:
    ext = path.suffix.lower()
    if ext in SPREADSHEET_EXTS:
        return parse_spreadsheet(path, categories)
    if ext in STATEMENT_PDF_EXTS:
        return parse_statement_pdf(path, api_key=api_key, categories=categories)
    raise ValueError(f"Unsupported import file type '{ext}'.")
