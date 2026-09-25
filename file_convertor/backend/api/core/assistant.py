"""The Edit Document AI assistant: prompt building, reply validation, maths.

The browser sends a numbered outline of the open document — one entry per
line/paragraph/cell, each with a stable id — and the model answers with JSON:
an `answer` for the chat, `operations` from a fixed vocabulary that the browser
applies to the live editor, and `calcs` that THIS module evaluates. The model
never returns HTML, so it cannot break the document's markup, and it never does
arithmetic itself, so "total of column C" is exact.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

from fastapi import HTTPException

#: The outline sent to the model is capped here; the model is told when the
#: cap cut the document short.
OUTLINE_MAX_CHARS = 60_000
HISTORY_TURNS = 8
MAX_OPERATIONS = 200
MAX_RANGE_CELLS = 5_000

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_REF = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
_ALIGNS = {"left", "center", "right"}
_CALC_OPS = {"sum", "avg", "min", "max", "count"}

_SYSTEM_PROMPT = """You are the AI assistant inside a document editor. The user sees their document; you see it as the numbered OUTLINE below. Every entry has an id you must use to refer to it.

{outline_help}

Reply with ONE JSON object and nothing else:
{{
  "answer": "short reply to show in the chat, in the user's language",
  "operations": [ ... ],
  "calcs": [ ... ]
}}

OPERATIONS (edits applied to the document; [] when the user only asks a question):
{operations_help}

CALCS (for any arithmetic — never compute numbers yourself):
  {{"name": "total", "op": "sum" | "avg" | "min" | "max" | "count", "range": "C2:C40", "sheet": "Sheet1"}}
  Write {{{{name}}}} in "answer" where the result should appear, e.g. "The total of column C is {{{{total}}}}."
  Use the used rows only (see the outline). Skip header rows.

Rules:
- The user's CURRENT SELECTION is marked "selected" (and the caret's line "cursor"). "this", "it", "the selected one", "the one I selected" mean the selected entries — act on them without asking. A selected object (image/shape) is what they clicked.
- When SELECTION is present and the user means the selected text ("the selected text", "this", "it", "what I highlighted"), act on EXACTLY that text with style_selection / replace_selection / delete_selection — never on the whole lines it sits in (the "selected" lines are only context). Use line/block ids only when the user names whole lines, headings or paragraphs.
- Pick targets precisely from the outline: "3rd heading" = the 3rd entry whose kind is heading; "4th line" = line 4; "4th paragraph" = para 4. Count from the start of the document unless a page is named.
- For rewrites ("replace ... with", "make it formal", "fix the grammar of paragraph 2") use replace_text on the affected ids; keep text the user did not ask to change.
- Only use operations listed above. If a request cannot be done with them, say so in "answer" and return no operations.
- Questions ("what is paragraph 4", "summarize") are answered in "answer" from the outline text, with no operations.
- Keep "answer" brief; when you edit, say what you changed in the user's terms ("the second heading", "line 3") — never mention ids like b12, which the user cannot see.
{truncated_note}
OUTLINE:
{outline}"""

_DOCUMENT_HELP = """The outline lists the document's text blocks, one per line:
  <id> p<page> line<n> para<n> <kind> [<size>pt] [bold] [italic] [underline] [color] [align] | <text>
kind is heading, paragraph, list-item, cell or line. On PDF-style pages every entry is one visual LINE of text, "para" groups lines into paragraphs, and headings are inferred from their larger or bold font. layout=positioned means headings/lists cannot be created there.
at x,y is where a line starts on its page in % (x0 = left edge, y100 = bottom), so "bottom right" is high x and high y.
OBJECTS (images, and a shape the user clicked — e.g. a drawn signature or stamp) are listed as:
  <id> p<page> image|shape box l,t,r,b% [selected] | <alt text or the text inside the shape>
