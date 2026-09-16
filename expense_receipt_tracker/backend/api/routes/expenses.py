"""Expense CRUD, list/filter, summary stats, and receipt file serving.

GET    /expenses            list, filterable by category/status/date range/q
GET    /expenses/summary    dashboard stat totals (must stay registered
                             before the /{expense_id} routes below, or the
                             literal "summary" segment matches the dynamic
                             path param instead)
POST   /expenses            create (multipart — fields + optional receipt)
GET    /expenses/{id}       one expense
PUT    /expenses/{id}       partial update (JSON)
DELETE /expenses/{id}       delete (and its stored receipt file, if any)
GET    /expenses/{id}/receipt   stream the stored receipt file

All rows are org-scoped by the platform via row-level security on `ctx.db`, so
these handlers never filter by organization_id — they just set it on insert.
"""

from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select

from ..core.category_store import valid_slugs
from ..core.fx import convert
from ..core.models import STATUSES, Expense
from ..core.palette import PluginContext, get_plugin_context, require_permission
from ..core.settings_store import get_base_currency
from ..core.storage import delete_receipt, receipt_path, save_receipt

router = APIRouter(tags=["expenses"])

RECEIPT_EXTS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}


async def _validate_category(ctx: PluginContext, category: str) -> None:
    if category not in await valid_slugs(ctx):
        raise HTTPException(status_code=422, detail=f"Unknown category '{category}'.")


def _validate_status(status: str) -> None:
    if status not in STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status '{status}'.")


def _parse_date(value: str) -> date_type:
    try:
        return date_type.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates must be in YYYY-MM-DD format.")


# How many calendar months GET /expenses/summary reports. 13 = the current month
# plus twelve prior: twelve bars for the dashboard chart, and one extra month of
# baseline so the oldest bar still has something to be compared against.
BY_MONTH_WINDOW = 13


def _month_key(d: date_type) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _recent_month_keys(today: date_type, count: int = BY_MONTH_WINDOW) -> list[str]:
    """The `count` calendar months ending with `today`'s, oldest first.

    Months with no activity are emitted as zero buckets rather than omitted, for
    two reasons. The chart needs a fixed x-axis — dropping an idle month would
    butt March against January and draw a shape that never happened. And a
    month-over-month delta needs "last month" to mean the actual previous
    calendar month; if an idle month were missing, the delta would silently
    compare against two months ago while still calling it "last month".
    """
    keys: list[str] = []
    year, month = today.year, today.month
    for _ in range(count):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    keys.reverse()
    return keys


# Status sorts in WORKFLOW order, not alphabetically. Alphabetical would give
# pending -> reimbursed -> submitted, which is meaningless to someone watching an
# expense move through the flow. Mirrored client-side so both agree.
_STATUS_RANK = case(
    (Expense.status == "pending", 0),
    (Expense.status == "submitted", 1),
    (Expense.status == "reimbursed", 2),
    else_=3,
)

# Sortable columns, keyed by the value the client sends. Vendor/category sort on
# lower() so ordering is case-insensitive and stable across backends.
SORT_COLUMNS = {
    "date": Expense.expense_date,
    "amount": Expense.amount,
    "vendor": func.lower(Expense.vendor),
    "status": _STATUS_RANK,
    "category": func.lower(Expense.category),
}


def _search_clause(q: str):
    """Case-insensitive substring match on vendor OR notes, as a SQL predicate.

    This used to run in Python *after* the query returned every row, which made
    `limit`/`offset` impossible to honour correctly — a page could come back
    short because rows were dropped after the database had already applied the
    window. Doing it in SQL keeps paging truthful.

    LIKE metacharacters are escaped so a search for "50%" stays a literal
    search, matching the old `needle in text` behaviour exactly.
    """
    needle = q.strip().lower()
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    return or_(
        func.lower(Expense.vendor).like(pattern, escape="\\"),
        func.lower(func.coalesce(Expense.notes, "")).like(pattern, escape="\\"),
    )


