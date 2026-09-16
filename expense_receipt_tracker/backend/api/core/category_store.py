"""Async persistence helpers for the per-organization category set.

Categories live in the `expense_receipt_tracker__categories` table (org-scoped,
RLS on the platform). The first time an org's categories are read they're
seeded from the static defaults in `categories.py`, so existing installs and
the tests keep the familiar meals/travel/… set with their keyword hints.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from .categories import OTHER_SLUG, default_category_dicts
from .models import ExpenseCategory


async def _seed_if_empty(ctx: Any) -> None:
    existing = (await ctx.db.execute(select(ExpenseCategory.id).limit(1))).first()
    if existing is not None:
        return
    for order, spec in enumerate(default_category_dicts()):
        ctx.db.add(
            ExpenseCategory(
                organization_id=getattr(ctx, "organization_id", 0),
                slug=spec["slug"],
                label=spec["label"],
                keywords=", ".join(spec["keywords"]) or None,
                sort_order=order,
                is_default=True,
            )
        )
    await ctx.db.commit()


async def list_categories(ctx: Any) -> list[ExpenseCategory]:
    """The org's categories in display order, seeding defaults on first use."""
    await _seed_if_empty(ctx)
    stmt = select(ExpenseCategory).order_by(
        ExpenseCategory.sort_order, ExpenseCategory.label
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def category_dicts(ctx: Any) -> list[dict]:
    """Categories as plain dicts ({slug, label, keywords, ...}) for the keyword
    categorizer and the LLM classifier."""
    return [c.to_dict() for c in await list_categories(ctx)]


async def valid_slugs(ctx: Any) -> set[str]:
    slugs = {c.slug for c in await list_categories(ctx)}
    slugs.add(OTHER_SLUG)  # always a legal target
    return slugs
