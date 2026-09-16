"""The chat agent's tool catalogue.

Every operation the app's own screens can perform is exposed here as a named,
documented, JSON-argument callable, so "do it by chat" and "do it by clicking"
go through exactly the same code.

That last point is the whole design rule of this module: a tool **calls the
route handler**, it does not reimplement it. The handlers are plain async
functions that take `ctx`, so they are callable directly, and routing through
them means the chat path inherits every validation, currency conversion,
category check, receipt-file cleanup and commit the UI path has. A second
implementation would drift, and the ways it drifts are exactly the ways that
matter: a chat-created expense with an unknown category, or a chat delete that
leaves the receipt file behind.

The cost of that choice is the one piece of ugliness below: the handlers declare
their defaults as FastAPI `Form(...)`/`Query(...)` markers, which are only
resolved when FastAPI itself calls them. Calling one from Python means passing
**every** parameter explicitly — omit one and the handler receives a
`FormInfo` object where it expected a string. Each call site therefore lists all
arguments, including the ones that are just the documented default.

## Confirmation

`confirm=True` means the agent may not run the tool on its own. The route hands
the proposed call back to the UI, which shows it and waits for the user to press
Confirm. The rule for which tools carry it: anything **irreversible**, or
anything that **touches more than one record**. So deleting expenses, rewriting
the category set (which also re-categorises every existing expense) and bulk
status changes all confirm; creating one expense, editing one expense and
changing the display currency do not — those are single, visible, reversible
edits, and putting a confirm step in front of them would make the chat slower
than the form it replaces.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type, datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException

from ..routes.categories import CategoriesUpdate, CategoryInput, apply_categories, get_categories
from ..routes.expenses import (
    BulkStatusUpdate,
    ExpenseUpdate,
    bulk_update_status,
    create_expense,
    delete_expense,
    expenses_summary,
    get_expense,
    list_expenses,
    update_expense,
)
from ..routes.settings import SettingsUpdate, read_settings, update_settings
from .models import STATUSES
from .settings_store import get_base_currency

# How many expenses a single `list_expenses` call may return.
#
# The result is serialised into the next prompt, so an unbounded list is both a
# token bill and a way to push the actual conversation out of the context
# window. 25 is the default page; the agent can ask for more, up to 100, when
# the user explicitly wants a long list.
DEFAULT_LIST_LIMIT = 25
MAX_LIST_LIMIT = 100

# Report formats POST /reports/export accepts.
EXPORT_FORMATS = ("csv", "xlsx", "pdf")


@dataclass
class ToolEnv:
    """Request-scoped extras a tool may need beyond `ctx`.

    `attachments` are receipts the user attached to *this* message. The frontend
    has already scanned them (POST /receipts/scan) and uploaded them to durable
    platform storage, so each entry carries both the storage reference and the
    fields the scan read. The agent refers to one by its `id` when creating an
    expense, which is what makes "here's my taxi receipt, log it" a single turn.
    """

    attachments: dict[str, dict] = field(default_factory=dict)
    base_currency: str = "USD"
    today: date_type = field(default_factory=lambda: datetime.now(timezone.utc).date())


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    # JSON-schema-shaped, but only ever read by the model: the loop validates
    # by handing the arguments to the route handler and reporting whatever it
    # raises, rather than duplicating the handler's rules in a schema.
    params: dict[str, str]
    run: Callable[[Any, dict, ToolEnv], Awaitable[Any]]
    writes: bool = False
    confirm: bool = False
    # One-line, past-tense, user-facing summary of a completed call. The chat UI
    # shows these under the reply so a write is never invisible.
    summary: Optional[Callable[[dict, Any], str]] = None


# --------------------------------------------------------------- arg helpers


def _str(args: dict, key: str, default: Optional[str] = None) -> Optional[str]:
    value = args.get(key)
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def _require_str(args: dict, key: str) -> str:
    value = _str(args, key)
    if not value:
        raise HTTPException(status_code=422, detail=f"'{key}' is required.")
    return value


def _ids(args: dict, key: str = "ids") -> list[str]:
    raw = args.get(key)
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail=f"'{key}' must be a list of expense ids.")
    ids = [str(i).strip() for i in raw if str(i).strip()]
    if not ids:
        raise HTTPException(status_code=422, detail="No expenses were named.")
    return ids


def _amount(args: dict, key: str = "amount") -> float:
    raw = args.get(key)
    if raw is None or raw == "":
        raise HTTPException(status_code=422, detail="'amount' is required.")
    try:
        # Models like to write money with the symbol and separators attached.
        # Stripping them here beats bouncing the call back for a re-read.
        cleaned = str(raw).replace(",", "").strip().lstrip("$€£₹¥")
        return float(cleaned)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"'{raw}' is not a number.")


def _limit(args: dict) -> int:
    try:
        value = int(args.get("limit") or DEFAULT_LIST_LIMIT)
    except (TypeError, ValueError):
        value = DEFAULT_LIST_LIMIT
    return max(1, min(value, MAX_LIST_LIMIT))


def _compact(expense: dict) -> dict:
    """An expense as the agent needs to see it.

    Drops the receipt plumbing (`receipt_url`, content type, created/updated
    timestamps) and trims notes. Those fields are never the answer to a
    question the user asks in chat, and every one of them is repeated in the
    prompt on the next step of the loop.
    """
    notes = expense.get("notes") or ""
    return {
        "id": expense["id"],
        "vendor": expense["vendor"],
        "amount": expense["amount"],
        "currency": expense["currency"],
        "category": expense["category"],
        "date": expense["expense_date"],
        "status": expense["status"],
        "has_receipt": expense["has_receipt"],
        **({"notes": notes[:200]} if notes else {}),
    }


# -------------------------------------------------------------------- reads


async def _tool_list_expenses(ctx: Any, args: dict, env: ToolEnv) -> dict:
    rows = await list_expenses(
        category=_str(args, "category"),
        status=_str(args, "status"),
        q=_str(args, "q"),
        date_from=_str(args, "date_from"),
        date_to=_str(args, "date_to"),
        sort=_str(args, "sort", "date") or "date",
        order=_str(args, "order", "desc") or "desc",
        limit=_limit(args),
        offset=0,
        ctx=ctx,
    )
    return {"count": len(rows), "expenses": [_compact(r) for r in rows]}


async def _tool_get_summary(ctx: Any, args: dict, env: ToolEnv) -> dict:
    summary = await expenses_summary(
        date_from=_str(args, "date_from"),
        date_to=_str(args, "date_to"),
        ctx=ctx,
    )
    # by_day is one entry per active day and by_month is thirteen; the agent
    # answers "how much did I spend" from the totals, so the series are dropped
    # unless a window was asked for, in which case by_month is the useful shape.
    trimmed = {k: v for k, v in summary.items() if k not in ("by_day", "by_month")}
    if args.get("include_monthly"):
        trimmed["by_month"] = [
            {"month": m["month"], "amount": m["amount"], "count": m["count"]}
            for m in summary.get("by_month", [])
        ]
    return trimmed


async def _tool_list_categories(ctx: Any, args: dict, env: ToolEnv) -> Any:
    return await get_categories(ctx=ctx)


async def _tool_get_settings(ctx: Any, args: dict, env: ToolEnv) -> dict:
    settings = await read_settings(ctx=ctx)
    return {"base_currency": settings.base_currency, "statuses": list(STATUSES)}


async def _tool_export_report(ctx: Any, args: dict, env: ToolEnv) -> dict:
    """Prepare a report download rather than returning the file itself.

    The chat response is JSON, so a 2 MB PDF cannot travel in it. Instead this
    validates the filters against the same handler the history list uses and
    returns a descriptor; the UI turns that into a Download button which calls
    POST /reports/export exactly as the Reports page does. The user gets the
    file from their own click, which is also the only way a browser will let a
    download start.
    """
    fmt = (_str(args, "format", "csv") or "csv").lower()
    if fmt in ("excel", "xls", "spreadsheet"):
        fmt = "xlsx"
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(
            status_code=422, detail=f"format must be one of: {', '.join(EXPORT_FORMATS)}."
        )

    filters = {
        "category": _str(args, "category"),
        "status": _str(args, "status"),
        "date_from": _str(args, "date_from"),
        "date_to": _str(args, "date_to"),
    }
    # Same filter semantics as the export route, because it is the same code
    # path the export route's query is built from.
    matching = await list_expenses(
        category=filters["category"],
        status=filters["status"],
        q=None,
        date_from=filters["date_from"],
        date_to=filters["date_to"],
        sort="date",
        order="asc",
        limit=None,
        offset=0,
        ctx=ctx,
    )
    if not matching:
        # Mirrors the route's own 422 so the agent hears about it here, while it
        # can still widen the filters, instead of after the user clicks.
        raise HTTPException(status_code=422, detail="No expenses match this report's filters.")

    return {
        "download": {
            "format": fmt,
            "title": _str(args, "title", "Reimbursement Report") or "Reimbursement Report",
            **{k: v for k, v in filters.items() if v},
        },
        "expense_count": len(matching),
    }


# ------------------------------------------------------------------- writes


async def _tool_create_expense(ctx: Any, args: dict, env: ToolEnv) -> dict:
    attachment_id = _str(args, "attachment_id")
    attachment = env.attachments.get(attachment_id) if attachment_id else None
    if attachment_id and attachment is None:
        raise HTTPException(
            status_code=422,
            detail=f"No attachment '{attachment_id}' on this message. Available: "
            + (", ".join(env.attachments) or "none"),
        )

    created = await create_expense(
        vendor=_require_str(args, "vendor"),
        amount=_amount(args),
        # An org that tracks in INR almost never means USD when it omits the
        # currency, so the base currency is the default here — unlike the form,
        # where the visible select carries USD.
        currency=(_str(args, "currency", env.base_currency) or env.base_currency).upper(),
        category=_str(args, "category", "other") or "other",
        # "add a 12 dollar coffee" means today. The form has a visible date
        # picker to disagree with; chat does not, so default and say so.
        expense_date=_str(args, "expense_date", env.today.isoformat()) or env.today.isoformat(),
        status=_str(args, "status", "pending") or "pending",
        notes=_str(args, "notes"),
        receipt=None,
        receipt_object_path=(attachment or {}).get("object_path"),
        receipt_url=(attachment or {}).get("file_url"),
        receipt_original_name=(attachment or {}).get("original_name"),
        receipt_content_type=(attachment or {}).get("content_type"),
        ctx=ctx,
    )
    return _compact(created)


async def _tool_update_expense(ctx: Any, args: dict, env: ToolEnv) -> dict:
    expense_id = _require_str(args, "expense_id")
    fields = {
        key: args[key]
        for key in ("vendor", "amount", "currency", "category", "expense_date", "status", "notes")
        if key in args and args[key] is not None
    }
    if not fields:
        raise HTTPException(status_code=422, detail="Name at least one field to change.")
    if "amount" in fields:
        fields["amount"] = _amount(fields)
    if "currency" in fields:
        fields["currency"] = str(fields["currency"]).strip().upper()
    updated = await update_expense(
        expense_id=expense_id,
        # exclude_unset in the handler is what makes this a partial update, so
        # the model must be constructed from the named fields only.
        payload=ExpenseUpdate(**fields),
        ctx=ctx,
    )
    return _compact(updated)


async def _tool_delete_expenses(ctx: Any, args: dict, env: ToolEnv) -> dict:
    ids = _ids(args)
    deleted: list[dict] = []
    missing: list[str] = []
    for expense_id in ids:
        try:
            # Read it first so the reply can name what went, not just a count —
            # this is the one tool whose result the user cannot go and check.
            existing = await get_expense(expense_id=expense_id, ctx=ctx)
        except HTTPException:
            missing.append(expense_id)
            continue
        await delete_expense(expense_id=expense_id, ctx=ctx)
        deleted.append({"id": expense_id, "vendor": existing["vendor"], "amount": existing["amount"]})
    return {"deleted": len(deleted), "expenses": deleted, "not_found": missing}


async def _tool_bulk_update_status(ctx: Any, args: dict, env: ToolEnv) -> dict:
    return await bulk_update_status(
        payload=BulkStatusUpdate(ids=_ids(args), status=_require_str(args, "status")),
        ctx=ctx,
    )


async def _tool_save_categories(ctx: Any, args: dict, env: ToolEnv) -> dict:
    """Replace the whole category set.

    PUT /categories is a full replacement, not a patch: any existing category
    absent from the payload is deleted (except the protected `other`) and every
    expense is then re-categorised. So the agent has to send the complete list,
    which is why the prompt tells it to read `list_categories` first and why
    this tool confirms.
    """
    raw = args.get("categories")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(
            status_code=422,
            detail="'categories' must be the complete list of categories to keep.",
        )
    items: list[CategoryInput] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=422, detail="Each category must be an object.")
        keywords = entry.get("keywords") or []
        if isinstance(keywords, str):
            keywords = [k.strip() for k in keywords.split(",") if k.strip()]
        items.append(
            CategoryInput(
                slug=_str(entry, "slug"),
                label=_require_str(entry, "label"),
                keywords=[str(k) for k in keywords],
            )
        )
    result = await apply_categories(payload=CategoriesUpdate(categories=items), ctx=ctx)
    return {
        "categories": [{"slug": c["slug"], "label": c["label"]} for c in result["categories"]],
        "recategorized": result["recategorized"],
    }


async def _tool_set_base_currency(ctx: Any, args: dict, env: ToolEnv) -> dict:
    settings = await update_settings(
        payload=SettingsUpdate(base_currency=_require_str(args, "base_currency")), ctx=ctx
    )
    return {"base_currency": settings.base_currency}


# ---------------------------------------------------------------- catalogue


def _plural(count: int, one: str, many: str) -> str:
    return one if count == 1 else many.format(count=count)


TOOLS: dict[str, Tool] = {
    t.name: t
    for t in (
        Tool(
            name="list_expenses",
            description=(
                "List and search expenses. This is also how you look an expense up before "
                "editing or deleting it — every other tool needs its id."
            ),
            params={
                "category": "category slug, or omit for all",
                "status": f"one of {', '.join(STATUSES)}, or omit for all",
                "q": "case-insensitive substring matched against vendor and notes",
                "date_from": "inclusive YYYY-MM-DD",
                "date_to": "inclusive YYYY-MM-DD",
                "sort": "date | amount | vendor | status | category (default date)",
                "order": "asc | desc (default desc)",
                "limit": f"1-{MAX_LIST_LIMIT} (default {DEFAULT_LIST_LIMIT})",
            },
            run=_tool_list_expenses,
        ),
        Tool(
            name="get_summary",
            description=(
                "Totals for the whole ledger or a date window, converted into the org's base "
                "currency. Use this for 'how much have I spent', outstanding reimbursements, "
                "and per-category breakdowns — never add up raw amounts yourself, they can be "
                "in different currencies."
            ),
            params={
                "date_from": "inclusive YYYY-MM-DD",
                "date_to": "inclusive YYYY-MM-DD",
                "include_monthly": "true to also return the last 13 months month by month",
            },
            run=_tool_get_summary,
        ),
        Tool(
            name="list_categories",
            description="The org's expense categories: slug, label and keyword hints.",
            params={},
            run=_tool_list_categories,
        ),
        Tool(
            name="get_settings",
            description="The org's base display currency and the valid expense statuses.",
            params={},
            run=_tool_get_settings,
        ),
        Tool(
            name="create_expense",
            description=(
                "Record one expense. Pass attachment_id to attach a receipt the user sent with "
                "this message. Do not invent a vendor or an amount — ask if either is missing."
            ),
            params={
                "vendor": "required",
                "amount": "required, a number in the expense's own currency",
                "currency": "ISO code; defaults to the org base currency",
                "category": "category slug; defaults to 'other'",
                "expense_date": "YYYY-MM-DD; defaults to today",
                "status": f"one of {', '.join(STATUSES)} (default pending)",
                "notes": "optional",
                "attachment_id": "id of a receipt attached to this message",
            },
            run=_tool_create_expense,
            writes=True,
            summary=lambda args, out: f"Added {out['vendor']} — {out['currency']} {out['amount']:.2f}",
        ),
        Tool(
            name="update_expense",
            description=(
                "Change one expense. Send only the fields that change. Use this for a single "
                "expense's status too; bulk_update_status is for several at once."
            ),
            params={
                "expense_id": "required",
                "vendor": "",
                "amount": "",
                "currency": "",
                "category": "category slug",
                "expense_date": "YYYY-MM-DD",
                "status": f"one of {', '.join(STATUSES)}",
                "notes": "",
            },
            run=_tool_update_expense,
            writes=True,
            summary=lambda args, out: f"Updated {out['vendor']}",
        ),
        Tool(
            name="delete_expenses",
            description=(
                "Permanently delete expenses and their receipts. Look the ids up with "
                "list_expenses first and never guess one."
            ),
            params={"ids": "required, a list of expense ids"},
            run=_tool_delete_expenses,
            writes=True,
            confirm=True,
            summary=lambda args, out: _plural(
                out["deleted"], "Deleted 1 expense", "Deleted {count} expenses"
            ),
        ),
        Tool(
            name="bulk_update_status",
            description="Set the same status on several expenses at once.",
            params={
                "ids": "required, a list of expense ids",
                "status": f"required, one of {', '.join(STATUSES)}",
            },
            run=_tool_bulk_update_status,
            writes=True,
            confirm=True,
            summary=lambda args, out: _plural(
                out["updated"], "Updated 1 expense", "Updated {count} expenses"
            ),
        ),
        Tool(
            name="save_categories",
            description=(
                "Replace the category set. Send the COMPLETE list to keep, not just the change: "
                "anything you leave out is deleted. Read list_categories first and pass each "
                "existing category back with its slug so its expenses stay attached. Applying "
                "this re-categorises every existing expense."
            ),
            params={
                "categories": (
                    "required, the full list: [{slug (omit for a new one), label, keywords: [...]}]"
                )
            },
            run=_tool_save_categories,
            writes=True,
            confirm=True,
            summary=lambda args, out: (
                f"Saved {len(out['categories'])} categories"
                + (f", re-categorised {out['recategorized']} expenses" if out["recategorized"] else "")
            ),
        ),
        Tool(
            name="set_base_currency",
            description="Change the currency every total is displayed in.",
            params={"base_currency": "required, e.g. USD or INR"},
            run=_tool_set_base_currency,
            writes=True,
            summary=lambda args, out: f"Display currency set to {out['base_currency']}",
        ),
        Tool(
            name="export_report",
            description=(
                "Prepare a reimbursement report for the user to download. Returns a download "
                "the UI offers as a button — you cannot send the file yourself."
            ),
            params={
                "format": "csv | xlsx | pdf (default csv)",
                "category": "category slug, or omit for all",
                "status": f"one of {', '.join(STATUSES)}, or omit for all",
                "date_from": "inclusive YYYY-MM-DD",
                "date_to": "inclusive YYYY-MM-DD",
                "title": "report heading",
            },
            run=_tool_export_report,
            summary=lambda args, out: (
                f"Prepared a {out['download']['format'].upper()} report "
                f"({out['expense_count']} expenses)"
            ),
        ),
    )
}


def catalogue_for_prompt() -> list[dict]:
    """The tool list as the system prompt describes it."""
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "args": tool.params,
            **({"needs_confirmation": True} if tool.confirm else {}),
        }
        for tool in TOOLS.values()
    ]


async def tool_env(ctx: Any, attachments: list[dict] | None = None) -> ToolEnv:
    return ToolEnv(
        attachments={a["id"]: a for a in (attachments or []) if a.get("id")},
        base_currency=await get_base_currency(ctx),
        today=datetime.now(timezone.utc).date(),
    )
