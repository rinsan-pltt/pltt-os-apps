"""Category registry the frontend renders filters and pickers from, plus the
management endpoint that persists edits and re-categorizes expenses.

GET  /categories          list the org's categories (seeded from defaults)
PUT  /categories          apply add/rename/delete/reorder, then use the LLM to
                          re-categorize every existing expense into the new set

The PUT validates every name it is about to create or rename (see
core/category_validation.py) and refuses the whole request if any of them is
not a category name. It refuses rather than warns because the write is not
reversible in one step: the slug lands on expense rows and the classifier is
then asked to sort receipts into it.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from anyio import to_thread
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..core.categories import OTHER_SLUG
from ..core.categorize import llm_classify_batch
from ..core.category_store import list_categories
from ..core.category_validation import check_labels
from ..core.models import Expense, ExpenseCategory
from ..core.palette import PluginContext, ctx_dependency, get_plugin_context, require_permission
from ..core.secrets import read_secret

router = APIRouter(tags=["categories"])


@router.get("/categories", dependencies=[require_permission("resources:read")])
async def get_categories(ctx: Any = ctx_dependency) -> list[dict]:
    return [c.to_dict() for c in await list_categories(ctx)]


class CategoryInput(BaseModel):
    slug: Optional[str] = None  # existing slug to update; None/new → created
    label: str
    keywords: list[str] = []


class CategoriesUpdate(BaseModel):
    categories: list[CategoryInput]


def _slugify(label: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")[:40] or "category"
    slug, n = base, 2
    while slug in taken:
        slug = f"{base[:37]}_{n}"
        n += 1
    return slug


@router.put("/categories", dependencies=[require_permission("resources:write")])
async def apply_categories(
    payload: CategoriesUpdate, ctx: PluginContext = Depends(get_plugin_context)
) -> dict:
    if not payload.categories:
        raise HTTPException(status_code=422, detail="At least one category is required.")
    for item in payload.categories:
        if not item.label.strip():
            raise HTTPException(status_code=422, detail="Category names can't be empty.")

    existing = list((await ctx.db.execute(select(ExpenseCategory))).scalars().all())
    by_slug = {c.slug: c for c in existing}
    api_key = read_secret(ctx, "OPENAI_KEY") or None

    # Check the names being created or renamed — not the ones passing through
    # unchanged. Re-checking those would mean a category saved before this rule
    # existed (or one the model judges differently today) blocks every future
    # edit to a page it isn't even on; the user could not save their way out.
    proposed = [
        item.label.strip()
        for item in payload.categories
        if not (item.slug and item.slug in by_slug and by_slug[item.slug].label == item.label.strip())
    ]
    if proposed:
        # The name check may call the model, so it goes to a worker thread
        # rather than holding the event loop for the round trip.
        rejected = await to_thread.run_sync(check_labels, proposed, api_key)
        if rejected:
            names = ", ".join(f"\u201c{r['label']}\u201d" for r in rejected)
            raise HTTPException(
                status_code=422,
                # `detail` is an object so the client can flag the offending
                # field instead of only printing a sentence. api.ts reads
                # `detail.message` for the banner and `detail.invalid` for the
                # per-row markers.
                detail={
                    "message": (
                        f"{names} doesn't look like a category name."
                        if len(rejected) == 1
                        else f"These don't look like category names: {names}."
                    ),
                    "invalid": rejected,
                },
            )

    # First pass: resolve/assign a slug for every desired category, keeping
    # existing slugs stable (so expenses keep their association on rename).
    taken: set[str] = set()
    resolved: list[tuple[CategoryInput, str, bool]] = []  # (input, slug, is_new)
    for item in payload.categories:
        slug = item.slug if (item.slug and item.slug in by_slug) else None
        if slug is None:
            slug = _slugify(item.label, taken | set(by_slug))
            resolved.append((item, slug, True))
        else:
            resolved.append((item, slug, False))
        taken.add(slug)

    if len({s for _, s, _ in resolved}) != len(resolved):
        raise HTTPException(status_code=422, detail="Duplicate categories are not allowed.")

    kept_slugs = {s for _, s, _ in resolved}
    # 'other' is the protected catch-all: always keep it even if the client
    # dropped it, and never delete it.
    if OTHER_SLUG not in kept_slugs and OTHER_SLUG in by_slug:
        kept_slugs.add(OTHER_SLUG)

    # Upsert the desired categories.
    for order, (item, slug, is_new) in enumerate(resolved):
        keywords = ", ".join(k.strip() for k in item.keywords if k.strip()) or None
        if is_new:
            ctx.db.add(
                ExpenseCategory(
                    organization_id=ctx.organization_id,
                    slug=slug,
                    label=item.label.strip()[:80],
                    keywords=keywords,
                    sort_order=order,
                    is_default=False,
                )
            )
        else:
            row = by_slug[slug]
            # Keep 'other' as the catch-all: its label may change, its slug never.
            row.label = item.label.strip()[:80]
            row.keywords = keywords
            row.sort_order = order

    # Delete removed categories (never 'other').
    for cat in existing:
        if cat.slug not in kept_slugs and cat.slug != OTHER_SLUG:
            await ctx.db.delete(cat)

    await ctx.db.commit()

    # Re-categorize every expense into the new set with the LLM (keyword
    # fallback with no key). Expenses whose category was deleted get a fresh,
    # valid slug this way too.
    new_dicts = [c.to_dict() for c in await list_categories(ctx)]
    expenses = list((await ctx.db.execute(select(Expense))).scalars().all())
    recategorized = 0
    if expenses:
        items = [
            {"id": e.id, "vendor": e.vendor, "notes": e.notes or ""} for e in expenses
        ]
        assignments = llm_classify_batch(items, new_dicts, api_key)
        valid = {c["slug"] for c in new_dicts}
        for e in expenses:
            new_slug = assignments.get(e.id)
            if new_slug and new_slug in valid and new_slug != e.category:
                e.category = new_slug
                recategorized += 1
        if recategorized:
            await ctx.db.commit()

    return {"categories": new_dicts, "recategorized": recategorized}
