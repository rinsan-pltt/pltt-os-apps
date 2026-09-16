"""Smoke tests: health, categories, receipt scan, expense CRUD, report export."""

from __future__ import annotations

import csv
import io
import json
import sys
from datetime import date, datetime, timezone

import fitz
import pytest
from fastapi.testclient import TestClient

from api.core.extraction import _amount_in_text, _date_in_text, _vendor_in_text
from api.main import app



def app_module(name: str):
    """The running app's copy of `api.core.<name>`.

    api/main.py deliberately loads this backend under the globally unique
    package name `expense_receipt_tracker_backend`, so plugin module names
    cannot collide on the hosted runtime. A test that imports `api.core.fx`
    therefore gets a SECOND, separate module object for the same file, and
    monkeypatching it leaves the app's copy untouched — the patch appears to
    work, the assertion still passes for other reasons, and the real function
    goes out to the network. Always patch the object this returns.
    """
    return sys.modules[f"expense_receipt_tracker_backend.api.core.{name}"]

client = TestClient(app)


def make_receipt_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Starbucks Coffee")
    page.insert_text((72, 92), "01/15/2024")
    page.insert_text((72, 112), "Total: $12.34")
    data = doc.tobytes()
    doc.close()
    return data


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_categories():
    resp = client.get("/api/categories")
    assert resp.status_code == 200
    slugs = {c["slug"] for c in resp.json()}
    assert {"meals", "travel", "other"} <= slugs


def test_scan_receipt_extracts_fields_from_pdf():
    resp = client.post(
        "/api/receipts/scan",
        files=[("file", ("receipt.pdf", make_receipt_pdf(), "application/pdf"))],
    )
    assert resp.status_code == 200, resp.text
    draft = resp.json()
    assert draft["vendor"]
    assert draft["amount"] == pytest.approx(12.34)
    assert draft["expense_date"] == "2024-01-15"
    assert draft["category"] == "meals"


