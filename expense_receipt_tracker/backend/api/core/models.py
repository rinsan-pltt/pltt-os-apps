"""ORM models."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

STATUSES = ("pending", "submitted", "reimbursed")


def _new_id() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Expense(Base):
    # Plugin-owned tables must be prefixed with the DB-safe plugin id, and the
    # Base (OrgScopedTable) adds the `organization_id` column + RLS the platform
    # scopes rows with. Never filter by organization_id in queries — RLS does it.
    __tablename__ = "expense_receipt_tracker__expenses"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    vendor: Mapped[str] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    category: Mapped[str] = mapped_column(String(40), default="other")
    expense_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Local-disk receipt (standalone dev / fallback path).
    receipt_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Durable platform storage (palette.storage): the OS-configured backend
    # (GCS in production) that survives server restarts. When
    # `receipt_object_path` is set the receipt lives there and `receipt_url`
    # serves it, rather than on the local filesystem.
    receipt_object_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    receipt_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    receipt_content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "vendor": self.vendor,
            "amount": self.amount,
            "currency": self.currency,
            "category": self.category,
            "expense_date": self.expense_date.isoformat(),
            "status": self.status,
            "notes": self.notes,
            # True whether the receipt lives in durable storage or on local disk.
            "has_receipt": bool(self.receipt_filename or self.receipt_object_path),
            "receipt_original_name": self.receipt_original_name,
            # Direct durable URL when stored via platform storage, else null
            # (the /expenses/{id}/receipt route still streams local-disk files).
            "receipt_url": self.receipt_url,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class AppSetting(Base):
    """Org-scoped key/value store for plugin-wide preferences.

    Currently holds a single key, ``base_currency`` — the currency the dashboard
    totals (Total tracked / Pending / Reimbursed) are displayed in. Expenses
    recorded in other currencies are converted into it (see core/fx.py) using the
    exchange rate for each expense's own date. Kept as a generic KV table so
    future settings don't each need a schema migration."""

    __tablename__ = "expense_receipt_tracker__settings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    key: Mapped[str] = mapped_column(String(40), index=True)
    value: Mapped[str] = mapped_column(String(200))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ExpenseCategory(Base):
    """User-editable expense category. Seeded per organization from the static
    defaults (see core/categories.py) the first time categories are read, then
    freely renamed/added/removed on the management page. `slug` is the stable
    identifier stored on `Expense.category`; renaming a category changes only
    its `label`, so existing expenses keep their association."""

    __tablename__ = "expense_receipt_tracker__categories"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    slug: Mapped[str] = mapped_column(String(40), index=True)
    label: Mapped[str] = mapped_column(String(80))
    # Comma-separated keyword hints used by the no-LLM keyword categorizer.
    keywords: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # "other" is seeded as a protected catch-all: it can't be renamed or deleted.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def keyword_list(self) -> list[str]:
        return [k.strip() for k in (self.keywords or "").split(",") if k.strip()]

    def to_dict(self) -> dict:
        return {
            "slug": self.slug,
            "label": self.label,
            "keywords": self.keyword_list(),
            "is_default": self.is_default,
            "sort_order": self.sort_order,
        }
