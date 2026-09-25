"""Correct Mistakes, without touching the layout.

The first version sent the document's plain text to the model and got back a
rewritten plain text — which is all the preview and the download then had, so
every heading, table, column and font was gone. Now:

1. the document is opened exactly as the editor opens it (one entry per real
   page, every line at its own position — see routes/edit.extract_pages);
2. each line / paragraph / cell becomes a numbered segment the model reads;
3. the model returns only FIXES — "in s12 change X to Y" — never a rewrite;
4. each fix is applied inside that segment's own text nodes, so its spans,
   fonts, colours and position are left exactly as they were.

The pages come back in the editor's shape, so the frontend previews them the
way the editor draws them and exports them through /edit/export in the
original format.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import HTTPException

#: Characters of segment text per model call; batches run concurrently.
BATCH_CHARS = 10_000
MAX_CONCURRENCY = 4
#: Beyond this the job is too big for one request (the old limit was 30k).
MAX_TOTAL_CHARS = 400_000
FIX_TYPES = {"spelling", "grammar", "punctuation", "clarity"}

_BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"}

SYSTEM_PROMPT = """You are a meticulous proofreader. The user's document is given as numbered segments, one per line:
  <id> | <text>
On PDF-style documents a segment is one visual LINE, so a sentence may continue on the next segment — judge grammar across lines, but report each fix on the segment where the wrong text is.

Find spelling, grammar and punctuation mistakes (and only clear clarity problems). Keep the meaning, tone and language; do not rephrase correct text, and do not change names, numbers, codes or formatting.