def test_expense_crud_round_trip():
    create = client.post(
        "/api/expenses",
        data={
            "vendor": "Starbucks",
            "amount": "12.34",
            "currency": "USD",
            "category": "meals",
            "expense_date": "2024-01-15",
            "status": "pending",
            "notes": "Client meeting",
        },
    )
    assert create.status_code == 201, create.text
    expense = create.json()
    expense_id = expense["id"]
    assert expense["has_receipt"] is False

    listed = client.get("/api/expenses", params={"category": "meals"})
    assert listed.status_code == 200
    assert any(e["id"] == expense_id for e in listed.json())

    searched = client.get("/api/expenses", params={"q": "starbucks"})
    assert any(e["id"] == expense_id for e in searched.json())

    updated = client.put(f"/api/expenses/{expense_id}", json={"status": "reimbursed"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "reimbursed"

    summary = client.get("/api/expenses/summary")
    assert summary.status_code == 200
    assert summary.json()["reimbursed_count"] >= 1

    deleted = client.delete(f"/api/expenses/{expense_id}")
    assert deleted.status_code == 204

    missing = client.get(f"/api/expenses/{expense_id}")
    assert missing.status_code == 404


def test_create_expense_with_receipt_attachment():
    resp = client.post(
        "/api/expenses",
        data={
            "vendor": "Office Depot",
            "amount": "45.00",
            "category": "office",
            "expense_date": "2024-03-01",
        },
        files={"receipt": ("receipt.pdf", make_receipt_pdf(), "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    expense = resp.json()
    assert expense["has_receipt"] is True

    receipt = client.get(f"/api/expenses/{expense['id']}/receipt")
    assert receipt.status_code == 200
    assert receipt.headers["content-type"] == "application/pdf"


def test_create_expense_with_durable_storage_reference():
    # Simulates the frontend having uploaded the receipt to platform storage
    # (palette.storage) and passing the reference instead of the raw file.
    resp = client.post(
        "/api/expenses",
        data={
            "vendor": "Cloud Cafe",
            "amount": "18.00",
            "category": "meals",
            "expense_date": "2024-03-15",
            "receipt_object_path": "receipts/abc123-lunch.pdf",
            "receipt_url": "https://storage.example.com/receipts/abc123-lunch.pdf",
            "receipt_original_name": "lunch.pdf",
            "receipt_content_type": "application/pdf",
        },
    )
    assert resp.status_code == 201, resp.text
    expense = resp.json()
    assert expense["has_receipt"] is True
    assert expense["receipt_url"] == "https://storage.example.com/receipts/abc123-lunch.pdf"

    # The receipt route redirects to the durable storage URL (no local file).
    receipt = client.get(f"/api/expenses/{expense['id']}/receipt", follow_redirects=False)
    assert receipt.status_code in (302, 307)
    assert receipt.headers["location"] == "https://storage.example.com/receipts/abc123-lunch.pdf"

    client.delete(f"/api/expenses/{expense['id']}")


def test_export_report_csv_and_pdf():
    client.post(
        "/api/expenses",
        data={
            "vendor": "Delta Airlines",
            "amount": "450.00",
            "category": "travel",
            "expense_date": "2024-02-01",
        },
    )
    csv_resp = client.post("/api/reports/export", json={"category": "travel", "format": "csv"})
    assert csv_resp.status_code == 200, csv_resp.text
    rows = list(csv.reader(io.StringIO(csv_resp.content.decode("utf-8"))))
    assert rows[0][:3] == ["Date", "Vendor", "Category"]

    pdf_resp = client.post("/api/reports/export", json={"category": "travel", "format": "pdf"})
    assert pdf_resp.status_code == 200
    assert pdf_resp.headers["content-type"] == "application/pdf"


def test_export_report_xlsx_is_a_real_workbook():
    """Not a renamed CSV. Excel refuses those, so the bytes have to be a real
    zip container that openpyxl can reopen, with typed cells inside."""
    from openpyxl import load_workbook

    row = client.post(
        "/api/expenses",
        data={
            "vendor": "Excel Vendor",
            "amount": "123.45",
            "currency": "USD",
            "category": "travel",
            "expense_date": "2024-03-04",
            "notes": "quarterly offsite",
        },
    ).json()

    resp = client.post(
        "/api/reports/export",
        json={"category": "travel", "format": "xlsx", "title": "Q1 Report"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert ".xlsx" in resp.headers["content-disposition"]
    # A real xlsx is a zip; a renamed CSV would fail this first byte check.
    assert resp.content[:2] == b"PK"

    book = load_workbook(io.BytesIO(resp.content))
    sheet = book.active
    assert sheet.title == "Q1 Report"
    assert [c.value for c in sheet[1]][:3] == ["Date", "Vendor", "Category"]
    # Header frozen so a long report stays readable.
    assert sheet.freeze_panes == "A2"

    found = [r for r in sheet.iter_rows(min_row=2, values_only=True) if r[1] == "Excel Vendor"]
    assert found, "the exported row is missing"
    cells = found[0]
    # The whole point over CSV: the amount is a NUMBER and the date is a DATE.
    assert isinstance(cells[3], (int, float)) and cells[3] == pytest.approx(123.45)
    assert isinstance(cells[0], (date, datetime))

    client.delete(f"/api/expenses/{row['id']}")


def test_export_report_rejects_an_unknown_format():
    resp = client.post("/api/reports/export", json={"category": "travel", "format": "ods"})
    assert resp.status_code == 422
    assert "xlsx" in resp.json()["detail"]


def test_pdf_table_cells_do_not_overflow_their_columns():
    # Regression guard: long vendor/category/notes and big amounts must be
    # clipped to their column, never bleed into the neighbouring one.
    from datetime import date

    from api.core.reports import _COLUMNS, build_pdf

    class _Row:
        def __init__(self, d, vendor, cat, amt, ccy, status, notes):
            self.expense_date, self.vendor, self.category = d, vendor, cat
            self.amount, self.currency, self.status, self.notes = amt, ccy, status, notes

    rows = [
        _Row(date(2024, 1, 15), "Starbucks", "meals", 12.34, "USD", "pending", "Client meeting"),
        _Row(
            date(2024, 2, 1),
            "A Very Long Vendor Name That Should Definitely Overflow The Column",
            "professional-services-and-consulting",
            1234567.89,
            "INR",
            "submitted",
            "An extremely long note that would previously bleed across into the next column and look broken",
        ),
    ]
    pdf = build_pdf(rows, "Reimbursement Report")

    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        margin = 40.0
        usable = doc[0].rect.width - 2 * margin
        edges, x = [], margin
        for _, frac, _align in _COLUMNS:
            width = usable * frac
            edges.append((x, x + width))
            x += width
        table_top = 84  # below the title/subtitle band

        checked = 0
        for page in doc:
            for wx0, _wy0, wx1, wy1, word, *_ in page.get_text("words"):
                if wy1 < table_top:
                    continue  # title / subtitle, not a table cell
                col = next((c for c in edges if c[0] - 0.6 <= wx0 < c[1]), None)
                if not col:
                    continue
                checked += 1
                assert wx1 <= col[1] + 0.8, f"'{word}' overflows column right edge {col[1]:.1f} (x1={wx1:.1f})"
        assert checked > 0
    finally:
        doc.close()


def test_export_report_no_matches_is_422():
    resp = client.post("/api/reports/export", json={"category": "health", "status": "reimbursed"})
    assert resp.status_code == 422


def make_statement_csv() -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Date", "Description", "Amount"])
    writer.writerow(["01/15/2024", "Uber Trip", "23.50"])
    writer.writerow(["01/16/2024", "Office Depot", "(45.00)"])
    writer.writerow(["", "", ""])  # blank separator row — should be skipped
    return buffer.getvalue().encode("utf-8")


def make_statement_xlsx() -> bytes:
    import io as _io

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Date", "Vendor", "Amount"])
    ws.append(["2024-02-05", "Delta Airlines", 450.0])
    ws.append(["2024-02-06", "Marriott Hotel", 210.75])
    out = _io.BytesIO()
    wb.save(out)
    return out.getvalue()


def make_statement_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "01/20/2024 Shell Gas Station 34.12")
    page.insert_text((72, 92), "01/21/2024 Whole Foods Market 88.90")
    data = doc.tobytes()
    doc.close()
    return data


def test_import_preview_csv():
    resp = client.post(
        "/api/imports/preview",
        files=[("file", ("statement.csv", make_statement_csv(), "text/csv"))],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_count"] == 2
    assert body["valid_count"] == 2
    vendors = {row["vendor"] for row in body["rows"]}
    assert vendors == {"Uber Trip", "Office Depot"}
    amounts = {row["amount"] for row in body["rows"]}
    assert amounts == {23.5, 45.0}


def test_import_preview_xlsx():
    resp = client.post(
        "/api/imports/preview",
        files=[
            (
                "file",
                (
                    "statement.xlsx",
                    make_statement_xlsx(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ),
            )
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_count"] == 2
    assert body["valid_count"] == 2
    assert any(row["vendor"] == "Delta Airlines" and row["category"] == "travel" for row in body["rows"])


def test_import_preview_pdf_statement():
    resp = client.post(
        "/api/imports/preview",
        files=[("file", ("statement.pdf", make_statement_pdf(), "application/pdf"))],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_count"] == 2
    vendors = {row["vendor"] for row in body["rows"]}
    assert vendors == {"Shell Gas Station", "Whole Foods Market"}


def test_import_commit_creates_expenses():
    resp = client.post(
        "/api/imports/commit",
        json={
            "rows": [
                {
                    "vendor": "Uber Trip",
                    "amount": 23.5,
                    "category": "transportation",
                    "expense_date": "2024-01-15",
                },
                {
                    "vendor": "Office Depot",
                    "amount": 45.0,
                    "category": "office",
                    "expense_date": "2024-01-16",
                },
            ]
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["created"] == 2

    listed = client.get("/api/expenses", params={"q": "uber"})
    assert any(e["vendor"] == "Uber Trip" for e in listed.json())


def test_import_commit_rejects_unknown_category():
    resp = client.post(
        "/api/imports/commit",
        json={"rows": [{"vendor": "Mystery", "amount": 5, "category": "nope", "expense_date": "2024-01-01"}]},
    )
    assert resp.status_code == 422


def test_scan_without_openai_key_skips_llm_and_still_extracts():
    # No OPENAI_KEY is set anywhere in this test environment (conftest.py
    # doesn't set it, and it's not in the process env) — this exercises the
    # pure-heuristic path and confirms `llm_assisted` correctly reports "no".
    resp = client.post(
        "/api/receipts/scan",
        files=[("file", ("receipt.pdf", make_receipt_pdf(), "application/pdf"))],
    )
    assert resp.status_code == 200, resp.text
    draft = resp.json()
    assert draft["llm_assisted"] is False
    assert draft["amount"] == pytest.approx(12.34)


# ---------------------------------------------------------------------------
# Grounding validation — the core guarantee behind "always correct data only
# from the inputs": an LLM-returned value is only ever used if it's checked
# against the actual source text first. These test the checkers directly
# rather than mocking the OpenAI call, so they don't depend on network access
# or on which module-loading path (aliased vs. plain) a given request went
# through.
# ---------------------------------------------------------------------------

def test_bulk_status_update():
    ids = []
    for vendor in ("Bulk A", "Bulk B", "Bulk C"):
        r = client.post(
            "/api/expenses",
            data={"vendor": vendor, "amount": "10", "category": "other", "expense_date": "2024-07-01"},
        )
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])

    # Flip two of the three to "reimbursed" in one call.
    resp = client.post("/api/expenses/bulk-status", json={"ids": ids[:2], "status": "reimbursed"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["updated"] == 2

    statuses = {e["id"]: e["status"] for e in client.get("/api/expenses").json()}
    assert statuses[ids[0]] == "reimbursed"
    assert statuses[ids[1]] == "reimbursed"
    assert statuses[ids[2]] == "pending"

    # An unknown status is rejected; empty selection is rejected.
    assert client.post("/api/expenses/bulk-status", json={"ids": ids, "status": "nope"}).status_code == 422
    assert client.post("/api/expenses/bulk-status", json={"ids": [], "status": "submitted"}).status_code == 422

    for i in ids:
        client.delete(f"/api/expenses/{i}")


def test_categories_apply_add_rename_delete_and_recategorize():
    # Seeded defaults are present.
    before = {c["slug"]: c for c in client.get("/api/categories").json()}
    assert "meals" in before and "other" in before

    # Create an expense that will need re-homing when its category is deleted.
    created = client.post(
        "/api/expenses",
        data={
            "vendor": "Blue Bottle Coffee",
            "amount": "6.50",
            "category": "meals",
            "expense_date": "2024-05-01",
        },
    ).json()

    # Apply: rename "meals" (slug stays), add a new "Pet Care", and drop
    # "marketing". Keep every other existing category so they aren't deleted.
    desired = []
    for slug, c in before.items():
        if slug == "marketing":
            continue  # delete this one
        label = "Food & Coffee" if slug == "meals" else c["label"]
        desired.append({"slug": slug, "label": label, "keywords": c["keywords"]})
    desired.append({"label": "Pet Care", "keywords": ["vet", "petco"]})

    resp = client.put("/api/categories", json={"categories": desired})
    assert resp.status_code == 200, resp.text
    slugs = {c["slug"]: c for c in resp.json()["categories"]}

    # Rename kept the slug; new category got a generated slug; delete removed it.
    assert slugs["meals"]["label"] == "Food & Coffee"
    assert "marketing" not in slugs
    assert any(c["label"] == "Pet Care" for c in slugs.values())

    # The renamed slug is unchanged, so the expense keeps its association.
    still = client.get(f"/api/expenses/{created['id']}").json()
    assert still["category"] == "meals"

    # Deleting a category is rejected as an unknown category on new writes.
    reject = client.post(
        "/api/expenses",
        data={"vendor": "X", "amount": "1", "category": "marketing", "expense_date": "2024-05-01"},
    )
    assert reject.status_code == 422

    client.delete(f"/api/expenses/{created['id']}")


def test_categories_apply_reassigns_expenses_in_deleted_category():
    # An expense whose category is deleted must be moved to a valid one.
    cats = {c["slug"]: c for c in client.get("/api/categories").json()}
    made = client.post(
        "/api/expenses",
        data={"vendor": "Some Vendor", "amount": "9.99", "category": "office", "expense_date": "2024-06-01"},
    ).json()

    desired = [
        {"slug": slug, "label": c["label"], "keywords": c["keywords"]}
        for slug, c in cats.items()
        if slug != "office"  # delete "office"
    ]
    resp = client.put("/api/categories", json={"categories": desired})
    assert resp.status_code == 200, resp.text

    moved = client.get(f"/api/expenses/{made['id']}").json()
    valid = {c["slug"] for c in resp.json()["categories"]}
    assert moved["category"] in valid
    assert moved["category"] != "office"

    client.delete(f"/api/expenses/{made['id']}")


def test_settings_get_default_and_update():
    # Defaults to USD before anything is stored.
    resp = client.get("/api/settings")
    assert resp.status_code == 200, resp.text
    assert resp.json()["base_currency"] == "USD"

    # Update to INR (lower-case is normalized to upper) and read it back.
    upd = client.put("/api/settings", json={"base_currency": "inr"})
    assert upd.status_code == 200, upd.text
    assert upd.json()["base_currency"] == "INR"
    assert client.get("/api/settings").json()["base_currency"] == "INR"

    # Garbage is rejected; restore USD so other tests see the default.
    assert client.put("/api/settings", json={"base_currency": "12"}).status_code == 422
    assert client.put("/api/settings", json={"base_currency": "USD"}).json()["base_currency"] == "USD"


def test_summary_converts_other_currencies_to_base(monkeypatch):
    # Force the offline static-fallback rates so the assertion is deterministic
    # regardless of network access (INR ≈ 83 per USD in fx._STATIC_USD_RATES).
    fx = app_module("fx")

    fx._rate_cache.clear()
    monkeypatch.setattr(fx, "_fetch_live_rates", lambda on_date, base: None)

    # Base = USD. The DB carries expenses from earlier tests, so assert on the
    # delta this test contributes rather than an absolute total. Adding a 100
    # USD expense and an 8300 INR expense should raise the total by ~200 USD
    # (the INR converts to ~100 USD), not by 8400.
    client.put("/api/settings", json={"base_currency": "USD"})
    before = client.get("/api/expenses/summary").json()["total_amount"]
    usd = client.post(
        "/api/expenses",
        data={"vendor": "USD Vendor", "amount": "100", "currency": "USD",
              "category": "other", "expense_date": "2024-04-01"},
    ).json()
    inr = client.post(
        "/api/expenses",
        data={"vendor": "INR Vendor", "amount": "8300", "currency": "INR",
              "category": "other", "expense_date": "2024-04-01"},
    ).json()

    summary = client.get("/api/expenses/summary").json()
    assert summary["base_currency"] == "USD"
    assert summary["converted"] is True
    assert "INR" in summary["converted_from"]
    assert summary["total_amount"] - before == pytest.approx(200.0, abs=0.5)

    client.delete(f"/api/expenses/{usd['id']}")
    client.delete(f"/api/expenses/{inr['id']}")


# --------------------------------------------------------------- by_month
#
# The suite shares one database across every test and never truncates it, so
# these assert on the DELTA each test contributes and delete their own rows.


def _months():
    return client.get("/api/expenses/summary").json()["by_month"]


def _shift_month(d: date, back: int) -> date:
    """`d` moved `back` whole months, clamped to the 15th so no month-length
    arithmetic can push it into a neighbouring month."""
    year, month = d.year, d.month - back
    while month <= 0:
        year, month = year - 1, month + 12
    return date(year, month, 15)


def test_summary_by_month_window_shape():
    """Shape is data-independent, so this is also the empty-ledger contract."""
    months = _months()
    assert len(months) == 13

    today = datetime.now(timezone.utc).date()
    assert months[-1]["month"] == f"{today.year:04d}-{today.month:02d}"

    # Contiguous and ascending: walk backwards from the newest key.
    expected = []
    year, month = today.year, today.month
    for _ in range(13):
        expected.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    assert [m["month"] for m in months] == list(reversed(expected))

    for m in months:
        assert set(m) == {"month", "amount", "count", "reimbursed_amount", "approximate"}


def test_summary_by_month_buckets_current_and_prior_month():
    today = datetime.now(timezone.utc).date()
    prior = _shift_month(today, 1)
    before = {m["month"]: m for m in _months()}

    now_row = client.post(
        "/api/expenses",
        data={"vendor": "This Month", "amount": "40", "currency": "USD",
              "category": "other", "expense_date": today.isoformat()},
    ).json()
    prior_row = client.post(
        "/api/expenses",
        data={"vendor": "Last Month", "amount": "25", "currency": "USD",
              "category": "other", "expense_date": prior.isoformat()},
    ).json()

    after = {m["month"]: m for m in _months()}
    now_key = f"{today.year:04d}-{today.month:02d}"
    prior_key = f"{prior.year:04d}-{prior.month:02d}"

    assert after[now_key]["amount"] - before[now_key]["amount"] == pytest.approx(40.0)
    assert after[now_key]["count"] - before[now_key]["count"] == 1
    assert after[prior_key]["amount"] - before[prior_key]["amount"] == pytest.approx(25.0)
    assert after[prior_key]["count"] - before[prior_key]["count"] == 1

    client.delete(f"/api/expenses/{now_row['id']}")
    client.delete(f"/api/expenses/{prior_row['id']}")

    restored = {m["month"]: m for m in _months()}
    assert restored[now_key]["amount"] == pytest.approx(before[now_key]["amount"])
    assert restored[prior_key]["amount"] == pytest.approx(before[prior_key]["amount"])


def test_summary_by_month_converts_mixed_currencies(monkeypatch):
    """The reason the dashboard chart can plot every currency at once."""
    fx = app_module("fx")

    fx._rate_cache.clear()
    monkeypatch.setattr(fx, "_fetch_live_rates", lambda on_date, base: None)
    client.put("/api/settings", json={"base_currency": "USD"})

    today = datetime.now(timezone.utc).date()
    now_key = f"{today.year:04d}-{today.month:02d}"
    before = {m["month"]: m for m in _months()}[now_key]["amount"]

    usd = client.post(
        "/api/expenses",
        data={"vendor": "USD Vendor", "amount": "100", "currency": "USD",
              "category": "other", "expense_date": today.isoformat()},
    ).json()
    inr = client.post(
        "/api/expenses",
        data={"vendor": "INR Vendor", "amount": "8300", "currency": "INR",
              "category": "other", "expense_date": today.isoformat()},
    ).json()

    after = {m["month"]: m for m in _months()}[now_key]["amount"]
    # ~200 USD, not 8400 — the INR row was converted, not added raw.
    assert after - before == pytest.approx(200.0, abs=0.5)

    client.delete(f"/api/expenses/{usd['id']}")
    client.delete(f"/api/expenses/{inr['id']}")


def test_summary_by_month_keeps_zero_activity_months():
    """A gap must stay in the array, or the chart draws a month that never was
    and the delta compares against the wrong month."""
    today = datetime.now(timezone.utc).date()
    two_back = _shift_month(today, 2)
    gap_key = f"{_shift_month(today, 1).year:04d}-{_shift_month(today, 1).month:02d}"
    before = {m["month"]: m for m in _months()}

    row = client.post(
        "/api/expenses",
        data={"vendor": "Two Months Ago", "amount": "60", "currency": "USD",
              "category": "other", "expense_date": two_back.isoformat()},
    ).json()

    months = _months()
    keys = [m["month"] for m in months]
    # The intervening month is still present, still zero-delta, and still in the
    # same position — the gap did not shift anything.
    assert gap_key in keys
    assert keys.index(gap_key) == len(keys) - 2
    gap = next(m for m in months if m["month"] == gap_key)
    assert gap["amount"] == pytest.approx(before[gap_key]["amount"])

    client.delete(f"/api/expenses/{row['id']}")


def test_summary_by_month_excludes_expenses_older_than_the_window():
    """by_month deliberately does NOT sum to total_amount."""
    today = datetime.now(timezone.utc).date()
    ancient = _shift_month(today, 20)
    before = client.get("/api/expenses/summary").json()
    before_total = before["total_amount"]
    before_month_sum = sum(m["amount"] for m in before["by_month"])

    row = client.post(
        "/api/expenses",
        data={"vendor": "Ancient History", "amount": "77", "currency": "USD",
              "category": "other", "expense_date": ancient.isoformat()},
    ).json()

    after = client.get("/api/expenses/summary").json()
    assert after["total_amount"] - before_total == pytest.approx(77.0)
    assert sum(m["amount"] for m in after["by_month"]) == pytest.approx(before_month_sum)
    assert f"{ancient.year:04d}-{ancient.month:02d}" not in [m["month"] for m in after["by_month"]]

    client.delete(f"/api/expenses/{row['id']}")


def test_summary_by_month_flags_an_unconvertible_month(monkeypatch):
    fx = app_module("fx")

    fx._rate_cache.clear()
    monkeypatch.setattr(fx, "_fetch_live_rates", lambda on_date, base: None)
    client.put("/api/settings", json={"base_currency": "USD"})

    today = datetime.now(timezone.utc).date()
    now_key = f"{today.year:04d}-{today.month:02d}"
    # XYZ is in neither the live feed (stubbed off) nor _STATIC_USD_RATES.
    row = client.post(
        "/api/expenses",
        data={"vendor": "Unknown Currency", "amount": "10", "currency": "XYZ",
              "category": "other", "expense_date": today.isoformat()},
    ).json()

    summary = client.get("/api/expenses/summary").json()
    assert summary["approximate"] is True
    months = {m["month"]: m for m in summary["by_month"]}
    assert months[now_key]["approximate"] is True
    # Scoped to the month it happened in, not smeared across the window.
    assert any(not m["approximate"] for m in summary["by_month"])

    # Must be deleted here — an XYZ row left behind poisons `approximate` for
    # every test that runs after this one.
    client.delete(f"/api/expenses/{row['id']}")
    assert client.get("/api/expenses/summary").json()["approximate"] is False


def test_summary_date_window_narrows_the_totals():
    """The window the dashboard calendar drives. Conversion is server-side, so
    this is the only place a mixed-currency range can be totalled correctly."""
    today = datetime.now(timezone.utc).date()
    day = _shift_month(today, 3)          # the 15th, three months back
    other = date(day.year, day.month, 16)

    before_all = client.get("/api/expenses/summary").json()["total_amount"]

    a = client.post(
        "/api/expenses",
        data={"vendor": "In Window", "amount": "50", "currency": "USD",
              "category": "other", "expense_date": day.isoformat()},
    ).json()
    b = client.post(
        "/api/expenses",
        data={"vendor": "Out Of Window", "amount": "70", "currency": "USD",
              "category": "other", "expense_date": other.isoformat()},
    ).json()

    # Unfiltered still sees both.
    assert client.get("/api/expenses/summary").json()["total_amount"] - before_all == pytest.approx(120.0)

    # A single-day window sees only the row on that day.
    scoped = client.get(
        "/api/expenses/summary",
        params={"date_from": day.isoformat(), "date_to": day.isoformat()},
    ).json()
    assert scoped["total_amount"] == pytest.approx(50.0)
    assert scoped["total_count"] == 1

    # A range covering both sees both.
    both = client.get(
        "/api/expenses/summary",
        params={"date_from": day.isoformat(), "date_to": other.isoformat()},
    ).json()
    assert both["total_amount"] == pytest.approx(120.0)
    assert both["total_count"] == 2

    # by_category is scoped too — it drives the donut.
    assert sum(c["amount"] for c in scoped["by_category"]) == pytest.approx(50.0)

    client.delete(f"/api/expenses/{a['id']}")
    client.delete(f"/api/expenses/{b['id']}")


def test_summary_by_day_only_appears_for_a_window():
    """by_day drives the range chart's date axis, so it is scoped and sparse."""
    app_module("fx")._rate_cache.clear()
    today = datetime.now(timezone.utc).date()
    d1 = _shift_month(today, 4)                    # the 15th
    d2 = date(d1.year, d1.month, 17)               # skips the 16th on purpose

    # Unfiltered: no per-day breakdown at all.
    assert client.get("/api/expenses/summary").json()["by_day"] == []

    a = client.post(
        "/api/expenses",
        data={"vendor": "Day One", "amount": "20", "currency": "USD",
              "category": "other", "expense_date": d1.isoformat()},
    ).json()
    b = client.post(
        "/api/expenses",
        data={"vendor": "Day One Again", "amount": "5", "currency": "USD",
              "category": "other", "expense_date": d1.isoformat()},
    ).json()
    c = client.post(
        "/api/expenses",
        data={"vendor": "Day Three", "amount": "11", "currency": "USD",
              "category": "other", "expense_date": d2.isoformat()},
    ).json()

    scoped = client.get(
        "/api/expenses/summary",
        params={"date_from": d1.isoformat(), "date_to": d2.isoformat()},
    ).json()
    days = scoped["by_day"]

    # Two entries, not three: the empty middle day is omitted, and the two rows
    # sharing d1 are summed into one bar.
    assert [d["day"] for d in days] == [d1.isoformat(), d2.isoformat()]
    assert days[0]["amount"] == pytest.approx(25.0)
    assert days[0]["count"] == 2
    assert days[1]["amount"] == pytest.approx(11.0)
    assert all(set(d) == {"day", "amount", "count", "approximate"} for d in days)
    # Ascending, so the chart can plot it as given.
    assert [d["day"] for d in days] == sorted(d["day"] for d in days)
    # And it agrees with the window's own total.
    assert sum(d["amount"] for d in days) == pytest.approx(scoped["total_amount"])

    # A single-day window is one bar.
    one = client.get(
        "/api/expenses/summary",
        params={"date_from": d1.isoformat(), "date_to": d1.isoformat()},
    ).json()
    assert len(one["by_day"]) == 1 and one["by_day"][0]["amount"] == pytest.approx(25.0)

    for row in (a, b, c):
        client.delete(f"/api/expenses/{row['id']}")


def test_summary_by_day_converts_mixed_currencies(monkeypatch):
    """The reason this is server-side: a client cannot total INR + USD."""
    fx = app_module("fx")

    fx._rate_cache.clear()
    monkeypatch.setattr(fx, "_fetch_live_rates", lambda on_date, base: None)
    client.put("/api/settings", json={"base_currency": "USD"})

    today = datetime.now(timezone.utc).date()
    day = _shift_month(today, 5)
    usd = client.post(
        "/api/expenses",
        data={"vendor": "USD Row", "amount": "100", "currency": "USD",
              "category": "other", "expense_date": day.isoformat()},
    ).json()
    inr = client.post(
        "/api/expenses",
        data={"vendor": "INR Row", "amount": "8300", "currency": "INR",
              "category": "other", "expense_date": day.isoformat()},
    ).json()

    days = client.get(
        "/api/expenses/summary",
        params={"date_from": day.isoformat(), "date_to": day.isoformat()},
    ).json()["by_day"]
    assert len(days) == 1
    # ~200 USD, not 8400.
    assert days[0]["amount"] == pytest.approx(200.0, abs=0.5)

    client.delete(f"/api/expenses/{usd['id']}")
    client.delete(f"/api/expenses/{inr['id']}")


def test_summary_rejects_a_malformed_date_window():
    resp = client.get("/api/expenses/summary", params={"date_from": "08-09-2026"})
    assert resp.status_code == 422


def test_grounding_accepts_values_present_in_source_text():
    text = "Starbucks Coffee\n123 Main St\n01/15/2024\nSubtotal: $11.50\nTotal: $12.34"
    assert _amount_in_text(12.34, text) is True
    assert _date_in_text("2024-01-15", text) is True
    assert _vendor_in_text("Starbucks Coffee", text) is True
    # A close OCR-noise variant of a real line should still be grounded.
    assert _vendor_in_text("Starbucks Coffe", text) is True


def test_grounding_rejects_hallucinated_values():
    text = "Starbucks Coffee\n123 Main St\n01/15/2024\nSubtotal: $11.50\nTotal: $12.34"
    # An amount that never appears anywhere in the document — even if it's
    # "plausible" — must not be trusted.
    assert _amount_in_text(999.99, text) is False
    # A date the model might infer from "today" but that isn't in the text.
    assert _date_in_text("2030-05-05", text) is False
    # A vendor name unrelated to anything on the receipt.
    assert _vendor_in_text("Completely Unrelated Corp", text) is False
    # Malformed/missing values never validate.
    assert _amount_in_text(None, text) is False
    assert _date_in_text("not-a-date", text) is False
    assert _vendor_in_text("", text) is False


# --------------------------------------------------------------- list params
# `sort`/`order`/`limit`/`offset` are additive: the defaults must reproduce the
# original behaviour, and `q` moving from a post-query Python filter into the
# SQL WHERE must not change what it matches.


def _mk(vendor: str, amount: float, date: str, category: str = "other", notes: str = "") -> str:
    resp = client.post(
        "/api/expenses",
        data={
            "vendor": vendor,
            "amount": str(amount),
            "currency": "USD",
            "category": category,
            "expense_date": date,
            "status": "pending",
            "notes": notes,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_list_sort_order_and_paging():
    ids = {
        "b": _mk("Bravo Cafe", 30.0, "2024-03-02"),
        "a": _mk("alpha Diner", 10.0, "2024-03-03"),
        "c": _mk("Charlie Hotel", 20.0, "2024-03-01"),
    }
    mine = set(ids.values())

    def vendors(**params):
        rows = client.get("/api/expenses", params=params).json()
        return [r["vendor"] for r in rows if r["id"] in mine]

    # Default is unchanged: newest expense_date first.
    assert vendors() == ["alpha Diner", "Bravo Cafe", "Charlie Hotel"]

    assert vendors(sort="amount", order="asc") == ["alpha Diner", "Charlie Hotel", "Bravo Cafe"]
    assert vendors(sort="amount", order="desc") == ["Bravo Cafe", "Charlie Hotel", "alpha Diner"]
    # Vendor sorting is case-insensitive, so "alpha" sorts before "Bravo".
    assert vendors(sort="vendor", order="asc") == ["alpha Diner", "Bravo Cafe", "Charlie Hotel"]
    assert vendors(sort="date", order="asc") == ["Charlie Hotel", "Bravo Cafe", "alpha Diner"]

    # Paging windows the sorted set without repeating or skipping.
    page1 = client.get("/api/expenses", params={"sort": "amount", "order": "asc", "limit": 2}).json()
    assert len(page1) == 2
    page2 = client.get(
        "/api/expenses", params={"sort": "amount", "order": "asc", "limit": 2, "offset": 2}
    ).json()
    assert {r["id"] for r in page1}.isdisjoint({r["id"] for r in page2})


def test_list_rejects_unknown_sort_and_order():
    assert client.get("/api/expenses", params={"sort": "nope"}).status_code == 422
    assert client.get("/api/expenses", params={"order": "sideways"}).status_code == 422
    # limit/offset bounds are enforced by FastAPI's validation.
    assert client.get("/api/expenses", params={"limit": 0}).status_code == 422
    assert client.get("/api/expenses", params={"offset": -1}).status_code == 422


def test_search_is_case_insensitive_across_vendor_and_notes():
    vid = _mk("Zeta Supplies", 5.0, "2024-04-01")
    nid = _mk("Unrelated Vendor", 6.0, "2024-04-02", notes="Quarterly ZETA offsite")

    hits = {e["id"] for e in client.get("/api/expenses", params={"q": "zeta"}).json()}
    assert vid in hits, "vendor match lost"
    assert nid in hits, "notes match lost"

    hits_upper = {e["id"] for e in client.get("/api/expenses", params={"q": "ZeTa"}).json()}
    assert hits_upper == hits, "search stopped being case-insensitive"


def test_search_treats_like_wildcards_literally():
    """`%` and `_` must match themselves, as the old Python `in` check did."""
    pct = _mk("Fifty% Discount Store", 7.0, "2024-05-01")
    plain = _mk("Fifty Percent Store", 8.0, "2024-05-02")

    hits = {e["id"] for e in client.get("/api/expenses", params={"q": "fifty%"}).json()}
    assert pct in hits
    assert plain not in hits, "'%' behaved as a SQL wildcard instead of a literal"

    under = _mk("A_B Trading", 9.0, "2024-05-03")
    other = _mk("AXB Trading", 9.5, "2024-05-04")
    hits2 = {e["id"] for e in client.get("/api/expenses", params={"q": "a_b"}).json()}
    assert under in hits2
    assert other not in hits2, "'_' behaved as a SQL wildcard instead of a literal"


def test_status_sorts_in_workflow_order_not_alphabetically():
    """pending -> submitted -> reimbursed. Alphabetical would wrongly give
    pending, reimbursed, submitted."""
    made = {}
    for st in ("reimbursed", "pending", "submitted"):
        r = client.post(
            "/api/expenses",
            data={
                "vendor": f"WorkflowSort {st}",
                "amount": "1.00",
                "currency": "USD",
                "category": "other",
                "expense_date": "2024-06-01",
                "status": st,
            },
        )
        assert r.status_code == 201, r.text
        made[r.json()["id"]] = st

    rows = client.get("/api/expenses", params={"sort": "status", "order": "asc"}).json()
    ordered = [made[r["id"]] for r in rows if r["id"] in made]
    assert ordered == ["pending", "submitted", "reimbursed"], ordered


# ------------------------------------------------------------------- chat
#
# The agent's only non-determinism is the model, so every test here scripts it:
# `scripted_llm` replaces the OpenAI client with a queue of replies, which makes
# the tool loop itself — dispatch, confirmation gating, error recovery, the step
# ceiling — the thing under test.


@pytest.fixture
def scripted_llm(monkeypatch):
    """Feed the agent a fixed sequence of model replies.

    Returns a recorder: call it with the decisions the model should make, then
    read `.prompts` afterwards to assert on what the agent was told.
    """
    monkeypatch.setenv("OPENAI_KEY", "test-key")

    class Script:
        def __init__(self):
            self.queue: list[dict] = []
            self.prompts: list[list[dict]] = []

        def replies(self, *decisions: dict):
            """Start a fresh scripted exchange.

            Clears `prompts` as well as the queue, so a test can script a
            second exchange and then assert on what the model was asked in
            that one alone — including that it was asked nothing at all."""
            self.queue = [json.dumps(d) for d in decisions]
            self.prompts = []
            return self

        def __call__(self, api_key, messages, *, json_mode=False, model=None):
            self.prompts.append(messages)
            if not self.queue:
                raise AssertionError("the agent asked the model more times than scripted")
            return self.queue.pop(0), "test-model"

        def name_checks(self) -> list[list[str]]:
            """The names submitted to the category-name check, per call.

            A successful `PUT /categories` also runs the re-categoriser, which
            goes through this same client — so counting prompts cannot tell the
            two apart. Match on the check's own system prompt instead."""
            return [
                json.loads(messages[1]["content"])["names"]
                for messages in self.prompts
                if "expense-category names" in messages[0]["content"]
            ]

    script = Script()
    # Patch every app module that bound the name, not just `llm`.
    #
    # core/llm.py defines `call_openai`, and categorize.py, extraction.py and
    # category_validation.py each do `from .llm import call_openai` — a
    # binding in their OWN namespace, which a patch on `llm` does not touch.
    # Missing one means the real function runs and calls api.openai.com. (The
    # agent is the exception: it imports `call_openai_async`, which resolves
    # `call_openai` from llm's globals at call time.)
    patched = 0
    for name, module in list(sys.modules.items()):
        if not name.startswith("expense_receipt_tracker_backend.api."):
            continue
        if getattr(module, "call_openai", None) is not None:
            monkeypatch.setattr(module, "call_openai", script)
            patched += 1
    assert patched, "no module holding call_openai was found — the LLM would be called for real"
    return script


def make_expense(vendor="Chai Point", amount="10.00", **extra) -> str:
    payload = {
        "vendor": vendor,
        "amount": amount,
        "currency": "USD",
        "category": "meals",
        "expense_date": "2024-06-01",
        "status": "pending",
    }
    payload.update(extra)
    resp = client.post("/api/expenses", data=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_chat_without_a_key_says_so_instead_of_failing_opaquely():
    resp = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 424
    assert "OPENAI_KEY" in resp.json()["detail"]


def test_chat_answers_a_question_by_reading_the_ledger(scripted_llm):
    make_expense(vendor="Scripted Cafe", amount="42.00", expense_date="2024-06-02")
    scripted_llm.replies(
        {"tool": "list_expenses", "args": {"q": "Scripted Cafe"}},
        {"reply": "You have one Scripted Cafe expense for USD 42.00."},
    )

    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "any scripted cafe spend?"}]}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reply"].startswith("You have one Scripted Cafe")
    # A read must not tell the UI to refetch, and must not claim an action.
    assert body["changed"] is False
    assert body["actions"] == []
    assert body["pending"] is None

    # The tool result really was handed back to the model.
    second_prompt = scripted_llm.prompts[1]
    assert any("TOOL RESULT list_expenses" in m["content"] for m in second_prompt)
    assert any("Scripted Cafe" in m["content"] for m in second_prompt)


def test_chat_system_prompt_carries_the_category_slugs_and_base_currency(scripted_llm):
    scripted_llm.replies({"reply": "Hello."})
    client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})

    system = scripted_llm.prompts[0][0]
    assert system["role"] == "system"
    # Without the slugs the model has to guess them, and every category
    # argument it sends is rejected.
    assert "meals:" in system["content"]
    assert "base display currency" in system["content"]


def test_chat_creates_an_expense_and_reports_it(scripted_llm):
    scripted_llm.replies(
        {
            "tool": "create_expense",
            "args": {
                "vendor": "Blue Tokai",
                "amount": 350,
                "currency": "INR",
                "category": "meals",
                "expense_date": "2024-06-03",
            },
        },
        {"reply": "Logged Blue Tokai for INR 350."},
    )

    resp = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "log 350 rupees at blue tokai"}]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["changed"] is True
    assert body["actions"] == ["Added Blue Tokai — INR 350.00"]

    listed = client.get("/api/expenses", params={"q": "Blue Tokai"}).json()
    assert len(listed) == 1
    assert listed[0]["amount"] == pytest.approx(350.0)
    assert listed[0]["currency"] == "INR"


def test_chat_attaches_a_stored_receipt_to_the_expense_it_creates(scripted_llm):
    scripted_llm.replies(
        {
            "tool": "create_expense",
            "args": {
                "vendor": "Uber",
                "amount": 18.4,
                "expense_date": "2024-06-04",
                "attachment_id": "a1",
            },
        },
        {"reply": "Saved your Uber receipt."},
    )

    resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "here's my uber receipt"}],
            "attachments": [
                {
                    "id": "a1",
                    "original_name": "uber.pdf",
                    "content_type": "application/pdf",
                    "object_path": "receipts/1-uber.pdf",
                    "file_url": "https://storage.example/receipts/1-uber.pdf",
                    "draft": {"vendor": "Uber", "amount": 18.4},
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text

    created = client.get("/api/expenses", params={"q": "Uber"}).json()[0]
    assert created["has_receipt"] is True
    assert created["receipt_url"] == "https://storage.example/receipts/1-uber.pdf"
    assert created["receipt_original_name"] == "uber.pdf"

    # The scan's findings have to be in the prompt, or the model has nothing to
    # fill the expense from.
    system = scripted_llm.prompts[0][0]["content"]
    assert 'id "a1"' in system and "uber.pdf" in system


def test_chat_rejects_an_attachment_id_that_was_not_sent(scripted_llm):
    scripted_llm.replies(
        {
            "tool": "create_expense",
            "args": {"vendor": "Phantom Receipt Co", "amount": 1, "attachment_id": "nope"},
        },
        {"reply": "I couldn't find that receipt."},
    )
    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "save it"}]}
    )
    assert resp.status_code == 200
    # The whole call is refused, so no half-saved expense is left behind. (The
    # suite shares one database across tests, so the vendor has to be a name
    # only this test could have written.)
    assert client.get("/api/expenses", params={"q": "Phantom Receipt Co"}).json() == []
    assert any(
        "error: No attachment 'nope'" in m["content"] for m in scripted_llm.prompts[1]
    )


def test_chat_does_not_delete_until_the_user_confirms(scripted_llm):
    expense_id = make_expense(vendor="Deletable", amount="5.00")
    scripted_llm.replies({"tool": "delete_expenses", "args": {"ids": [expense_id]}})

    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "delete the deletable one"}]}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pending"]["tool"] == "delete_expenses"
    assert body["pending"]["args"] == {"ids": [expense_id]}
    assert "Permanently delete 1 expense" in body["pending"]["description"]
    # Nothing happened yet — that is the whole point.
    assert body["changed"] is False
    assert client.get(f"/api/expenses/{expense_id}").status_code == 200


def test_chat_deletes_once_the_user_confirms(scripted_llm):
    expense_id = make_expense(vendor="Confirmed Delete", amount="7.00")
    scripted_llm.replies({"reply": "Deleted Confirmed Delete."})

    resp = client.post(
        "/api/chat",
        json={
            "messages": [
                {"role": "user", "content": "delete it"},
                {"role": "assistant", "content": "Confirm?"},
                {"role": "user", "content": "yes"},
            ],
            "confirm": {
                "tool": "delete_expenses",
                "args": {"ids": [expense_id]},
                "description": "Permanently delete 1 expense and their receipts",
            },
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["changed"] is True
    assert body["actions"] == ["Deleted 1 expense"]
    assert client.get(f"/api/expenses/{expense_id}").status_code == 404


def test_chat_does_not_repeat_a_confirmed_action(scripted_llm):
    """The model often re-proposes the call it was just given the result of.

    Running it again would delete a second time (or double a bulk update), so
    the loop answers with 'already done' instead of dispatching."""
    first = make_expense(vendor="Once Only", amount="9.00")
    second = make_expense(vendor="Survivor", amount="9.00")
    scripted_llm.replies(
        {"tool": "delete_expenses", "args": {"ids": [first]}},
        {"reply": "Deleted Once Only."},
    )

    resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "yes"}],
            "confirm": {
                "tool": "delete_expenses",
                "args": {"ids": [first]},
                "description": "Permanently delete 1 expense and their receipts",
            },
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["actions"] == ["Deleted 1 expense"]
    # The second dispatch never happened, so the other row is untouched.
    assert client.get(f"/api/expenses/{second}").status_code == 200
    assert any("already done" in m["content"] for m in scripted_llm.prompts[1])


def test_chat_bulk_status_change_confirms_then_applies(scripted_llm):
    ids = [make_expense(vendor=f"Bulk {i}", amount="3.00") for i in range(3)]

    scripted_llm.replies({"tool": "bulk_update_status", "args": {"ids": ids, "status": "submitted"}})
    proposed = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "submit the bulk ones"}]}
    ).json()
    assert proposed["pending"]["description"] == "Set 3 expenses to 'submitted'"
    assert all(client.get(f"/api/expenses/{i}").json()["status"] == "pending" for i in ids)

    scripted_llm.replies({"reply": "Marked all three submitted."})
    applied = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "yes"}],
            "confirm": proposed["pending"],
        },
    ).json()
    assert applied["actions"] == ["Updated 3 expenses"]
    assert all(client.get(f"/api/expenses/{i}").json()["status"] == "submitted" for i in ids)


