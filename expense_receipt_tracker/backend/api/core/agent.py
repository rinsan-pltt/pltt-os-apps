"""The chat agent: a tool-calling loop over the app's own API.

## Why the loop is hand-rolled

`ctx.llm.chat()` — the platform's model access — takes messages, a system
prompt and a token budget, and nothing else: there is no `tools` parameter and
no function-calling channel (see the SDK's `platform_services.py`). So the loop
below does the tool dispatch itself, using the plugin's existing OpenAI client
(`core/llm.call_openai_async`) in JSON mode. That client is already how
receipt extraction and category classification talk to a model, it reads the
same `OPENAI_KEY` secret, and `api.openai.com` is already the plugin's only
declared external host — so the chat feature needs no new capability.

Each step the model answers with one JSON object:

    {"tool": "list_expenses", "args": {...}}      -> run it, loop
    {"reply": "You spent $412 in August."}        -> done

Tool results are fed back as a user-role message rather than a real `tool` role,
because JSON mode over plain chat completions has no tool channel to put them
in. Labelling them `TOOL RESULT` and keeping them machine-shaped is enough for
the model to tell them apart from what the human said.

## Failure handling

A tool raising `HTTPException` is not an error the user should see — it is
usually recoverable information ("Unknown category 'lunch'"), so the detail goes
back into the transcript as the tool's result and the model gets another turn.
What does surface is a missing API key (424 from the client), an unparseable
reply, or running out of steps.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import HTTPException

from .agent_tools import TOOLS, ToolEnv, catalogue_for_prompt
from .llm import call_openai_async
from .models import STATUSES

logger = logging.getLogger(__name__)

# How many tools the agent may run for one user message.
#
# Real requests need a handful: "mark my August Ubers reimbursed" is one list
# plus one bulk update. The ceiling is there to stop a model that has decided to
# page through the ledger from spending the org's tokens on it, and every step
# is a round trip the user is waiting through.
MAX_TOOL_STEPS = 8

# How much conversation to send. The transcript lives in the browser, so it can
# grow without limit; only the tail is relevant and only the tail is affordable.
MAX_HISTORY_MESSAGES = 20

# Tool results are JSON and can be large (a 100-row list). Truncate rather than
# let one result crowd out the conversation it is supposed to be answering.
MAX_TOOL_RESULT_CHARS = 6000


@dataclass
class PendingAction:
    """A confirm-required tool call, handed back for the user to approve."""

    tool: str
    args: dict
    description: str


@dataclass
class AgentResult:
    reply: str
    # Past-tense, user-facing lines for the writes that actually happened.
    actions: list[str] = field(default_factory=list)
    pending: Optional[PendingAction] = None
    # A report the UI should offer as a download button.
    download: Optional[dict] = None
    # True when something was written, so the UI knows to refetch the pages
    # behind it — a chat that silently desynchronises the dashboard is worse
    # than no chat.
    changed: bool = False


def _system_prompt(env: ToolEnv, categories: list[dict]) -> str:
    catalogue = json.dumps(catalogue_for_prompt(), indent=None, separators=(",", ":"))
    category_lines = "\n".join(
        f"  - {c['slug']}: {c['label']}"
        + (f" (keywords: {', '.join(c['keywords'][:6])})" if c.get("keywords") else "")
        for c in categories
    )
    attachment_lines = (
        "\n".join(
            f"  - id \"{a['id']}\": {a.get('original_name') or 'receipt'} — scan read: "
            + json.dumps(a.get("draft") or {}, separators=(",", ":"))
            for a in env.attachments.values()
        )
        or "  (none)"
    )
    return f"""You are the assistant inside the Expense & Receipt Tracker app. You do the work
for the user by calling the app's own tools — the same operations its screens
perform — and then tell them plainly what happened.

Today is {env.today.isoformat()}. The org's base display currency is {env.base_currency}.
Valid expense statuses: {', '.join(STATUSES)}.

Categories (use the slug, never the label, when calling a tool):
{category_lines}

Receipts attached to the user's latest message:
{attachment_lines}

TOOLS
{catalogue}

HOW TO ANSWER
Reply with a single JSON object and nothing else. Either call one tool:
  {{"tool": "<name>", "args": {{...}}}}
or finish the turn by speaking to the user:
  {{"reply": "<what you did or what you found>"}}
Never both. After a tool runs you get its result and another turn, so chain
tools one at a time.

RULES
- Read before you write. To change or delete an expense you need its id, and
  the only way to get one is list_expenses. Never guess an id, a vendor or an
  amount.
- If the user's request is ambiguous or a required field is missing, ask them
  with a {{"reply": ...}} instead of picking a value. Guessing an amount is
  worse than one more question.
- Never total amounts yourself. Expenses can be in different currencies; only
  get_summary converts them.
- Tools marked needs_confirmation are shown to the user for approval before
  they run, so propose them normally — do not ask for permission in text
  first, and do not repeat a call the user has already confirmed.
- A tool result starting with "error:" means the call did not happen. Fix the
  arguments and try again, or tell the user what is wrong.