@router.get("/expenses", dependencies=[require_permission("resources:read")])
async def list_expenses(
    category: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sort: str = "date",
    order: str = "desc",
    limit: Optional[int] = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
    ctx: PluginContext = Depends(get_plugin_context),
) -> list[dict]:
    """List expenses, filtered/sorted/paged.

    `sort`, `order`, `limit` and `offset` are additive: their defaults reproduce
    the original behaviour (newest expense_date first, then newest created_at,
    no window), so callers that omit them are unaffected.
    """
    if sort not in SORT_COLUMNS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown sort '{sort}'. Expected one of: {', '.join(sorted(SORT_COLUMNS))}.",
        )
    if order not in ("asc", "desc"):
        raise HTTPException(status_code=422, detail="Order must be 'asc' or 'desc'.")

    stmt = select(Expense)
    if category and category != "all":
        stmt = stmt.where(Expense.category == category)
    if status and status != "all":
        stmt = stmt.where(Expense.status == status)
    if date_from:
        stmt = stmt.where(Expense.expense_date >= _parse_date(date_from))
    if date_to:
        stmt = stmt.where(Expense.expense_date <= _parse_date(date_to))
    if q and q.strip():
        stmt = stmt.where(_search_clause(q))

    column = SORT_COLUMNS[sort]
    direction = column.asc() if order == "asc" else column.desc()
    # A sort column alone is not a total order, so limit/offset could repeat or
    # skip a row whenever values tie. created_at then id makes paging
    # deterministic.
    stmt = stmt.order_by(direction, Expense.created_at.desc(), Expense.id.asc())

    if offset:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)

    expenses = list((await ctx.db.execute(stmt)).scalars().all())
    return [e.to_dict() for e in expenses]