def test_chat_recovers_from_a_rejected_tool_argument(scripted_llm):
    """A validation failure is guidance, not a 500: it goes back to the model."""
    scripted_llm.replies(
        {"tool": "create_expense", "args": {"vendor": "Cafe", "amount": 5, "category": "lunch"}},
        {"tool": "create_expense", "args": {"vendor": "Cafe", "amount": 5, "category": "meals"}},
        {"reply": "Logged it under Meals."},
    )
    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "log a 5 dollar lunch"}]}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reply"] == "Logged it under Meals."
    assert any("Unknown category 'lunch'" in m["content"] for m in scripted_llm.prompts[1])
    assert client.get("/api/expenses", params={"q": "Cafe"}).json()[0]["category"] == "meals"


def test_chat_recovers_from_a_hallucinated_tool_name(scripted_llm):
    scripted_llm.replies(
        {"tool": "refund_everything", "args": {}},
        {"reply": "I can't do that, but I can list your expenses."},
    )
    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "refund everything"}]}
    )
    assert resp.status_code == 200, resp.text
    assert any("no such tool" in m["content"] for m in scripted_llm.prompts[1])


def test_chat_export_returns_a_download_descriptor_not_a_file(scripted_llm):
    make_expense(vendor="Exportable", amount="20.00", expense_date="2024-07-01")
    scripted_llm.replies(
        {"tool": "export_report", "args": {"format": "excel", "date_from": "2024-07-01"}},
        {"reply": "Your Excel report is ready."},
    )
    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "export july as excel"}]}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # "excel" is what a person says; xlsx is what the export route accepts.
    assert body["download"]["format"] == "xlsx"
    assert body["download"]["date_from"] == "2024-07-01"
    # An export reads, so it must not mark the data dirty.
    assert body["changed"] is False

    # The descriptor is exactly what POST /reports/export takes.
    export = client.post("/api/reports/export", json=body["download"])
    assert export.status_code == 200, export.text


