"""POST /reports/export — CSV or PDF reimbursement report for a filtered set
of expenses (or an explicit list of ids picked in the UI)."""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select

from ..core.models import Expense
from ..core.palette import PluginContext, get_plugin_context, require_permission
from ..core.reports import build_csv, build_pdf, build_xlsx

router = APIRouter(tags=["reports"])


class ReportRequest(BaseModel):
    ids: Optional[list[str]] = None
    category: Optional[str] = None
    status: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    format: str = "csv"
    title: str = "Reimbursement Report"


@router.post("/reports/export", dependencies=[require_permission("resources:read")])
async def export_report(
    payload: ReportRequest, ctx: PluginContext = Depends(get_plugin_context)
) -> Response:
    stmt = select(Expense)
    if payload.ids:
        stmt = stmt.where(Expense.id.in_(payload.ids))
    else:
        if payload.category and payload.category != "all":
            stmt = stmt.where(Expense.category == payload.category)
        if payload.status and payload.status != "all":
            stmt = stmt.where(Expense.status == payload.status)
        if payload.date_from:
            stmt = stmt.where(Expense.expense_date >= date_type.fromisoformat(payload.date_from))
        if payload.date_to:
            stmt = stmt.where(Expense.expense_date <= date_type.fromisoformat(payload.date_to))
    stmt = stmt.order_by(Expense.expense_date.asc())
    expenses = list((await ctx.db.execute(stmt)).scalars().all())

    if not expenses:
        raise HTTPException(status_code=422, detail="No expenses match this report's filters.")

    today = datetime.now(timezone.utc).date().isoformat()
    if payload.format == "pdf":
        content = build_pdf(expenses, payload.title)
        media_type, filename = "application/pdf", f"reimbursement-report-{today}.pdf"
    elif payload.format == "xlsx":
        content = build_xlsx(expenses, payload.title)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"reimbursement-report-{today}.xlsx"
    elif payload.format == "csv":
        content = build_csv(expenses)
        media_type, filename = "text/csv", f"reimbursement-report-{today}.csv"
    else:
        raise HTTPException(status_code=422, detail="format must be 'csv', 'xlsx' or 'pdf'.")

    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
