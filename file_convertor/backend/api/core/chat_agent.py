"""The global chat's planner: a conversation that can run any of the app's tools.

The browser sends the tool catalog (built from its own registry, so the model
sees exactly the tools, formats and option values the pages offer), the files
in the session — uploads and earlier results, each with an id — and the
conversation. The model replies with JSON: a chat `reply`, and optionally
`steps` to run. This module only validates that plan; the browser runs each
step through the SAME endpoints the tool pages use (/tools/<slug>,
/organize/apply, /ai/proofread, ...), so a tool behaves identically whether it
was clicked or asked for, and its results are archived the same way.
"""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException

HISTORY_TURNS = 12
MAX_STEPS = 6
#: A step's input can be the previous step's output: "convert to PDF, then
#: compress it" is two steps where the second takes "$prev".
PREVIOUS = "$prev"

SYSTEM_PROMPT = """You are the assistant of "Document Toolbox", an app for working with documents. You chat like a helpful assistant AND can run the app's tools on the user's files.

TOOLS you can run (slug — what it does — accepted file types — options):
{catalog}

FILES in this conversation (id — name — where it came from):
{files}

Reply with ONE JSON object and nothing else:
{{
  "reply": "your message to the user, in the language they write in",
  "steps": [ {{"tool": "<slug>", "files": ["f1"], "options": {{"name": "value"}}}} ],
  "open_tool": "<slug>"
}}

Rules:
- Use "steps" when the user wants something DONE to a file (convert, compress, merge, split, rotate, protect, translate, summarize, answer a question about it, ...). Otherwise leave "steps" empty and just reply.
- Every step names files by id. For a follow-up ("now compress it", "convert that to Word") use the most recent matching file, usually the last result. Chain steps with "files": ["$prev"] to use the previous step's output.
- Only use a tool with files of a type it accepts; say so in "reply" if none fits.
- Options: use only the option names listed for that tool, and for choices only the listed values. Fill required options; if a required value is unknown (e.g. a password), ask for it in "reply" and return no steps.
- Questions ABOUT a document's content (summaries, "what does it say about X", totals) use the tool "summarize-document" with option "question" set to the user's question. The answer is shown to the user automatically.
- Tools marked [interactive] cannot run from chat; set "open_tool" to their slug and tell the user it opens the tool.
- Without any file, tools cannot run: ask the user to attach one (the paperclip button).
- Keep "reply" short. When you run steps, say what you are doing; the results appear below your message."""


def _option_line(opt: dict) -> str:
    name = str(opt.get("name", ""))
    kind = opt.get("kind")
    required = " (required)" if opt.get("required") else ""
    if kind == "select":
        values = "|".join(str(c) for c in opt.get("choices") or [])
        return f"{name}={values}{required}"
    return f"{name}=<{kind or 'text'}>{required}"


def catalog_text(catalog: list[dict]) -> str:
    lines = []
    for tool in catalog:
        options = ", ".join(_option_line(o) for o in tool.get("options") or []) or "no options"
        flags = []
        if not tool.get("runnable", True):
            flags.append("[interactive]")
        if tool.get("multiple"):
            flags.append("[several files]")
        if tool.get("exactFiles"):
            flags.append(f"[exactly {tool['exactFiles']} files]")
        accept = tool.get("accept") or "no file (takes a URL)"
        lines.append(
            f"- {tool.get('slug')} — {tool.get('title')}: {tool.get('description')} — {accept} — {options} {' '.join(flags)}".rstrip()
        )
    return "\n".join(lines)


def files_text(files: list[dict]) -> str:
    if not files:
        return "(none yet)"
    return "\n".join(
        f"- {f.get('id')} — {f.get('name')} — {f.get('origin', 'uploaded')}"
        + ("" if f.get("available", True) else " (no longer available; ask the user to attach it again)")
        for f in files
    )


def build_messages(*, catalog: list[dict], files: list[dict], history: list[dict], prompt: str) -> list[dict]:
    system = SYSTEM_PROMPT.format(catalog=catalog_text(catalog), files=files_text(files))
    messages: list[dict] = [{"role": "system", "content": system}]
    for turn in history[-HISTORY_TURNS:]:
        role, content = turn.get("role"), str(turn.get("content", ""))[:6000]
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": prompt})
    return messages


def _clean_options(raw: Any, tool: dict) -> dict[str, str] | None:
    """Declared options only, choice values checked; None when a required one
    is missing (the step cannot run as planned)."""
    raw = raw if isinstance(raw, dict) else {}
    out: dict[str, str] = {}
    for opt in tool.get("options") or []:
        name = str(opt.get("name", ""))
        if name in raw and raw[name] not in (None, ""):
            value = str(raw[name])
            choices = [str(c) for c in opt.get("choices") or []]
            if opt.get("kind") == "select" and choices and value not in choices:
                continue
            out[name] = value
        elif opt.get("required"):
            return None
    return out


def parse_plan(content: str, *, catalog: list[dict], files: list[dict]) -> dict:
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

    tools = {str(t.get("slug")): t for t in catalog}
    available = {str(f.get("id")) for f in files if f.get("available", True)}
    steps: list[dict] = []
    dropped = False
    for raw in (data.get("steps") or [])[:MAX_STEPS] if isinstance(data.get("steps"), list) else []:
        if not isinstance(raw, dict):
            continue
        tool = tools.get(str(raw.get("tool")))
        if tool is None or not tool.get("runnable", True):
            dropped = True
            continue
        refs = [str(r) for r in raw.get("files") or []] if isinstance(raw.get("files"), list) else []
        refs = [r for r in refs if r in available or (r == PREVIOUS and steps)]
        needs_file = bool(tool.get("accept"))
        if needs_file and not refs:
            dropped = True
            continue
        options = _clean_options(raw.get("options"), tool)
        if options is None:
            dropped = True
            continue
        steps.append({"tool": tool["slug"], "files": refs, "options": options})

    open_tool = data.get("open_tool")
    open_tool = open_tool if isinstance(open_tool, str) and open_tool in tools else None
    reply = str(data.get("reply") or "").strip()
    return {"reply": reply, "steps": steps, "open_tool": open_tool, "dropped": dropped}