def test_chat_export_with_no_matches_goes_back_to_the_model(scripted_llm):
    scripted_llm.replies(
        {"tool": "export_report", "args": {"date_from": "1999-01-01", "date_to": "1999-12-31"}},
        {"reply": "There's nothing recorded in 1999."},
    )
    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "export 1999"}]}
    )
    assert resp.status_code == 200
    assert resp.json()["download"] is None
    assert any("No expenses match" in m["content"] for m in scripted_llm.prompts[1])


def test_chat_summary_omits_the_series_unless_asked(scripted_llm):
    make_expense(vendor="Summary Fodder", amount="11.00")
    scripted_llm.replies(
        {"tool": "get_summary", "args": {}},
        {"reply": "Totals reported."},
    )
    client.post("/api/chat", json={"messages": [{"role": "user", "content": "how much total?"}]})

    result = next(
        m["content"] for m in scripted_llm.prompts[1] if m["content"].startswith("TOOL RESULT")
    )
    assert "total_amount" in result
    # 13 months plus a day series on every question is most of the prompt.
    assert "by_month" not in result and "by_day" not in result


def test_chat_stops_at_the_step_ceiling_without_looping_forever(scripted_llm):
    scripted_llm.replies(*([{"tool": "list_categories", "args": {}}] * app_module("agent").MAX_TOOL_STEPS))
    resp = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "go forever"}]}
    )
    assert resp.status_code == 200, resp.text
    assert "one thing at a time" in resp.json()["reply"]