Reply with ONE JSON object:
{"fixes": [{"id": "s12", "before": "exact wrong text", "after": "corrected text", "type": "spelling" | "grammar" | "punctuation" | "clarity", "explanation": "one short sentence"}]}
- "before" must be copied EXACTLY from that segment (same case, spacing and punctuation) and be as short as possible while still unique in the segment — usually the wrong word plus a neighbour.
- One fix per mistake. If there are no mistakes, return {"fixes": []}."""


@dataclass
class _Segment:
    id: str
    element: Any  # lxml element
    page: int
    text: str = ""


@dataclass
class _Page:
    data: dict
    root: Any = None  # lxml wrapper <div>
    changed: bool = False
    segments: list[_Segment] = field(default_factory=list)


# ------------------------------------------------------------ text plumbing

def _text_slots(el) -> list[tuple[Any, str]]:
    """Every place text lives inside `el`, in reading order: (node, "text" |
    "tail"). `el`'s own tail belongs to whatever follows it, so it's left out."""
    slots: list[tuple[Any, str]] = []

    def walk(node, is_root: bool) -> None:
        if isinstance(node.tag, str):  # comments / PIs carry no document text
            slots.append((node, "text"))
            for child in node:
                walk(child, False)
        if not is_root:
            slots.append((node, "tail"))

    walk(el, True)
    return slots


def _get(node, slot: str) -> str:
    return (node.text if slot == "text" else node.tail) or ""


def _set(node, slot: str, value: str) -> None:
    if slot == "text":
        node.text = value
    else:
        node.tail = value


def segment_text(el) -> str:
    return "".join(_get(n, s) for n, s in _text_slots(el))


def replace_in_element(el, before: str, after: str) -> bool:
    """Replace the first `before` inside `el` with `after`, touching only the
    text involved. A match inside one text node is a plain string edit; one
    that spans several (a word split across spans) puts the replacement in
    the first and trims the rest, so every element survives."""
    slots = _text_slots(el)
    full = "".join(_get(n, s) for n, s in slots)
    start = full.find(before)
    if start < 0:
        return False
    end = start + len(before)
    offset = 0
    written = False
    for node, slot in slots:
        value = _get(node, slot)
        node_start, node_end = offset, offset + len(value)
        offset = node_end
        if node_end <= start or node_start >= end or not value:
            continue
        a = max(start, node_start) - node_start
        b = min(end, node_end) - node_start
        _set(node, slot, value[:a] + ("" if written else after) + value[b:])
        written = True
    return written


# ---------------------------------------------------------------- segments

def _page_elements(root, page: dict) -> list:
    if page.get("kind") == "sheet":
        # Text cells only: numbers, dates and formulas carry a data-t and are
        # values, not prose — "correcting" one would turn it into a string.
        return [td for td in root.iter("td") if td.get("data-cell") and not td.get("data-t")]
    if page.get("positioned"):
        return list(root.iter("p"))
    blocks = [el for el in root.iter() if isinstance(el.tag, str) and el.tag in _BLOCK_TAGS]
    # The innermost block only: a <p> inside a <li> is the segment, not both.
    return [el for el in blocks if not any(
        isinstance(d.tag, str) and d.tag in _BLOCK_TAGS for d in el.iterdescendants()
    )]


def load_pages(pages: list[dict]) -> tuple[list[_Page], list[_Segment]]:
    from lxml import html as lxml_html

    loaded: list[_Page] = []
    segments: list[_Segment] = []
    for index, data in enumerate(pages):
        page = _Page(data=data)
        try:
            page.root = lxml_html.fragment_fromstring(data.get("html") or "", create_parent="div")
        except Exception:  # noqa: BLE001 — an unparsable page is left exactly as it was
            loaded.append(page)
            continue
        for el in _page_elements(page.root, data):
            text = segment_text(el)
            if not text.strip():
                continue
            seg = _Segment(id=f"s{len(segments) + 1}", element=el, page=index, text=text)
            page.segments.append(seg)
            segments.append(seg)
        loaded.append(page)
    return loaded, segments


def batches(segments: list[_Segment], limit: int = BATCH_CHARS) -> list[list[_Segment]]:
    out: list[list[_Segment]] = []
    current: list[_Segment] = []
    size = 0
    for seg in segments:
        line = len(seg.text) + len(seg.id) + 4
        if current and size + line > limit:
            out.append(current)
            current, size = [], 0
        current.append(seg)
        size += line
    if current:
        out.append(current)
    return out


def batch_prompt(batch: list[_Segment]) -> str:
    return "\n".join(f"{s.id} | {s.text.replace(chr(10), ' ')}" for s in batch)


# -------------------------------------------------------------------- fixes

def parse_fixes(content: str, known: set[str]) -> list[dict]:
    content = content.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", content, re.DOTALL)
    if fenced:
        content = fenced.group(1)
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Model returned malformed correction data: {exc}")
    raw = data.get("fixes") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        raise HTTPException(status_code=502, detail="Model returned malformed correction data: no fixes list.")
    fixes: list[dict] = []
    for f in raw:
        if not isinstance(f, dict):
            continue
        seg, before, after = str(f.get("id", "")), f.get("before"), f.get("after")
        if seg not in known or not isinstance(before, str) or not isinstance(after, str):
            continue
        if not before or before == after:
            continue
        kind = str(f.get("type", "")).lower()
        fixes.append({
            "id": seg,
            "type": kind if kind in FIX_TYPES else "other",
            "before": before,
            "after": after,
            "explanation": str(f.get("explanation", "")),
        })
    return fixes


def core_change(before: str, after: str) -> tuple[str, str]:
    """`before`/`after` with the words they share at either end trimmed off:
    ("have acheived", "have achieved") -> ("acheived", "achieved")."""
    b, a = before.split(" "), after.split(" ")
    while len(b) > 1 and len(a) > 1 and b[0] == a[0]:
        b, a = b[1:], a[1:]
    while len(b) > 1 and len(a) > 1 and b[-1] == a[-1]:
        b, a = b[:-1], a[:-1]
    return " ".join(b), " ".join(a)


def apply_fixes(pages: list[_Page], segments: list[_Segment], fixes: list[dict]) -> list[dict]:
    """Apply every fix in place; each fix comes back marked `applied`.

    Two fixes on one line can overlap — "team have" -> "team has" and then
    "have acheived" -> "have achieved": once the first is in, the second's
    context word is gone. A fix whose full text no longer matches is retried
    with just the part that actually changes."""
    by_id = {s.id: s for s in segments}
    out: list[dict] = []
    for fix in fixes:
        seg = by_id[fix["id"]]
        applied = replace_in_element(seg.element, fix["before"], fix["after"])
        if not applied:
            core_before, core_after = core_change(fix["before"], fix["after"])
            if core_before and core_before != fix["before"]:
                applied = replace_in_element(seg.element, core_before, core_after)
        if applied:
            pages[seg.page].changed = True
        public = {k: v for k, v in fix.items() if k != "id"}
        out.append({**public, "page": seg.page + 1, "applied": applied})
    return out


def dump_pages(pages: list[_Page]) -> list[dict]:
    """The pages in the editor's shape. Only a page that changed is
    re-serialised; every other page is returned byte-for-byte as extracted."""
    from lxml import etree

    out: list[dict] = []
    for page in pages:
        if not page.changed or page.root is None:
            out.append(page.data)
            continue
        wrapper = etree.tostring(page.root, encoding="unicode", method="html")
        inner = wrapper[wrapper.index(">") + 1 : wrapper.rindex("</div>")]
        out.append({**page.data, "html": inner})
    return out


def corrected_text(segments: list[_Segment]) -> str:
    return "\n".join(segment_text(s.element) for s in segments)


def check_size(segments: list[_Segment]) -> None:
    total = sum(len(s.text) for s in segments)
    if total > MAX_TOTAL_CHARS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Document is too long for proofreading ({total:,} characters; "
                f"limit {MAX_TOTAL_CHARS:,}). Split it first and try again."
            ),
        )


def messages_for(batch: list[_Segment]) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": batch_prompt(batch)},
    ]


CallModel = Callable[[list[dict]], tuple[str, str]]
