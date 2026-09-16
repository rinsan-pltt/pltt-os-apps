"""Async persistence helpers for per-organization plugin settings.

Settings live in the `expense_receipt_tracker__settings` KV table (org-scoped,
RLS on the platform). Right now the only setting is `base_currency` — the
currency the dashboard totals are shown in. A missing key reads back as the
default (USD), so existing installs and the tests keep working unchanged.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from .models import AppSetting

BASE_CURRENCY_KEY = "base_currency"
DEFAULT_BASE_CURRENCY = "USD"


def _normalize_currency(code: str | None) -> str:
    cleaned = (code or "").strip().upper()[:8]
    return cleaned or DEFAULT_BASE_CURRENCY


async def _get(ctx: Any, key: str) -> AppSetting | None:
    stmt = select(AppSetting).where(AppSetting.key == key)
    return (await ctx.db.execute(stmt)).scalars().first()


async def get_base_currency(ctx: Any) -> str:
    row = await _get(ctx, BASE_CURRENCY_KEY)
    return _normalize_currency(row.value if row else None)


async def set_base_currency(ctx: Any, code: str) -> str:
    """Persist the base display currency, returning the stored (normalized) code."""
    normalized = _normalize_currency(code)
    row = await _get(ctx, BASE_CURRENCY_KEY)
    if row is None:
        ctx.db.add(
            AppSetting(
                organization_id=getattr(ctx, "organization_id", 0),
                key=BASE_CURRENCY_KEY,
                value=normalized,
            )
        )
    else:
        row.value = normalized
    await ctx.db.commit()
    return normalized
