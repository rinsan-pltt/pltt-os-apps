"""Expense category registry, shared conceptually with the frontend's
`lib/categories.ts` (icon + color are frontend-only; keep `slug`/`label`
and the auto-categorize keywords in sync with that file)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Category:
    slug: str
    label: str
    keywords: tuple[str, ...] = field(default_factory=tuple)


CATEGORIES: list[Category] = [
    Category("meals", "Meals & Entertainment", (
        "restaurant", "cafe", "coffee", "diner", "bar", "grill", "pizza",
        "starbucks", "mcdonald", "kitchen", "bistro", "bakery", "eatery",
    )),
    Category("travel", "Travel", (
        "airline", "airlines", "flight", "airways", "airport", "delta",
        "united", "expedia", "booking.com", "jetblue", "southwest",
    )),
    Category("transportation", "Transportation", (
        "uber", "lyft", "taxi", "parking", "gas station", "fuel", "shell",
        "chevron", "exxon", "metro", "transit", "toll",
    )),
    Category("lodging", "Lodging", (
        "hotel", "inn", "motel", "marriott", "hilton", "airbnb", "resort", "lodge",
    )),
    Category("office", "Office Supplies", (
        "staples", "office depot", "supplies", "printer", "ink cartridge", "stationery",
    )),
    Category("software", "Software & Subscriptions", (
        "subscription", "saas", "adobe", "microsoft", "google workspace",
        "slack", "zoom", "aws", "github", "notion", "figma",
    )),
    Category("utilities", "Utilities", (
        "electric", "electricity", "water bill", "internet", "telecom",
        "utility", "comcast", "verizon", "at&t",
    )),
    Category("marketing", "Marketing & Advertising", (
        "advertising", "marketing", "facebook ads", "google ads", "promo",
    )),
    Category("professional", "Professional Services", (
        "consulting", "legal", "accountant", "lawyer", "notary", "attorney",
    )),
    Category("health", "Health & Wellness", (
        "pharmacy", "clinic", "doctor", "hospital", "cvs", "walgreens", "gym",
    )),
    Category("other", "Other", ()),
]

CATEGORY_BY_SLUG: dict[str, Category] = {c.slug: c for c in CATEGORIES}
VALID_SLUGS = tuple(c.slug for c in CATEGORIES)

# The protected catch-all slug — always present, never renamed or deleted.
OTHER_SLUG = "other"


def default_category_dicts() -> list[dict]:
    """The seed set used to populate a new organization's categories."""
    return [
        {"slug": c.slug, "label": c.label, "keywords": list(c.keywords)}
        for c in CATEGORIES
    ]


def guess_category(text: str, categories: list[dict] | None = None) -> str:
    """Best-effort category from receipt text/vendor using keyword hints, over
    the given category set (each a dict with `slug` and `keywords`). Falls back
    to the static defaults when no set is passed, and to 'other' when nothing
    matches — so it keeps working with no LLM and no DB."""
    cats = categories if categories is not None else default_category_dicts()
    haystack = text.lower()
    for category in cats:
        slug = category.get("slug")
        if not slug or slug == OTHER_SLUG:
            continue
        if any(str(k).lower() in haystack for k in category.get("keywords") or ()):
            return slug
    return OTHER_SLUG
