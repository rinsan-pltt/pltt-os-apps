"""Bulk import: parse a spreadsheet or PDF statement into draft rows, then
save the ones the user confirmed.

POST /imports/preview   multipart `file` → draft rows, nothing saved yet
POST /imports/commit    JSON `{rows: [...]}` → creates one Expense per row
"""

from __future__ import annotations

from datetime import date as date_type
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..core.categorize import llm_classify_batch
from ..core.category_store import category_dicts, valid_slugs
from ..core.files import cleanup, new_workdir, save_upload
from ..core.imports import SUPPORTED_IMPORT_EXTS, parse_import_file
from ..core.models import STATUSES, Expense
from ..core.palette import PluginContext, ctx_dependency, get_plugin_context, require_permission
from ..core.secrets import read_secret

router = APIRouter(tags=["imports"])


@router.post("/imports/preview", dependencies=[require_permission("resources:write")])
async def preview_import(file: UploadFile = File(...), ctx: Any = ctx_dependency) -> dict:
    # OPENAI_KEY is optional — only the PDF-statement path uses it (see
    # imports.parse_statement_pdf); spreadsheets are already structured data
    # read straight from their cells, so there's nothing for an LLM to help
    # with there.
    api_key = read_secret(ctx, "OPENAI_KEY") or None
    categories = await category_dicts(ctx)
    workdir = new_workdir()
    try:
        saved = await save_upload(file, workdir, allowed_exts=SUPPORTED_IMPORT_EXTS)
        try:
            rows = parse_import_file(saved, api_key=api_key, categories=categories)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not rows:
            raise HTTPException(
                status_code=422,
                detail="Couldn't find any transaction rows in that file.",
            )
        # With an LLM available, let it categorize the whole batch in one call
        # against the org's current categories (keyword guesses stay as the
        # fallback baked into each draft above).
        if api_key:
            items = [{"id": str(r["row"]), "vendor": r["vendor"], "notes": r.get("notes") or ""} for r in rows]
            assignments = llm_classify_batch(items, categories, api_key)
            for r in rows:
                slug = assignments.get(str(r["row"]))
                if slug:
                    r["category"] = slug
        return {
            "rows": rows,
            "valid_count": sum(1 for r in rows if r["valid"]),
            "total_count": len(rows),
        }
    finally:
        cleanup(workdir)


class ImportRow(BaseModel):
    vendor: str
    amount: float
    currency: str = "USD"
    category: str = "other"
    expense_date: str
    status: str = "pending"
    notes: Optional[str] = None


class ImportCommitRequest(BaseModel):
    rows: list[ImportRow]


@router.post("/imports/commit", status_code=201, dependencies=[require_permission("resources:write")])
async def commit_import(
    payload: ImportCommitRequest, ctx: PluginContext = Depends(get_plugin_context)
) -> dict:
    if not payload.rows:
        raise HTTPException(status_code=422, detail="No rows to import.")

    allowed = await valid_slugs(ctx)
    created: list[Expense] = []
    for row in payload.rows:
        if row.amount < 0:
            raise HTTPException(status_code=422, detail="Amount can't be negative.")
        if row.category not in allowed:
            raise HTTPException(status_code=422, detail=f"Unknown category '{row.category}'.")
        if row.status not in STATUSES:
            raise HTTPException(status_code=422, detail=f"Unknown status '{row.status}'.")
        try:
            parsed_date = date_type.fromisoformat(row.expense_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="Dates must be in YYYY-MM-DD format.")

        expense = Expense(
            organization_id=ctx.organization_id,
            vendor=row.vendor.strip()[:200] or "Unknown vendor",
            amount=row.amount,
            currency=(row.currency or "USD").strip()[:8] or "USD",
            category=row.category,
            expense_date=parsed_date,
            status=row.status,
            notes=row.notes or None,
        )
        ctx.db.add(expense)
        created.append(expense)

    await ctx.db.commit()
    for expense in created:
        await ctx.db.refresh(expense)
    return {"created": len(created), "expenses": [e.to_dict() for e in created]}
