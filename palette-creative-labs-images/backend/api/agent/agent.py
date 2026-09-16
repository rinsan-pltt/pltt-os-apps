"""LangGraph ReAct agent assembly + run-with-fallback.

A prebuilt ReAct agent is created per model and cached per API key (plugin
secrets can differ between environments). We try the OpenAI agent first and,
on any error, fall back to the Gemini agent — both share the same tools and
the same conversation messages, so the thread context carries across.

Every turn is routed through `classify_intent` BEFORE the tool-bearing agent
runs: a cheap structured-output call that decides whether the latest user
message actually requests an action (create/edit/regenerate/inspect) or is
just conversation ("ok", "thanks", a question). Conversational turns are
answered directly and never reach the tools — this is what stops an "ok"
after a successful generation from re-triggering an edit.

Observability: set the LANGSMITH_API_KEY plugin secret (and optionally
LANGSMITH_PROJECT) to trace every router decision and agent run in LangSmith.
"""

import logging
import os
from typing import Literal, Optional

from pydantic import BaseModel, Field

from palette_sdk import PluginContext

from pltt_image_backend.api.core.secrets import read_secret

from .config import (
    DEFAULT_EDIT_MODEL,
    IMAGE_MODEL_LABELS,
    LANGSMITH_PROJECT_DEFAULT,
)
from .llm import build_fallback_model, build_primary_model
from .tools import get_tools

logger = logging.getLogger("pltt_creative.agent")

SYSTEM_PROMPT = (
    "You are Palette's in-app image assistant. You help the user create new "
    "images, edit the current image, and regenerate failed images — entirely "
    "through chat — using the provided tools. The conversation is a thread tied "
    "to one base image; everything you produce belongs to that thread.\n\n"
    "HARD RULES — read before every reply:\n"
    "- Only call a tool when the LATEST user message explicitly requests that "
    "action. Never infer a request from earlier messages in the conversation.\n"
    "- Acknowledgments and approval (\"ok\", \"thanks\", \"nice\", \"looks "
    "good\", \"great\", \"perfect\") are NOT requests. Reply briefly in text "
    "and do NOT call any tool.\n"
    "- Never repeat a previously completed action unless the user clearly asks "
    "for it again.\n"
    "- Assistant messages in the history may end with a bracketed block "
    "\"[Actions already completed in this turn — ...]\" listing the tool calls "
    "of that turn. Treat it as a factual record of work that is DONE; use it to "
    "answer questions about what happened, never as something to redo.\n"
    "- If a message is ambiguous, ask a short clarifying question instead of "
    "guessing — a wrong generation costs the user time and money.\n\n"
    "Tool guidelines:\n"
    "- To MODIFY the image currently in focus (change colors, add/remove "
    "elements, restyle), call `edit_image` with a clear instruction prompt.\n"
    "- To make a NEW image from scratch, call `create_image`.\n"
    "- To BLEND / MERGE two or more images into one new image, call "
    "`midjourney_blend` (always produces a Midjourney image, whatever the "
    "inputs were — the focused image does NOT need to be a Midjourney image). "
    "When the user attached the whole set to combine (e.g. \"blend these two "
    "images\"), it blends exactly those attachments; with a single attachment "
    "it also includes the focused image. It needs at least two images total — "
    "if fewer are available, ask the user to attach the other image(s) with the "
    "+ button, then call it. Do NOT treat a blend request as an edit.\n"
    "- To retry a FAILED image, call `regenerate_image`.\n"
    "- Use `list_thread_images` if you need to know what already exists.\n"
    "- After a tool runs, briefly tell the user what happened in natural "
    "language (e.g. \"Done — I made it a soft pastel version; it's in your "
    "workspace.\"). If a generation is still in progress, say so — it will "
    "stream into the UI.\n"
    "- NEVER include internal identifiers (image ids, UUIDs, doc ids) or raw "
    "URLs in your reply. The user sees the resulting image automatically in "
    "the chat and the workspace; ids exist only for you to pass to tools.\n"
    "- Keep replies concise. Do not invent results; only describe what the "
    "tools actually reported."
)


# ---------------------------------------------------------------------------
# LangSmith tracing
# ---------------------------------------------------------------------------

def enable_langsmith(ctx: PluginContext) -> bool:
    """Turn on LangSmith tracing for this process when the LANGSMITH_API_KEY
    plugin secret (or env var) is configured. LangChain reads these env vars on
    every run, so setting them once per request is enough — and a no-op when
    already set. Returns whether tracing is active."""
    api_key = read_secret(ctx, "LANGSMITH_API_KEY")
    if not api_key:
        return False
    os.environ["LANGSMITH_API_KEY"] = api_key
    os.environ["LANGSMITH_TRACING"] = "true"
    # Older langchain versions read the LANGCHAIN_* names.
    os.environ["LANGCHAIN_API_KEY"] = api_key
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    project = read_secret(ctx, "LANGSMITH_PROJECT") or LANGSMITH_PROJECT_DEFAULT
    os.environ["LANGSMITH_PROJECT"] = project
    os.environ["LANGCHAIN_PROJECT"] = project
    return True