def test_chat_rejects_a_transcript_that_does_not_end_with_the_user(scripted_llm):
    resp = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hey"}]},
    )
    assert resp.status_code == 422
    assert "last message" in resp.json()["detail"]


def test_chat_survives_a_malformed_model_reply(scripted_llm):
    scripted_llm.queue = ["not json at all"]
    resp = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 502
    assert "malformed" in resp.json()["detail"]


# ------------------------------------------------- category name validation
#
# Two layers: structural rules that always run, and an LLM plausibility check
# that runs only when a key is configured. conftest forces OPENAI_KEY empty, so
# these exercise the structural layer for real and script the model where the
# LLM layer is the thing under test.


def current_categories() -> list[dict]:
    resp = client.get("/api/categories")
    assert resp.status_code == 200
    return resp.json()


def as_payload(categories: list[dict]) -> list[dict]:
    return [{"slug": c["slug"], "label": c["label"], "keywords": c["keywords"]} for c in categories]


@pytest.mark.parametrize(
    "label",
    [
        "dsds",            # the consonant mash that started this
        "sdfgh",
        "asdf",            # keyboard run
        "hjkl",
        "qwerty",
        "aaaa",            # one character repeated
        "x",               # one letter
        "123",             # no letters at all
        "!!!",
        "test",            # placeholder
        "untitled",
    ],
)
def test_categories_reject_names_that_are_not_names(label):
    payload = as_payload(current_categories()) + [{"label": label, "keywords": ["x"]}]
    resp = client.put("/api/categories", json={"categories": payload})
    assert resp.status_code == 422, f"{label!r} was accepted"
    detail = resp.json()["detail"]
    # An object, not a sentence: the editor marks the row it names.
    assert label in detail["message"]
    assert [i["label"] for i in detail["invalid"]] == [label]
    assert detail["invalid"][0]["reason"]
    # And nothing was written.
    assert label not in {c["label"] for c in current_categories()}


