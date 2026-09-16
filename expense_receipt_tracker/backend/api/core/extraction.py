"""Optional LLM-assisted field extraction for receipts, invoices, and
statements.

Grounding policy depends on what the model was actually shown:

* **Text only** (no image, or statement parsing): every value the model
  returns is checked against the actual source text before it's used. A value
  that isn't present — a currency the model added on its own, a total that
  appears nowhere in the text, a date it invented — is discarded, not
  "corrected".
* **Image attached** (single-receipt scan with a rasterised document): the
  image *is* the source document, so the model's reading of it is trusted
  after light format/sanity checks. Verifying against the extracted text would
  be actively wrong here — that text is a noisy OCR/PDF aid that routinely
  drops currency glyphs (₹, ₩) and can't represent non-Latin scripts (Korean,
  etc.) at all, so grounding against it would throw away correct readings.

Callers (`ocr.py`, `imports.py`) always have the regex-based heuristics as a
baseline that works with no LLM configured at all.
"""

from __future__ import annotations

import base64
import difflib
import json
import re
from datetime import date

from .llm import call_openai

_RECEIPT_MAX_CHARS = 6_000
_STATEMENT_MAX_CHARS = 16_000

# Decimals are optional so integer-only amounts ground too — Korean won and
# Japanese yen are written without a fractional part (e.g. "12,000").
_NUM_TOKEN = re.compile(r"[0-9][0-9,]*(?:\.[0-9]{1,2})?")


def _looks_like_iso_date(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _amount_in_text(amount: object, text: str) -> bool:
    if not isinstance(amount, (int, float)):
        return False
    for match in _NUM_TOKEN.finditer(text):
        try:
            if abs(float(match.group(0).replace(",", "")) - float(amount)) < 0.005:
                return True
        except ValueError:
            continue
    return False


def _date_variants(d: date) -> set[str]:
    variants = {
        d.strftime("%m/%d/%Y"), d.strftime("%m/%d/%y"), d.strftime("%m-%d-%Y"),
        d.strftime("%d/%m/%Y"), d.strftime("%Y-%m-%d"), d.strftime("%Y/%m/%d"),
        # Day-first with dash or dot separators — the common formats on Indian
        # and European bills (e.g. "15-03-2026", "15.03.2026"). Without these
        # the grounding check rejected a correctly-read bill date, and the draft
        # fell back to today's date.
        d.strftime("%d-%m-%Y"), d.strftime("%d-%m-%y"),
        d.strftime("%d.%m.%Y"), d.strftime("%d.%m.%y"),
        d.strftime("%m.%d.%Y"), d.strftime("%Y.%m.%d"),
        d.strftime("%B %d, %Y"), d.strftime("%b %d, %Y"), d.strftime("%b %d %Y"),
        d.strftime("%B %d %Y"), d.strftime("%d %B %Y"), d.strftime("%d %b %Y"),
        # Korean (and similar CJK) year/month/day form, e.g. "2026년 03월 15일".
        d.strftime("%Y년 %m월 %d일"),
    }
    # Also accept the same formats without leading zeros, e.g. "1/5/2024".
    variants |= {re.sub(r"(?<=[/\-.\s])0(?=\d)", "", v) for v in list(variants)}
    return variants


def _date_in_text(iso_date: object, text: str) -> bool:
    if not isinstance(iso_date, str) or not iso_date:
        return False
    try:
        d = date.fromisoformat(iso_date)
    except ValueError:
        return False
    lowered = text.lower()
    return any(variant.lower() in lowered for variant in _date_variants(d))


# Symbols and words that unambiguously indicate a currency in receipt text,
# mapped to their ISO 4217 code. Shared by the heuristic (ocr.py) and the
# grounding check below so the LLM can't relabel a rupee bill as dollars.
CURRENCY_SYMBOLS = {
    "₹": "INR", "£": "GBP", "€": "EUR", "¥": "JPY", "₩": "KRW",
}
CURRENCY_WORDS = {
    "inr": "INR", "rs": "INR", "rs.": "INR", "inr.": "INR",
    "rupee": "INR", "rupees": "INR",
    "usd": "USD", "us$": "USD", "dollar": "USD", "dollars": "USD",
    "gbp": "GBP", "pound": "GBP", "pounds": "GBP", "sterling": "GBP",
    "eur": "EUR", "euro": "EUR", "euros": "EUR",
    "jpy": "JPY", "yen": "JPY",
    "aud": "AUD", "cad": "CAD", "sgd": "SGD", "aed": "AED", "chf": "CHF",
    "cny": "CNY", "rmb": "CNY", "yuan": "CNY", "krw": "KRW", "won": "KRW",
    "원": "KRW", "엔": "JPY",
}


def detect_currency_in_text(text: str) -> str | None:
    """Best-effort ISO currency code from raw document text, using the currency
    words/symbols above. A currency word or explicit code (INR, Rupees, ₹) wins
    over a bare symbol; `$` is deliberately not treated as a currency here since
    it's ambiguous across USD/CAD/AUD/etc. Returns None when nothing matches."""
    lowered = text.lower()
    for word, code in CURRENCY_WORDS.items():
        if re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", lowered):
            return code
    for symbol, code in CURRENCY_SYMBOLS.items():
        if symbol in text:
            return code
    return None


def _currency_in_text(code: object, text: str) -> bool:
    """True when `code` is actually evidenced in the document — its ISO code,
    a currency word, or a symbol that maps to it appears in the text. Keeps the
    LLM from labelling, say, a ₹ receipt as USD."""
    if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z]{3}", code.strip()):
        return False
    code = code.strip().upper()
    lowered = text.lower()
    if re.search(rf"\b{code.lower()}\b", lowered):
        return True
    if any(sym in text for sym, c in CURRENCY_SYMBOLS.items() if c == code):
        return True
    return any(
        re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", lowered)
        for word, c in CURRENCY_WORDS.items()
        if c == code
    )