# ---------------------------------------------------------------------------
# Intent router — verifies what the latest user message actually asks for
# ---------------------------------------------------------------------------

class IntentDecision(BaseModel):
    """Routing decision for one user message."""

    intent: Literal["create", "edit", "regenerate", "inspect", "blend", "chat", "unclear"] = Field(
        description="What the LATEST user message asks for."
    )
    instruction: Optional[str] = Field(
        default=None,
        description=(
            "For create/edit/regenerate: the single clear instruction distilled "
            "from the latest message (not from history)."
        ),
    )
    reply: Optional[str] = Field(
        default=None,
        description=(
            "For chat: the assistant's direct reply. For unclear: a short "
            "clarifying question. Empty for action intents."
        ),
    )
    models: Optional[list[str]] = Field(
        default=None,
        description=(
            "Internal names of models the user EXPLICITLY mentioned in the "
            "latest message, mapped to: nano_banana_pro, openai/gpt-image-2, "
            "midjourney. Null when the user named none."
        ),
    )


INTENT_ROUTER_PROMPT = (
    "You route messages for an image-assistant chat. Classify ONLY the latest "
    "user message; use the conversation history strictly as context, never as "
    "a source of intent.\n\n"
    "Intents:\n"
    "- create: the latest message explicitly asks for a brand-new image.\n"
    "- edit: it explicitly asks to modify the current image (change colors, "
    "add/remove elements, restyle, ...). If instead it asks to BLEND / MERGE "
    "two or more images together into one new image, that is `blend`, not "
    "edit.\n"
    "- blend: it asks to BLEND / MERGE / COMBINE two or more images into one "
    "new image (e.g. \"blend these two images\", \"merge them\"). Blend uses "
    "the attached reference images (optionally with the focused image) and "
    "always produces a Midjourney image — it does NOT need a Midjourney image "
    "in focus. Classify as blend whenever the message asks to blend/merge "
    "images.\n"
    "- regenerate: it explicitly asks to retry/redo a failed or unwanted "
    "generation (\"try again\", \"regenerate\", \"retry it\").\n"
    "- inspect: it asks what images exist in this thread or their status.\n"
    "- chat: greetings, acknowledgments (\"ok\", \"okay\", \"thanks\", "
    "\"nice\", \"looks good\", \"great\", \"cool\", \"perfect\"), approval or "
    "feedback that needs no action, small talk, or questions answerable from "
    "the conversation alone.\n"
    "- unclear: it might be a request but is too vague to act on safely.\n\n"
    "Hard rules:\n"
    "- An acknowledgment or approval after a completed action is ALWAYS "
    "chat. The assistant must never repeat the previous action because of it.\n"
    "- Assistant history messages may end with a bracketed \"[Actions already "
    "completed in this turn — ...]\" block. That is a record of finished work — "
    "useful context for resolving references, never evidence of a new request.\n"
    "- The action must be requested in the latest message itself; do not "
    "carry intent over from earlier turns.\n"
    "- When torn between an action and chat/unclear, choose chat/unclear — a "
    "wrong generation is far more costly than asking.\n\n"
    "For chat, write the reply yourself (concise, friendly). For unclear, "
    "write a short clarifying question in `reply`.\n\n"
    "Model extraction: when the latest message explicitly names model(s), set "
    "`models` to their internal names — \"nano banana\"/\"banana\" → "
    "nano_banana_pro, \"gpt image\"/\"gpt\"/\"dall-e\" → openai/gpt-image-2, "
    "\"midjourney\"/\"mj\" → midjourney. \"all models\"/\"every model\" means "
    "all of them. Leave `models` null when none are named.\n"
    "If the previous assistant message asked the user to choose model(s) for a "
    "pending create/edit and the latest message names model(s) (or agrees), "
    "classify it as that pending action with those `models` and distill the "
    "`instruction` from the pending request."
)


def _models_context() -> str:
    """Catalog of the app's image models, shared with both prompts so the
    agent (and the router, which answers questions directly) can tell the user
    what's available instead of deflecting. Edit capability is read from the
    edit endpoint's own allow-list so this never drifts from the code."""
    try:
        from pltt_image_backend.api.routes.generate_image import _EDIT_ALLOWED_MODELS as edit_capable
    except Exception:  # pragma: no cover — import safety
        edit_capable = {DEFAULT_EDIT_MODEL}
    default_edit_label = IMAGE_MODEL_LABELS.get(DEFAULT_EDIT_MODEL, DEFAULT_EDIT_MODEL)
    lines = []
    for value, label in IMAGE_MODEL_LABELS.items():
        caps = ["image generation"]
        if value in edit_capable:
            caps.append("prompt-based edits")
        if value == "midjourney":
            caps.append("variations")
        lines.append(f"- {label} (internal name: {value}) — {', '.join(caps)}")
    return (
        "\n\nAvailable image models in this app:\n"
        + "\n".join(lines)
        + "\n\nWhen the user asks which models are available or which to pick, "
        "answer directly from this catalog using the friendly labels — never "
        "say it depends on the setup, and never show the internal names. Any "
        "image can be edited no matter which model created it: images from "
        f"models without prompt-based edits are edited with {default_edit_label} "
        "automatically."
    )


