"""LLM expense categorization against the org's current category set.

Used in three places:
  * scanning a single receipt (classify one draft),
  * previewing a bulk import (classify many draft rows at once),
  * applying category changes (re-classify every existing expense).

All of them go through `llm_classify_batch`, which sends the category list plus
a batch of items and gets back a slug per item. The model may only pick from
the provided slugs; anything else (or any failure) falls back to the keyword
categorizer, so this degrades cleanly with no API key configured.
"""

from __future__ import annotations

import json

from .categories import OTHER_SLUG, guess_category
from .llm import call_openai

_MAX_BATCH = 100


def _keyword_fallback(items: list[dict], categories: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items:
        text = f"{item.get('vendor') or ''} {item.get('notes') or ''}"
        out[str(item["id"])] = guess_category(text, categories)
    return out


def _system_prompt(categories: list[dict]) -> str:
    lines = "\n".join(
        f"- {c['slug']}: {c['label']}"
        + (f" (e.g. {', '.join(c['keywords'][:6])})" if c.get("keywords") else "")
        for c in categories
    )
    return (
        "You assign each expense to exactly one category from the list below, "
        "choosing the best fit by the merchant/vendor name and any note. Use only "
        f"these category slugs; if none clearly fits, use '{OTHER_SLUG}'.\n\n"
        f"Categories:\n{lines}\n\n"
        'Respond with strict JSON only: {"assignments": [{"id": string, '
        '"category": string (one of the slugs above)}, ...]} — one entry per '
        "input expense, echoing its id."
    )


def llm_classify_batch(
    items: list[dict], categories: list[dict], api_key: str | None
) -> dict[str, str]:
    """Map each item id → category slug. `items` are dicts with `id`, `vendor`,
    and optional `notes`. Returns a slug for every item (keyword fallback for any
    the LLM omits or mislabels, or when no api_key is set)."""
    if not items:
        return {}
    valid = {c["slug"] for c in categories} | {OTHER_SLUG}
    result = _keyword_fallback(items, categories)  # baseline for every id
    if not api_key:
        return result

    system = _system_prompt(categories)
    for start in range(0, len(items), _MAX_BATCH):
        chunk = items[start : start + _MAX_BATCH]
        payload = [
            {"id": str(i["id"]), "vendor": i.get("vendor") or "", "notes": i.get("notes") or ""}
            for i in chunk
        ]
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": "Expenses to categorize (JSON):\n" + json.dumps(payload)},
        ]
        try:
            content, _ = call_openai(api_key, messages, json_mode=True)
            parsed = json.loads(content)
            assignments = parsed.get("assignments") if isinstance(parsed, dict) else None
            if isinstance(assignments, list):
                for a in assignments:
                    if not isinstance(a, dict):
                        continue
                    rid, slug = str(a.get("id")), a.get("category")
                    if rid in result and isinstance(slug, str) and slug in valid:
                        result[rid] = slug
        except Exception:  # noqa: BLE001 — keep the keyword fallback for this chunk
            continue
    return result


def llm_classify_one(
    text: str, categories: list[dict], api_key: str | None
) -> str:
    """Classify a single free-text blob (vendor + receipt text). Always returns
    a valid slug."""
    result = llm_classify_batch(
        [{"id": "0", "vendor": text, "notes": ""}], categories, api_key
    )
    return result.get("0", OTHER_SLUG)