def _vendor_in_text(vendor: object, text: str) -> bool:
    if not isinstance(vendor, str) or not vendor.strip():
        return False
    needle = vendor.strip().lower()
    haystack = text.lower()
    if needle in haystack:
        return True
    # OCR/PDF extraction can mangle a line slightly (spacing, stray glyphs) —
    # a high-similarity match against some line in the source is still
    # grounded, unlike a name that appears nowhere in the document at all.
    return any(
        difflib.SequenceMatcher(None, needle, line.strip().lower()).ratio() > 0.6
        for line in text.splitlines()
        if line.strip()
    )


def _extract_json(content: str) -> dict | list | None:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}|\[.*\]", content, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


_RECEIPT_SYSTEM_PROMPT = (
    "You extract structured data from a single receipt/invoice. When an image of "
    "the document is attached it is the primary source of truth; any accompanying "
    "extracted text is a noisy OCR/PDF aid that frequently drops or garbles "
    "symbols (a currency glyph like ₹ may show up as a dot or vanish entirely). "
    "Always determine the currency by reading the symbol or word printed on the "
    "image itself, not from whether the text happens to include it. Use only what "
    "the document actually shows — never invent values or use outside knowledge — "
    "and return null for a field only when it truly isn't shown anywhere. For the "
    "date, use the date the bill/invoice was issued (labels like Invoice Date, "
    "Bill Date, Date, Dated, or Korean 날짜/거래일시) — not a due date, and never "
    "today's date; many receipts write the day first (DD/MM/YYYY) and some use a "
    "year-first CJK form (e.g. 2026년 3월 15일). The vendor/merchant name and other "
    "text may be in a non-Latin script (e.g. Korean); keep it exactly as printed. "
    "Map the currency to its 3-letter ISO code: ₹ or Rs or INR -> INR, "
    "$ -> USD, £ -> GBP, € -> EUR, ¥ -> JPY, ₩ or 원 -> KRW. Amounts in won or yen "
    "have no decimal part (e.g. ₩12,000). "
    "Respond with strict JSON only, no commentary, matching exactly: "
    '{"vendor": string|null, "date": string|null formatted YYYY-MM-DD, '
    '"amount": number|null (the final total charged — not a subtotal, tax line, or '
    'individual line item), "currency": string|null (3-letter ISO code, only if '
    "clearly identifiable)}"
)