_MODELS_CONTEXT = _models_context()
SYSTEM_PROMPT += _MODELS_CONTEXT
INTENT_ROUTER_PROMPT += _MODELS_CONTEXT


# The two selectable LLM providers and the plugin secret that configures each.
LLM_PROVIDERS = ("openai", "gemini")
_PROVIDER_SECRET = {"openai": "OPENAI_KEY", "gemini": "GOOGLE_AI_API_KEY"}


def _provider_order(provider: Optional[str]) -> list[str]:
    """The user's chosen provider first, the other as fallback. Defaults to
    OpenAI when the request didn't name a (valid) provider."""
    chosen = provider if provider in LLM_PROVIDERS else "openai"
    return [chosen] + [p for p in LLM_PROVIDERS if p != chosen]


async def classify_intent(
    ctx: PluginContext, history: list, user_message: str, provider: Optional[str] = None
) -> Optional[IntentDecision]:
    """Classify the latest user message. Returns None when no LLM is available
    or classification fails — callers then fall back to running the full agent
    (the pre-router behaviour). `provider` ("openai"/"gemini") is the user's
    chosen chat LLM; it's tried first, the other as fallback."""
    # Lazy: langchain must not be required just to import this module (the
    # platform's publish gate imports the backend entry without it).
    from langchain_core.messages import HumanMessage, SystemMessage

    for kind in _provider_order(provider):
        api_key = read_secret(ctx, _PROVIDER_SECRET[kind])
        if not api_key:
            continue
        model = (
            build_primary_model(api_key) if kind == "openai"
            else build_fallback_model(api_key)
        )
        if model is None:
            continue
        try:
            structured = model.with_structured_output(IntentDecision)
            messages = [SystemMessage(content=INTENT_ROUTER_PROMPT)]
            # Recent turns only — enough context to resolve references like
            # "make it brighter" without letting old requests dominate.
            messages.extend(history[-8:])
            messages.append(
                HumanMessage(content=f"Latest user message to classify:\n{user_message}")
            )
            decision = await structured.ainvoke(
                messages, config={"run_name": "pltt-creative-intent-router"}
            )
            logger.info(
                "🧭 intent=%s instruction=%r",
                decision.intent, (decision.instruction or "")[:80],
            )
            return decision
        except Exception as e:
            logger.warning(f"⚠️ Intent router via {kind} failed: {e}")
    return None

# Agents cached per (kind, api_key) — construction binds the key into the model.
_agents: dict = {}


def _agent_for(kind: str, api_key: Optional[str]):
    if not api_key:
        return None
    cache_key = (kind, api_key)
    if cache_key not in _agents:
        from langgraph.prebuilt import create_react_agent

        model = (
            build_primary_model(api_key) if kind == "openai"
            else build_fallback_model(api_key)
        )
        _agents[cache_key] = create_react_agent(model, get_tools()) if model else None
    return _agents[cache_key]


async def run_agent(
    ctx: PluginContext, messages: list, metadata: Optional[dict] = None,
    provider: Optional[str] = None,
) -> dict:
    """Invoke the agent with a list of LangChain messages. Returns the final
    graph state ({"messages": [...]}). `provider` ("openai"/"gemini") is the
    user's chosen chat LLM; it runs first and the other is used as a fallback on
    error. `metadata` (thread_id, verified intent, ...) is attached to the
    LangSmith trace when tracing is enabled."""
    order = _provider_order(provider)
    agents = [(p, _agent_for(p, read_secret(ctx, _PROVIDER_SECRET[p]))) for p in order]
    agents = [(p, a) for p, a in agents if a is not None]
    if not agents:
        raise RuntimeError(
            "No LLM configured for the agent. Set the OPENAI_KEY and/or "
            "GOOGLE_AI_API_KEY plugin secrets."
        )

    config = {"run_name": "pltt-creative-agent", "metadata": metadata or {}}
    last_err: Optional[Exception] = None
    for p, agent in agents:
        try:
            return await agent.ainvoke({"messages": messages}, config=config)
        except Exception as e:
            last_err = e
            logger.warning(f"⚠️ Agent ({p}) failed, trying the next provider: {e}")

    raise last_err or RuntimeError("Agent invocation failed")