@pytest.mark.parametrize(
    "label",
    [
        "Client Gifts",     # ordinary
        "HR",               # two-letter acronym
        "R&D",              # punctuation
        "T&E",
        "COGS",             # vowel-free but an all-caps acronym
        "Q3 Offsite",       # digits
        "여행",              # non-Latin: the vowel rule must not apply
        "Zephyr",           # project codename
    ],
)
def test_categories_accept_real_names_including_acronyms_and_non_latin(label):
    before = current_categories()
    payload = as_payload(before) + [{"label": label, "keywords": ["kw"]}]
    resp = client.put("/api/categories", json={"categories": payload})
    assert resp.status_code == 200, f"{label!r} was rejected: {resp.text}"
    assert label in {c["label"] for c in current_categories()}

    # Put it back so the shared database is unchanged for the next test.
    restore = client.put("/api/categories", json={"categories": as_payload(before)})
    assert restore.status_code == 200, restore.text


def test_categories_reject_a_rename_to_gibberish():
    before = current_categories()
    payload = as_payload(before)
    target = next(c for c in payload if c["slug"] != "other")
    original = target["label"]
    target["label"] = "zxcvb"
    resp = client.put("/api/categories", json={"categories": payload})
    assert resp.status_code == 422
    assert "zxcvb" in resp.json()["detail"]["message"]
    # The rename did not land.
    assert original in {c["label"] for c in current_categories()}