def llm_extract_receipt_fields(
    text: str,
    api_key: str,
    *,
    image: tuple[bytes, str] | None = None,
) -> dict:
    """Best-effort LLM extraction for a single receipt/invoice. Returns only
    the fields that passed validation — the caller falls back to heuristics for
    anything missing.

    When `image` (png_bytes, mime) is given it's attached to the request so a
    vision model reads the document directly, and its reading is trusted after
    a format/sanity check. With no image, every value is instead verified
    against the extracted `text` (see the module docstring for why the policy
    differs)."""
    if not text.strip() and image is None:
        return {}
    trust_image = image is not None

    prompt_text = f"Receipt/invoice OCR text (may be noisy):\n\n{text[:_RECEIPT_MAX_CHARS]}"
    if image is not None:
        b64 = base64.b64encode(image[0]).decode("ascii")
        # Image first and at high detail: the model anchors on whichever source
        # leads, and small glyphs like ₹ are only legible at high detail — with
        # the text leading (or low detail) it defaults the currency to null.
        user_content: object = [
            {
                "type": "image_url",
                "image_url": {"url": f"data:{image[1]};base64,{b64}", "detail": "high"},
            },
            {"type": "text", "text": prompt_text},
        ]
    else:
        user_content = prompt_text
    messages = [
        {"role": "system", "content": _RECEIPT_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    try:
        content, _ = call_openai(api_key, messages, json_mode=True)
    except Exception:  # noqa: BLE001 — any LLM failure means "use heuristics instead"
        return {}

    parsed = _extract_json(content)
    if not isinstance(parsed, dict):
        return {}

    validated: dict = {}

    vendor = parsed.get("vendor")
    if trust_image:
        if isinstance(vendor, str) and vendor.strip():
            validated["vendor"] = vendor.strip()
    elif _vendor_in_text(vendor, text):
        validated["vendor"] = str(vendor).strip()

    amount = parsed.get("amount")
    if trust_image:
        if isinstance(amount, (int, float)) and not isinstance(amount, bool) and float(amount) > 0:
            validated["amount"] = float(amount)
    elif _amount_in_text(amount, text):
        validated["amount"] = float(amount)

    iso_date = parsed.get("date")
    if trust_image:
        if _looks_like_iso_date(iso_date):
            validated["expense_date"] = iso_date
    elif _date_in_text(iso_date, text):
        validated["expense_date"] = iso_date

    currency = parsed.get("currency")
    if isinstance(currency, str) and re.fullmatch(r"[A-Za-z]{3}", currency.strip()):
        # Trust a currency read from the image; otherwise require it to be
        # evidenced in the extracted text.
        if trust_image or _currency_in_text(currency, text):
            validated["currency"] = currency.strip().upper()
    # The main multi-field call is unreliable at reporting the currency for
    # glyphs like ₹ (it tends to default to null when juggling every field at
    # once). A second, tightly-focused vision call reads it dependably, so fall
    # back to that whenever we have an image but no currency yet.
    if "currency" not in validated and image is not None:
        code = llm_currency_from_image(image, api_key)
        if code:
            validated["currency"] = code
    return validated


_CURRENCY_SYSTEM_PROMPT = (
    "Identify the currency of the receipt/invoice in the attached image. Read the "
    "currency symbol or word actually printed on it and map it to its 3-letter "
    "ISO 4217 code (e.g. ₹ or Rs -> INR, $ -> USD, £ -> GBP, € -> EUR, ¥ -> JPY, "
    "₩ or 원 -> KRW, and likewise for any other currency). Respond with strict JSON only: "
    '{"currency": string|null} — use null only when no currency mark is visible.'
)


def llm_currency_from_image(image: tuple[bytes, str], api_key: str) -> str | None:
    """Dedicated vision call that reads just the currency off the document
    image. Returns a 3-letter ISO code or None."""
    b64 = base64.b64encode(image[0]).decode("ascii")
    messages = [
        {"role": "system", "content": _CURRENCY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{image[1]};base64,{b64}", "detail": "high"},
                },
            ],
        },
    ]
    try:
        content, _ = call_openai(api_key, messages, json_mode=True)
    except Exception:  # noqa: BLE001 — any failure just means "currency unknown"
        return None
    parsed = _extract_json(content)
    if isinstance(parsed, dict):
        code = parsed.get("currency")
        if isinstance(code, str) and re.fullmatch(r"[A-Za-z]{3}", code.strip()):
            return code.strip().upper()
    return None


_STATEMENT_SYSTEM_PROMPT = (
    "You extract every transaction line from bank/credit-card statement text "
    "captured from a real document. Only include transactions that literally "
    "appear in the text — never invent, merge, estimate, or infer beyond it. For "
    "each transaction extract the vendor/merchant name, the transaction date "
    "(formatted YYYY-MM-DD), and the amount charged as a positive number. Respond "
    "with strict JSON only, no commentary, matching exactly: "
    '{"transactions": [{"vendor": string, "date": string, "amount": number}, ...]}'
)


def llm_extract_statement_rows(text: str, api_key: str) -> list[dict]:
    """Best-effort LLM extraction of every transaction row in a statement,
    each validated against `text`. Returns [] if the LLM is unavailable or
    nothing survives validation — the caller falls back to the regex line
    parser in that case."""
    if not text.strip():
        return []
    messages = [
        {"role": "system", "content": _STATEMENT_SYSTEM_PROMPT},
        {"role": "user", "content": f"Statement text:\n\n{text[:_STATEMENT_MAX_CHARS]}"},
    ]
    try:
        content, _ = call_openai(api_key, messages, json_mode=True)
    except Exception:  # noqa: BLE001
        return []

    parsed = _extract_json(content)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("transactions"), list):
        return []

    rows = []
    for item in parsed["transactions"]:
        if not isinstance(item, dict):
            continue
        vendor, amount, iso_date = item.get("vendor"), item.get("amount"), item.get("date")
        if not _vendor_in_text(vendor, text) or not _amount_in_text(amount, text) or not _date_in_text(iso_date, text):
            continue
        rows.append({"vendor": str(vendor).strip(), "amount": float(amount), "expense_date": iso_date})
    return rows