@router.get("/expenses/summary", dependencies=[require_permission("resources:read")])
async def expenses_summary(
    date_from: Optional[str] = Query(None, description="Inclusive lower bound, YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="Inclusive upper bound, YYYY-MM-DD"),
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict:
    """Dashboard totals, expressed in the org's base currency.

    Each expense is converted from its own currency into the base currency using
    the exchange rate for that expense's date, so mixing currencies (e.g. an INR
    receipt and a USD one) produces a correct single-currency total rather than
    naively adding raw amounts. Conversion is skipped for expenses already in the
    base currency, so a single-currency install never hits the network.

    `date_from`/`date_to` narrow the window, which is what lets the dashboard's
    calendar filter the figures: the conversion has to happen server-side, so a
    client cannot correctly total a date range of mixed currencies on its own.
    Both are optional and omitting them keeps the all-time behaviour.

    Note for callers: `by_month` is still the last 13 calendar months, but it
    only counts rows inside the window, so a month-over-month delta derived from
    a filtered response is not meaningful. The dashboard hides its delta chips
    while a range is active."""
    base_currency = await get_base_currency(ctx)
    stmt = select(Expense)
    if date_from:
        stmt = stmt.where(Expense.expense_date >= _parse_date(date_from))
    if date_to:
        stmt = stmt.where(Expense.expense_date <= _parse_date(date_to))
    expenses = list((await ctx.db.execute(stmt)).scalars().all())
    by_category: dict[str, dict] = {}
    # UTC, matching fx._today(), so the window and the bucketing agree with the
    # clock the exchange rates were fetched against.
    today = datetime.now(timezone.utc).date()
    by_month: dict[str, dict] = {
        key: {
            "month": key,
            "amount": 0.0,
            "count": 0,
            "reimbursed_amount": 0.0,
            "approximate": False,
        }
        for key in _recent_month_keys(today)
    }
    # Per-DAY totals, for the dashboard's range chart. Only built when a window
    # was given: unbounded it would be one entry per day the org has ever
    # recorded, on a response the dashboard fetches on every load. Days with no
    # activity are omitted rather than zero-filled — a window is chosen by
    # clicking two days that HAVE expenses, and a Jun->Sep pick would otherwise
    # be ~84 bars of which two are non-zero.
    windowed = bool(date_from or date_to)
    by_day: dict[str, dict] = {}
    total_amount = pending_amount = reimbursed_amount = 0.0
    pending_count = reimbursed_count = 0
    approximate = False
    converted_from: set[str] = set()
    for e in expenses:
        amount, ok = convert(e.amount, e.currency, base_currency, e.expense_date)
        if not ok:
            approximate = True
        elif (e.currency or base_currency).upper() != base_currency.upper():
            converted_from.add((e.currency or base_currency).upper())
        total_amount += amount
        if windowed:
            day_key = e.expense_date.isoformat()
            day_bucket = by_day.setdefault(
                day_key, {"day": day_key, "amount": 0.0, "count": 0, "approximate": False}
            )
            day_bucket["amount"] += amount
            day_bucket["count"] += 1
            if not ok:
                day_bucket["approximate"] = True
        month_bucket = by_month.get(_month_key(e.expense_date))
        if month_bucket is not None:
            month_bucket["amount"] += amount
            month_bucket["count"] += 1
            if e.status == "reimbursed":
                month_bucket["reimbursed_amount"] += amount
            # Flagged per-month as well as globally: a delta computed against a
            # month that swallowed an unconvertible raw amount is wrong in a way
            # the chip can localise — it can caveat or hide itself without the
            # whole dashboard going approximate.
            if not ok:
                month_bucket["approximate"] = True
        bucket = by_category.setdefault(e.category, {"category": e.category, "amount": 0.0, "count": 0})
        bucket["amount"] += amount
        bucket["count"] += 1
        if e.status in ("pending", "submitted"):
            pending_amount += amount
            pending_count += 1
        elif e.status == "reimbursed":
            reimbursed_amount += amount
            reimbursed_count += 1
    for bucket in by_category.values():
        bucket["amount"] = round(bucket["amount"], 2)
    for day_bucket in by_day.values():
        day_bucket["amount"] = round(day_bucket["amount"], 2)
    for month_bucket in by_month.values():
        month_bucket["amount"] = round(month_bucket["amount"], 2)
        month_bucket["reimbursed_amount"] = round(month_bucket["reimbursed_amount"], 2)
    return {
        "base_currency": base_currency,
        # True when at least one expense was recorded in a currency other than
        # the base and had to be converted (the dashboard shows a note then).
        "converted": bool(converted_from),
        "converted_from": sorted(converted_from),
        # True when some currency couldn't be converted at all (no live or
        # fallback rate) — its raw amount was added, so the total is approximate.
        "approximate": approximate,
        "total_count": len(expenses),
        "total_amount": round(total_amount, 2),
        "pending_amount": round(pending_amount, 2),
        "pending_count": pending_count,
        "reimbursed_amount": round(reimbursed_amount, 2),
        "reimbursed_count": reimbursed_count,
        "by_category": sorted(by_category.values(), key=lambda b: -b["amount"]),
        # The last BY_MONTH_WINDOW calendar months ending with the current one,
        # oldest first, always exactly that many entries. Amounts are in
        # base_currency. Expenses older than the window — and future-dated ones —
        # are excluded here but still counted in total_amount, so these do NOT
        # sum to total_amount. Never derive a total from them.
        #
        # This is computed per request rather than stored on the row because the
        # value is FX-derived and base-currency-dependent: changing the org's
        # base currency in settings would silently invalidate every stored number.
        "by_month": list(by_month.values()),
        # Ascending by date, days with activity only, amounts in base_currency.
        # Absent (empty) unless date_from/date_to narrowed the request.
        "by_day": [by_day[k] for k in sorted(by_day)],
    }


class BulkStatusUpdate(BaseModel):
    ids: list[str]
    status: str


@router.post("/expenses/bulk-status", dependencies=[require_permission("resources:write")])
async def bulk_update_status(
    payload: BulkStatusUpdate, ctx: PluginContext = Depends(get_plugin_context)
) -> dict:
    """Set the same status on many expenses at once (bulk status page). Rows are
    org-scoped by RLS, so ids from another org simply match nothing."""
    if not payload.ids:
        raise HTTPException(status_code=422, detail="No expenses selected.")
    _validate_status(payload.status)

    stmt = select(Expense).where(Expense.id.in_(payload.ids))
    expenses = list((await ctx.db.execute(stmt)).scalars().all())
    for expense in expenses:
        expense.status = payload.status
    if expenses:
        await ctx.db.commit()
    return {"updated": len(expenses)}


@router.post("/expenses", status_code=201, dependencies=[require_permission("resources:write")])
async def create_expense(
    vendor: str = Form(...),
    amount: float = Form(...),
    currency: str = Form("USD"),
    category: str = Form("other"),
    expense_date: str = Form(...),
    status: str = Form("pending"),
    notes: Optional[str] = Form(None),
    receipt: Optional[UploadFile] = File(None),
    # Durable-storage path: the frontend uploads the receipt to platform storage
    # (palette.storage) first and passes the resulting reference here, so the
    # file survives server restarts instead of living on the local disk. When
    # these are absent we fall back to saving the uploaded `receipt` locally.
    receipt_object_path: Optional[str] = Form(None),
    receipt_url: Optional[str] = Form(None),
    receipt_original_name: Optional[str] = Form(None),
    receipt_content_type: Optional[str] = Form(None),
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict:
    if amount < 0:
        raise HTTPException(status_code=422, detail="Amount can't be negative.")
    await _validate_category(ctx, category)
    _validate_status(status)
    parsed_date = _parse_date(expense_date)

    expense = Expense(
        organization_id=ctx.organization_id,
        vendor=vendor.strip()[:200] or "Unknown vendor",
        amount=amount,
        currency=(currency or "USD").strip()[:8] or "USD",
        category=category,
        expense_date=parsed_date,
        status=status,
        notes=(notes or None),
    )

    if receipt_object_path:
        # Receipt already persisted in durable platform storage.
        expense.receipt_object_path = receipt_object_path.strip()[:512]
        expense.receipt_url = (receipt_url or None)
        expense.receipt_original_name = (receipt_original_name or "receipt")[:255]
        expense.receipt_content_type = (receipt_content_type or "application/octet-stream")[:100]
    elif receipt is not None and receipt.filename:
        ext = Path(receipt.filename).suffix.lower()
        if ext not in RECEIPT_EXTS:
            raise HTTPException(status_code=422, detail=f"Unsupported receipt file type '{ext}'.")
        stored, original, content_type = await save_receipt(receipt)
        expense.receipt_filename = stored
        expense.receipt_original_name = original
        expense.receipt_content_type = content_type

    ctx.db.add(expense)
    await ctx.db.commit()
    await ctx.db.refresh(expense)
    return expense.to_dict()


class ExpenseUpdate(BaseModel):
    vendor: Optional[str] = None
    amount: Optional[float] = Field(None, ge=0)
    currency: Optional[str] = None
    category: Optional[str] = None
    expense_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/expenses/{expense_id}", dependencies=[require_permission("resources:read")])
async def get_expense(expense_id: str, ctx: PluginContext = Depends(get_plugin_context)) -> dict:
    expense = await ctx.db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found.")
    return expense.to_dict()


@router.put("/expenses/{expense_id}", dependencies=[require_permission("resources:write")])
async def update_expense(
    expense_id: str, payload: ExpenseUpdate, ctx: PluginContext = Depends(get_plugin_context)
) -> dict:
    expense = await ctx.db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found.")

    data = payload.model_dump(exclude_unset=True)
    if "category" in data and data["category"] is not None:
        await _validate_category(ctx, data["category"])
    if "status" in data and data["status"] is not None:
        _validate_status(data["status"])
    if data.get("expense_date"):
        data["expense_date"] = _parse_date(data["expense_date"])
    if data.get("vendor"):
        data["vendor"] = data["vendor"].strip()[:200] or expense.vendor

    for key, value in data.items():
        setattr(expense, key, value)

    await ctx.db.commit()
    await ctx.db.refresh(expense)
    return expense.to_dict()


@router.delete("/expenses/{expense_id}", status_code=204, dependencies=[require_permission("resources:write")])
async def delete_expense(expense_id: str, ctx: PluginContext = Depends(get_plugin_context)) -> None:
    expense = await ctx.db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found.")
    delete_receipt(expense.receipt_filename)
    await ctx.db.delete(expense)
    await ctx.db.commit()


@router.get("/expenses/{expense_id}/receipt", dependencies=[require_permission("resources:read")])
async def get_expense_receipt(
    expense_id: str, ctx: PluginContext = Depends(get_plugin_context)
) -> Response:
    expense = await ctx.db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="No receipt on file for this expense.")
    # Durable-storage receipt: hand the caller the platform storage URL.
    if expense.receipt_url:
        return RedirectResponse(url=expense.receipt_url)
    if not expense.receipt_filename:
        raise HTTPException(status_code=404, detail="No receipt on file for this expense.")
    path = receipt_path(expense.receipt_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Receipt file is missing on disk.")
    return FileResponse(
        path=path,
        media_type=expense.receipt_content_type or "application/octet-stream",
        filename=expense.receipt_original_name or path.name,
        headers={"Access-Control-Expose-Headers": "Content-Disposition"},
    )