def test_categories_do_not_recheck_names_that_are_not_changing(scripted_llm):
    """An already-stored odd name must not block edits elsewhere.

    Otherwise a category saved before this rule existed would fail every
    future save and the user could not save their way out of it. The stored
    name is planted past the route (the model is scripted to allow it), which
    is exactly how a pre-existing row looks. It has to be a name the structural
    rules let through — those are not scriptable — so this uses one only the
    model would object to."""
    before = current_categories()

    scripted_llm.replies({"invalid": []})
    planted_payload = as_payload(before) + [{"label": "Blorp Zindle", "keywords": ["kw"]}]
    assert client.put("/api/categories", json={"categories": planted_payload}).status_code == 200
    planted = next(c for c in current_categories() if c["label"] == "Blorp Zindle")

    # Now edit a DIFFERENT category. "Blorp Zindle" is passing through unchanged, so
    # it must not be submitted for checking at all.
    scripted_llm.replies({"invalid": []})
    payload = as_payload(current_categories())
    other = next(c for c in payload if c["slug"] not in (planted["slug"], "other"))
    other["keywords"] = [*other["keywords"], "extra-keyword"]
    resp = client.put("/api/categories", json={"categories": payload})
    assert resp.status_code == 200, resp.text
    assert "Blorp Zindle" in {c["label"] for c in current_categories()}
    # The only name sent for judgement is one that changed — and the
    # keyword-only edit changed no name at all, so nothing was sent.
    assert scripted_llm.name_checks() == []

    # But renaming it IS checked, structurally, with no model needed.
    payload = as_payload(current_categories())
    stale = next(c for c in payload if c["slug"] == planted["slug"])
    stale["label"] = "qwert"
    assert client.put("/api/categories", json={"categories": payload}).status_code == 422

    # Clean up: drop the planted row and restore the original set.
    restore = client.put("/api/categories", json={"categories": as_payload(before)})
    assert restore.status_code == 200, restore.text
    assert {c["slug"] for c in current_categories()} == {c["slug"] for c in before}