- Answer in the user's language. Money: include the currency code. Be brief —
  a sentence or two, no preamble, no restating the question. Never invent a
  figure, a date or a record that a tool did not return."""


def _describe(tool_name: str, args: dict) -> str:
    """The one-line, human-readable version of a proposed call.

    Shown on the confirmation card, so it has to say what will actually happen
    without the user having to read JSON.
    """
    if tool_name == "delete_expenses":
        count = len(args.get("ids") or [])
        return (
            "Permanently delete 1 expense and its receipt"
            if count == 1
            else f"Permanently delete {count} expenses and their receipts"
        )
    if tool_name == "bulk_update_status":
        count = len(args.get("ids") or [])
        return f"Set {count} expense{'' if count == 1 else 's'} to '{args.get('status')}'"
    if tool_name == "save_categories":
        labels = [str(c.get("label")) for c in (args.get("categories") or []) if isinstance(c, dict)]
        return (
            f"Replace the category set with {len(labels)} categories "
            f"({', '.join(labels[:6])}{'…' if len(labels) > 6 else ''}) "
            "and re-categorise every existing expense"
        )
    return f"Run {tool_name}"


def _parse_decision(content: str) -> dict:
    try:
        decision = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="The assistant returned a malformed reply.")
    if not isinstance(decision, dict):
        raise HTTPException(status_code=502, detail="The assistant returned a malformed reply.")
    return decision


def _tool_result_message(tool_name: str, payload: Any) -> dict:
    body = payload if isinstance(payload, str) else json.dumps(payload, default=str)
    if len(body) > MAX_TOOL_RESULT_CHARS:
        body = body[:MAX_TOOL_RESULT_CHARS] + f"… (truncated at {MAX_TOOL_RESULT_CHARS} characters)"
    return {"role": "user", "content": f"TOOL RESULT {tool_name}: {body}"}


async def _run_tool(
    ctx: Any, env: ToolEnv, tool_name: str, args: dict, result: AgentResult
) -> tuple[dict, bool]:
    """Execute one tool. Returns (transcript message, ok).

    `ok` is False when the call failed in a way the model can recover from — the
    detail is already in the message it gets back.
    """
    tool = TOOLS[tool_name]
    try:
        output = await tool.run(ctx, args, env)
    except HTTPException as exc:
        # The route handlers speak in HTTPException for user-fixable problems
        # ("Unknown category 'lunch'", "Expense not found"). That is guidance,
        # not a server fault, so it goes back to the model.
        logger.info("chat tool %s rejected: %s", tool_name, exc.detail)
        return _tool_result_message(tool_name, f"error: {exc.detail}"), False

    if tool.writes:
        result.changed = True
    if tool.summary is not None:
        try:
            result.actions.append(tool.summary(args, output))
        except Exception:  # noqa: BLE001 — a summary must never fail the call
            logger.warning("chat tool %s produced no summary", tool_name, exc_info=True)
    if isinstance(output, dict) and "download" in output:
        result.download = output["download"]

    return _tool_result_message(tool_name, output), True


async def run_agent(
    ctx: Any,
    *,
    api_key: str,
    env: ToolEnv,
    categories: list[dict],
    history: list[dict],
    confirmed: Optional[PendingAction] = None,
) -> AgentResult:
    """Answer the last message in `history`, calling tools as needed.

    `history` is the whole conversation as `{"role", "content"}` dicts, ending
    with the user's new message. `confirmed` is a previously-proposed
    confirm-required call the user has just approved: it runs first, before the
    model gets its turn, and the model then narrates the outcome.
    """
    result = AgentResult(reply="")
    transcript: list[dict] = [
        {"role": "system", "content": _system_prompt(env, categories)},
        *history[-MAX_HISTORY_MESSAGES:],
    ]

    if confirmed is not None:
        if confirmed.tool not in TOOLS:
            raise HTTPException(status_code=422, detail=f"Unknown action '{confirmed.tool}'.")
        message, _ = await _run_tool(ctx, env, confirmed.tool, confirmed.args, result)
        transcript.append(
            {"role": "user", "content": f"(The user approved: {confirmed.description})"}
        )
        transcript.append(message)

    for step in range(MAX_TOOL_STEPS):
        content, _model = await call_openai_async(api_key, transcript, json_mode=True)
        decision = _parse_decision(content)

        tool_name = decision.get("tool")
        if not tool_name:
            reply = str(decision.get("reply") or "").strip()
            if not reply:
                raise HTTPException(
                    status_code=502, detail="The assistant returned an empty reply."
                )
            result.reply = reply
            return result

        tool_name = str(tool_name)
        args = decision.get("args")
        if not isinstance(args, dict):
            args = {}

        if tool_name not in TOOLS:
            transcript.append({"role": "assistant", "content": content})
            transcript.append(
                _tool_result_message(
                    tool_name,
                    f"error: no such tool. Available: {', '.join(TOOLS)}.",
                )
            )
            continue

        tool = TOOLS[tool_name]
        already_confirmed = (
            confirmed is not None and confirmed.tool == tool_name and confirmed.args == args
        )
        if tool.confirm and not already_confirmed:
            # Stop here: the user, not the model, decides whether this runs. The
            # partial work already done (and named in `result.actions`) stands —
            # it was all non-confirming — and `reply` carries the ask.
            result.pending = PendingAction(
                tool=tool_name, args=args, description=_describe(tool_name, args)
            )
            result.reply = str(decision.get("reply") or "").strip()
            return result

        if already_confirmed:
            # The model re-proposed the call it was just told the result of.
            # Running it twice would delete twice, so answer with the result it
            # already has instead.
            transcript.append({"role": "assistant", "content": content})
            transcript.append(
                _tool_result_message(tool_name, "error: already done — tell the user the outcome.")
            )
            continue

        message, _ok = await _run_tool(ctx, env, tool_name, args, result)
        transcript.append({"role": "assistant", "content": content})
        transcript.append(message)

    logger.warning("chat agent hit the %s-step ceiling", MAX_TOOL_STEPS)
    result.reply = (
        "I ran out of steps working on that. Here's what I did complete — "
        "try asking for one thing at a time."
        if result.actions
        else "I couldn't finish that in one go. Try asking for one thing at a time."
    )
    return result