SELECTION, when present, is the exact text the user highlighted."""

_DOCUMENT_OPS = """  {"op": "style", "ids": ["b3"], "color": "#RRGGBB", "highlight": "#RRGGBB", "bold": true, "italic": true, "underline": true, "strike": true, "fontSize": 14}
      (include only the properties to change; false removes bold/italic/underline/strike)
  {"op": "align", "ids": ["b3"], "align": "left" | "center" | "right"}
  {"op": "clear_format", "ids": ["b3"]}
  {"op": "replace_text", "id": "b3", "find": "exact text inside that block", "replace": "new text"}
      (omit "find" to replace the whole block's text)
  {"op": "heading", "ids": ["b3"], "level": 1 | 2 | 0}      (0 = normal text; flowing layout only)
  {"op": "list", "ids": ["b3", "b4"], "ordered": false}      (flowing layout only)
  {"op": "delete", "ids": ["b3", "o2"]}      (removes whole lines/blocks and objects)
  {"op": "style_selection", "color": "#RRGGBB", "highlight": "#RRGGBB", "bold": true, "italic": true, "underline": true, "strike": true, "fontSize": 14}
      (styles exactly the highlighted SELECTION text; include only the properties to change)
  {"op": "delete_selection"}                 (removes exactly the highlighted SELECTION text)
  {"op": "replace_selection", "text": "new text"}   (replaces exactly the highlighted SELECTION text)"""

_SHEET_HELP = """The outline lists the spreadsheet's non-empty cells:
  <Sheet>!<Ref> = <value>  [formula =...]  [bold] [color] [fill]
Row 1 is usually the header row. Refs use A1 notation."""

_SHEET_OPS = """  {"op": "cell_value", "sheet": "Sheet1", "ref": "D2", "value": "42"}     (a formula starts with "=")
  {"op": "cell_style", "sheet": "Sheet1", "refs": ["A1:D1"], "bold": true, "italic": true, "underline": true, "color": "#RRGGBB", "fill": "#RRGGBB", "align": "left" | "center" | "right"}"""


# ------------------------------------------------------------------ outline

def _block_line(b: dict) -> str:
    parts = [str(b.get("id", "")), f"p{b.get('page', 1)}", f"line{b.get('line', 0)}", f"para{b.get('para', 0)}", str(b.get("kind", "line"))]
    if b.get("size"):
        parts.append(f"{b['size']}pt")
    for flag in ("bold", "italic", "underline"):
        if b.get(flag):
            parts.append(flag)
    if b.get("color"):
        parts.append(str(b["color"]))
    if b.get("align") and b["align"] != "left":
        parts.append(str(b["align"]))
    if b.get("x") is not None and b.get("y") is not None:
        parts.append(f"at {b['x']},{b['y']}")
    if b.get("selected"):
        parts.append("selected")
    if b.get("cursor"):
        parts.append("cursor")
    return " ".join(parts) + " | " + str(b.get("text", "")).replace("\n", " ")


def _cell_line(c: dict) -> str:
    line = f"{c.get('sheet', 'Sheet1')}!{c.get('ref', '')} = {c.get('value', '')}"
    if c.get("formula"):
        line += f"  formula {c['formula']}"
    for flag in ("bold",):
        if c.get(flag):
            line += f"  {flag}"
    if c.get("color"):
        line += f"  color {c['color']}"
    if c.get("fill"):
        line += f"  fill {c['fill']}"
    if c.get("selected"):
        line += "  selected"
    return line


def _object_line(o: dict) -> str:
    box = o.get("box") or [0, 0, 0, 0]
    line = f"{o.get('id', '')} p{o.get('page', 1)} {o.get('kind', 'image')} box {','.join(str(v) for v in box)}%"
    if o.get("selected"):
        line += " selected"
    return line + " | " + str(o.get("text") or "").replace("\n", " ")


def build_outline(
    kind: str,
    blocks: list[dict],
    cells: list[dict],
    layout: str,
    objects: list[dict] | None = None,
    selection: str = "",
) -> tuple[str, bool]:
    """The outline text and whether it was cut at the cap.

    The selection and objects go FIRST, so the cap can never cut away the
    very thing the user is pointing at."""
    head: list[str] = []
    if selection:
        head.append("SELECTION: " + selection.replace("\n", " ")[:2000])
    selected = [o for o in objects or [] if o.get("selected")]
    others = [o for o in objects or [] if not o.get("selected")]
    if kind == "sheet":
        lines = head + [_cell_line(c) for c in cells]
    else:
        lines = (
            head
            + [f"layout={layout or 'flowing'}"]
            + [_object_line(o) for o in selected]
            + [_block_line(b) for b in blocks if b.get("selected") or b.get("cursor")]
            + [_block_line(b) for b in blocks if not (b.get("selected") or b.get("cursor"))]
            + [_object_line(o) for o in others]
        )
    out: list[str] = []
    size = 0
    for line in lines:
        size += len(line) + 1
        if size > OUTLINE_MAX_CHARS:
            return "\n".join(out), True
        out.append(line)
    return "\n".join(out), False


def build_messages(
    *,
    kind: str,
    blocks: list[dict],
    cells: list[dict],
    layout: str,
    history: list[dict],
    prompt: str,
    objects: list[dict] | None = None,
    selection: str = "",
) -> list[dict]:
    outline, truncated = build_outline(kind, blocks, cells, layout, objects, selection)
    is_sheet = kind == "sheet"
    system = _SYSTEM_PROMPT.format(
        outline_help=_SHEET_HELP if is_sheet else _DOCUMENT_HELP,
        operations_help=_SHEET_OPS if is_sheet else _DOCUMENT_OPS,
        truncated_note=(
            "- The document is longer than the outline shown; say so if the user asks about the whole of it.\n"
            if truncated else ""
        ),
        outline=outline,
    )
    messages: list[dict] = [{"role": "system", "content": system}]
    for turn in history[-HISTORY_TURNS:]:
        role = turn.get("role")
        content = str(turn.get("content", ""))[:4000]
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": prompt})
    return messages


# -------------------------------------------------------------- validation

def _color(value: Any) -> str | None:
    return value if isinstance(value, str) and _HEX.match(value) else None


def _flag(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def _col_letters(n: int) -> str:
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def expand_range(spec: str) -> list[str]:
    """"B2:C3" -> [B2, B3, C2, C3]; a single ref -> [ref]; junk -> []."""
    spec = str(spec).strip().upper().replace("$", "")
    first, _, last = spec.partition(":")
    m1 = _REF.match(first)
    m2 = _REF.match(last or first)
    if not m1 or not m2:
        return []
    c1, c2 = sorted((_col_index(m1.group(1)), _col_index(m2.group(1))))
    r1, r2 = sorted((int(m1.group(2)), int(m2.group(2))))
    if (c2 - c1 + 1) * (r2 - r1 + 1) > MAX_RANGE_CELLS:
        return []
    return [f"{_col_letters(c)}{r}" for c in range(c1, c2 + 1) for r in range(r1, r2 + 1)]


def _clean_style(op: dict, keys: dict[str, Any]) -> dict:
    out: dict = {}
    for key, kind in keys.items():
        if key not in op:
            continue
        if kind == "color":
            value = _color(op[key])
        elif kind == "flag":
            value = _flag(op[key])
        elif kind == "align":
            value = op[key] if op[key] in _ALIGNS else None
        else:  # font size
            try:
                value = min(96.0, max(6.0, float(op[key])))
            except (TypeError, ValueError):
                value = None
        if value is not None:
            out[key] = value
    return out


_DOC_STYLE = {"color": "color", "highlight": "color", "bold": "flag", "italic": "flag",
              "underline": "flag", "strike": "flag", "fontSize": "size"}
_CELL_STYLE = {"color": "color", "fill": "color", "bold": "flag", "italic": "flag",
               "underline": "flag", "align": "align"}


def validate_operations(
    raw: Any,
    *,
    kind: str,
    block_ids: set[str],
    sheets: set[str],
    object_ids: set[str] | None = None,
    has_selection: bool = False,
) -> list[dict]:
    """Keep only well-formed operations that point at something that exists."""
    if not isinstance(raw, list):
        return []
    ops: list[dict] = []
    for op in raw[:MAX_OPERATIONS]:
        if not isinstance(op, dict):
            continue
        name = op.get("op")
        if kind == "sheet":
            # A named sheet must exist; an unnamed one means the only sheet.
            named = op.get("sheet")
            if named:
                sheet = named if named in sheets else None
            else:
                sheet = next(iter(sheets)) if len(sheets) == 1 else None
            if sheet is None:
                continue
            if name == "cell_value":
                ref = str(op.get("ref", "")).upper().replace("$", "")
                if _REF.match(ref) and "value" in op:
                    ops.append({"op": name, "sheet": sheet, "ref": ref, "value": str(op["value"])})
            elif name == "cell_style":
                refs: list[str] = []
                for spec in op.get("refs", []) if isinstance(op.get("refs"), list) else []:
                    refs.extend(expand_range(spec))
                style = _clean_style(op, _CELL_STYLE)
                if refs and style:
                    ops.append({"op": name, "sheet": sheet, "refs": refs[:MAX_RANGE_CELLS], **style})
            continue

        ids = [i for i in op.get("ids", []) if i in block_ids] if isinstance(op.get("ids"), list) else []
        if name == "style":
            style = _clean_style(op, _DOC_STYLE)
            if ids and style:
                ops.append({"op": name, "ids": ids, **style})
        elif name == "align":
            if ids and op.get("align") in _ALIGNS:
                ops.append({"op": name, "ids": ids, "align": op["align"]})
        elif name == "clear_format":
            if ids:
                ops.append({"op": name, "ids": ids})
        elif name == "replace_text":
            block = op.get("id")
            if block in block_ids and isinstance(op.get("replace"), str):
                clean = {"op": name, "id": block, "replace": op["replace"]}
                if isinstance(op.get("find"), str) and op["find"]:
                    clean["find"] = op["find"]
                ops.append(clean)
        elif name == "heading":
            if ids and op.get("level") in (0, 1, 2):
                ops.append({"op": name, "ids": ids, "level": op["level"]})
        elif name == "list":
            if ids:
                ops.append({"op": name, "ids": ids, "ordered": bool(op.get("ordered"))})
        elif name == "delete":
            known = block_ids | (object_ids or set())
            targets = [i for i in op.get("ids", []) if i in known] if isinstance(op.get("ids"), list) else []
            if targets:
                ops.append({"op": name, "ids": targets})
        elif name == "style_selection":
            style = _clean_style(op, _DOC_STYLE)
            if has_selection and style:
                ops.append({"op": name, **style})
        elif name == "delete_selection":
            if has_selection:
                ops.append({"op": name})
        elif name == "replace_selection":
            if has_selection and isinstance(op.get("text"), str):
                ops.append({"op": name, "text": op["text"]})
    return ops


# -------------------------------------------------------------------- calcs

def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip().replace(",", "")
    text = re.sub(r"^[^\d\-+.]+|[^\d.%]+$", "", text)  # currency signs, units
    percent = text.endswith("%")
    try:
        number = float(text.rstrip("%"))
    except ValueError:
        return None
    return number / 100 if percent else number


def _format(number: float) -> str:
    if math.isfinite(number) and number == int(number) and abs(number) < 1e15:
        return f"{int(number):,}"
    return f"{number:,.6f}".rstrip("0").rstrip(".")


def evaluate_calcs(raw: Any, cells: list[dict]) -> dict[str, str]:
    """name -> formatted result, computed from the cell values we were sent."""
    if not isinstance(raw, list):
        return {}
    by_sheet: dict[str, dict[str, Any]] = {}
    for c in cells:
        by_sheet.setdefault(str(c.get("sheet", "")), {})[str(c.get("ref", "")).upper()] = c.get("value")
    only_sheet = next(iter(by_sheet)) if len(by_sheet) == 1 else None
    results: dict[str, str] = {}
    for calc in raw[:50]:
        if not isinstance(calc, dict):
            continue
        name, op = str(calc.get("name", "")), calc.get("op")
        grid = by_sheet.get(str(calc.get("sheet"))) or (by_sheet.get(only_sheet) if only_sheet else None)
        if not name or op not in _CALC_OPS or grid is None:
            continue
        numbers = [n for ref in expand_range(calc.get("range", "")) if (n := _number(grid.get(ref, ""))) is not None]
        if op == "count":
            results[name] = _format(len(numbers))
        elif not numbers:
            results[name] = "—"
        elif op == "sum":
            results[name] = _format(sum(numbers))
        elif op == "avg":
            results[name] = _format(sum(numbers) / len(numbers))
        elif op == "min":
            results[name] = _format(min(numbers))
        else:
            results[name] = _format(max(numbers))
    return results


def fill_placeholders(answer: str, results: dict[str, str]) -> str:
    return _PLACEHOLDER.sub(lambda m: results.get(m.group(1), m.group(0)), answer)


# -------------------------------------------------------------------- reply

def parse_reply(
    content: str,
    *,
    kind: str,
    blocks: list[dict],
    cells: list[dict],
    objects: list[dict] | None = None,
    selection: str = "",
) -> dict:
    """The model's JSON -> {answer, operations}, validated and with maths done."""
    content = content.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", content, re.DOTALL)
    if fenced:
        content = fenced.group(1)
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="The AI returned a reply that could not be read. Try again.")
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="The AI returned a reply that could not be read. Try again.")
    block_ids = {str(b.get("id")) for b in blocks}
    sheets = {str(c.get("sheet")) for c in cells}
    operations = validate_operations(
        data.get("operations"),
        kind=kind,
        block_ids=block_ids,
        sheets=sheets,
        object_ids={str(o.get("id")) for o in objects or []},
        has_selection=bool(selection),
    )
    answer = str(data.get("answer") or "").strip()
    answer = fill_placeholders(answer, evaluate_calcs(data.get("calcs"), cells))
    return {"answer": answer, "operations": operations}