def test_category_name_check_uses_the_llm_when_a_key_is_configured(scripted_llm):
    """The structural rules cannot judge meaning; this layer can.

    "Blorp Zindle" is well-formed — vowels, two words, no keyboard run — so only
    the model can say it is not a category."""
    before = current_categories()
    scripted_llm.replies(
        {"invalid": [{"label": "Blorp Zindle", "reason": "not a recognisable kind of spend"}]}
    )
    payload = as_payload(before) + [{"label": "Blorp Zindle", "keywords": ["kw"]}]
    resp = client.put("/api/categories", json={"categories": payload})
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["invalid"] == [
        {"label": "Blorp Zindle", "reason": "not a recognisable kind of spend"}
    ]
    # Only the new name was sent for judgement, not the whole set.
    assert scripted_llm.name_checks() == [["Blorp Zindle"]]
    assert {c["slug"] for c in current_categories()} == {c["slug"] for c in before}


def test_category_name_check_ignores_a_verdict_about_a_name_it_never_sent(scripted_llm):
    """A hallucinated extra entry must not block a save."""
    before = current_categories()
    scripted_llm.replies({"invalid": [{"label": "Travel", "reason": "made this up"}]})
    payload = as_payload(before) + [{"label": "Team Lunches", "keywords": ["kw"]}]
    resp = client.put("/api/categories", json={"categories": payload})
    assert resp.status_code == 200, resp.text
    assert client.put("/api/categories", json={"categories": as_payload(before)}).status_code == 200


def test_category_name_check_lets_the_save_through_when_the_model_fails(scripted_llm, monkeypatch):
    """The check catches nonsense; it is not an availability dependency."""
    before = current_categories()

    def boom(*args, **kwargs):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(app_module("llm"), "call_openai", boom)
    payload = as_payload(before) + [{"label": "Conference Fees", "keywords": ["kw"]}]
    resp = client.put("/api/categories", json={"categories": payload})
    assert resp.status_code == 200, resp.text
    assert client.put("/api/categories", json={"categories": as_payload(before)}).status_code == 200


def test_chat_cannot_create_a_junk_category_either(scripted_llm):
    """The assistant's save_categories goes through the same handler, so the
    name check covers it too — a confirmed chat action included."""
    before = current_categories()
    scripted_llm.replies({"reply": "I couldn't add that."})
    resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "yes"}],
            "confirm": {
                "tool": "save_categories",
                "args": {
                    "categories": [
                        *[{"slug": c["slug"], "label": c["label"], "keywords": c["keywords"]} for c in before],
                        {"label": "asdfg", "keywords": ["x"]},
                    ]
                },
                "description": "Replace the category set",
            },
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The tool was refused, so nothing is claimed as done and nothing changed.
    assert body["actions"] == []
    assert body["changed"] is False
    assert "asdfg" not in {c["label"] for c in current_categories()}
    assert any("asdfg" in m["content"] for m in scripted_llm.prompts[0])
