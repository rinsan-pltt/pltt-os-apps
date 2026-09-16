"""Chat agent endpoints (prefix `/agent`).

A thread == one base image. The chat can create / edit / regenerate images via
the agent's tools, which drive the same generation pipeline the UI buttons use,
so the user can switch between chatting and clicking at any time.
"""

import asyncio
import logging
import re
import uuid
from typing import List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from pltt_image_backend.api.agent import db as store
from pltt_image_backend.api.agent.agent import (
    SYSTEM_PROMPT,
    classify_intent,
    enable_langsmith,
    run_agent,
)
from pltt_image_backend.api.agent.config import (
    CHAT_SETTLE_TIMEOUT_S,
    DEFAULT_EDIT_MODEL,
    DEFAULT_GENERATION_MODEL,
    IMAGE_MODEL_LABELS,
)
from pltt_image_backend.api.agent.context import AgentContext, set_agent_context
from pltt_image_backend.api.db_helpers import locate_item

logger = logging.getLogger("pltt_creative.chat")
router = PluginRouter(tags=["agent"])


class StartThreadRequest(BaseModel):
    # Open by image (get-or-create, thread id == image id), by explicit thread
    # id (reopen a persisted draft), or with neither: a fresh draft thread that
    # isn't anchored to any image until the chat generates one.
    image_id: Optional[str] = None
    thread_id: Optional[str] = None
    project_id: Optional[str] = None
    key_frame_id: Optional[str] = None


class ChatRequest(BaseModel):
    thread_id: str
    message: str
    # Set when the user answers a model-selection request: the chosen models
    # plus the pending action/instruction echoed back from `model_request`.
    models: Optional[List[str]] = None
    pending_action: Optional[str] = None
    pending_instruction: Optional[str] = None
    # Optional inpainting mask painted in the chat's mask editor, as a PNG
    # data URL: white = area the model may edit, black = area to preserve.
    # Uploaded to app storage, then passed (with the image being edited) as
    # reference images to the edit model.
    mask: Optional[str] = None
    # Storage URL of an already-uploaded mask, echoed back from
    # `model_request.mask_url` on a model-selection confirmation turn.
    mask_url: Optional[str] = None
    # URL of the image the mask was painted on (any image generated in the
    # chat, not just the newest) — the edit targets this image.
    mask_image_url: Optional[str] = None
    # Hosted URLs of reference images the user attached to this turn. For an
    # edit, the image being edited stays the FIRST/base reference and these
    # are passed to the model after it.
    reference_images: Optional[List[str]] = None
    # The LLM the user picked to drive the chat ("openai" / "gemini"); the other
    # is used as a fallback. Defaults to OpenAI when unset/unknown.
    llm: Optional[str] = None
    # Generation settings from the chat's settings popover. Applied to images
    # this turn creates; fall back to the thread's stored defaults when unset.
    # `resolution` arrives lower-cased ("hd"/"2k"/"4k"); `count` is clamped 1–4.
    aspect_ratio: Optional[str] = None
    resolution: Optional[str] = None
    count: Optional[int] = None


_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"


def _strip_internal_ids(text: str) -> str:
    """Remove internal identifiers from a user-facing reply. The prompt forbids
    them, but models occasionally parrot tool output like
    "Result: `e16096f9-…`" — this guarantees no UUID ever reaches the UI.
    History reconstruction is unaffected: tool ids live in the persisted
    `tool_calls.actions` record, not in the reply text."""
    if not text:
        return text
    # Labelled fragments first: "Result: `uuid`", "(id=uuid)", "image id: uuid".
    text = re.sub(
        rf"\(?\b(?:result|image[ _]?id|doc[ _]?id|id)s?\s*[:=]\s*`?{_UUID}`?\)?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    # Any leftover bare UUIDs (backticked or not).
    text = re.sub(rf"`?{_UUID}`?", "", text)
    # Tidy what the removals left behind: empty parens/backticks, spaces before
    # punctuation, doubled punctuation and whitespace.
    text = re.sub(r"\(\s*\)|``", "", text)
    text = re.sub(r"[ \t]+([.,;:!?])", r"\1", text)
    text = re.sub(r"([.,;:!?])\1+", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _current_image(thread: dict, images: list[dict]) -> tuple[Optional[str], Optional[str]]:
    """Newest completed image in the thread, falling back to the base image."""
    for row in reversed(images):
        if row.get("status") == "completed" and row.get("url"):
            return row["image_id"], row["url"]
    return thread.get("base_image_id"), thread.get("base_image_url")


def _models_for(action: str) -> list[str]:
    """Selectable models for an action, in UI order."""
    if action == "edit":
        from pltt_image_backend.api.routes.generate_image import _EDIT_ALLOWED_MODELS

        return [m for m in IMAGE_MODEL_LABELS if m in _EDIT_ALLOWED_MODELS]
    return list(IMAGE_MODEL_LABELS)


def _build_model_request(
    action: str,
    instruction: str,
    mask_url: Optional[str] = None,
    mask_image_url: Optional[str] = None,
    reference_images: Optional[List[str]] = None,
) -> dict:
    """The selectable-options payload the chat UI renders below the message.
    The mask (and the image it was painted on) plus any attached reference
    images are carried along so the UI can echo them back on the confirmation
    turn and the edit still applies them."""
    default = DEFAULT_GENERATION_MODEL if action == "create" else DEFAULT_EDIT_MODEL
    return {
        "action": action,
        "instruction": instruction,
        "options": [
            {"value": m, "label": IMAGE_MODEL_LABELS[m]} for m in _models_for(action)
        ],
        "default": default,
        "multi": True,
        "mask_url": mask_url,
        "mask_image_url": mask_image_url,
        "reference_images": reference_images or [],
    }


def _inline_and_cleanup_refs(urls: Optional[List[str]]) -> list[str]:
    """Inline attached reference images that live in local dev storage into
    base64 data: URIs (durable for refresh + fetchable by providers), then
    delete the local copies so `.palette/dev-storage` doesn't accumulate.
    http(s) URLs (e.g. GCS in production) are returned unchanged and never
    deleted.

    Run ONCE per turn: after a file:// URL is inlined its local file is removed,
    so a second pass over the same URL could no longer read it.
    """
    from pltt_image_backend.api.core.storage_helper import provider_safe_image_url, _unlink_local

    out: list[str] = []
    for u in (urls or []):
        if not u:
            continue
        safe = provider_safe_image_url(u)
        out.append(safe)
        # We captured the bytes into a data URI — drop the redundant local file.
        if isinstance(u, str) and u.startswith("file://") and safe != u:
            _unlink_local(u)
    return out


def _join_labels(labels: list[str]) -> str:
    if not labels:
        return ""
    return labels[0] if len(labels) == 1 else f"{', '.join(labels[:-1])} and {labels[-1]}"


def _generation_meta(agent_ctx: AgentContext) -> dict:
    """Generation tracking surfaced to the chat UI. When `pending` is true the
    reply returned before every image finished (e.g. Midjourney) — the frontend
    registers an optimistic item keyed by `generation_ids` to drive the
    `/generations/{project_id}` poll fallback (multi-worker SSE can't always
    reach the browser) and reconciles the images into the turn as they land."""
    pending = any(
        c.get("status") not in ("completed", "failed") for c in agent_ctx.created
    ) or (bool(agent_ctx.generation_ids) and not agent_ctx.created)
    return {
        "generation_ids": list(agent_ctx.generation_ids),
        "pending": pending,
        "project_id": agent_ctx.project_id,
        "key_frame_id": agent_ctx.key_frame_id,
    }


async def _persist_generating_placeholder(
    ctx: PluginContext, agent_ctx: AgentContext, action: str, models: list[str]
) -> None:
    """Persist an (empty) assistant turn carrying this turn's generation_id(s)
    BEFORE the settle wait — so a refresh mid-generation still shows the turn
    and the chat reconciles the image(s) by generation_id once they land
    (instead of the generation silently vanishing from the conversation). The
    route fills in the final reply afterwards via `store.update_message`."""
    if agent_ctx.placeholder_message_id is not None or not agent_ctx.generation_ids:
        return
    msg = await store.add_message(
        ctx, agent_ctx.thread_id, "assistant", "",
        tool_calls={
            "created": [],
            "generation_ids": list(agent_ctx.generation_ids),
            "intent": action,
            "models": models,
        },
    )
    agent_ctx.placeholder_message_id = msg.get("id")


async def _finish_assistant_message(
    ctx: PluginContext, agent_ctx: AgentContext, thread_id: str, reply: str, tool_calls: dict
) -> None:
    """Fill in the early "generating" placeholder with the final reply, or add a
    fresh assistant message when no placeholder was created (the agent path)."""
    if agent_ctx.placeholder_message_id is not None:
        await store.update_message(
            ctx, agent_ctx.placeholder_message_id, content=reply, tool_calls=tool_calls
        )
    else:
        await store.add_message(ctx, thread_id, "assistant", reply, tool_calls=tool_calls)


async def _execute_models(
    ctx: PluginContext, agent_ctx: AgentContext, action: str, instruction: str, models: list[str]
) -> str:
    """Run a verified create/edit for every selected model and return a
    user-facing summary. Deterministic — no LLM involved — so a confirmed
    selection always generates exactly what was asked, once per model."""
    from pltt_image_backend.api.agent.tools import _collect_by_generation, _poll_doc, _record

    items: list[dict] = []
    if action == "create":
        from pltt_image_backend.api.routes.generate_image import (
            ImageGenerationRequest,
            run_image_generation,
        )

        generation_id = str(uuid.uuid4())
        agent_ctx.generation_ids.append(generation_id)
        request = ImageGenerationRequest(
            prompt=instruction,
            models=models,
            params={
                "aspect_ratio": agent_ctx.aspect_ratio,
                "resolution": agent_ctx.resolution,
                "num_images": agent_ctx.num_images or 1,
            },
            project_id=agent_ctx.project_id,
            key_frame_id=agent_ctx.key_frame_id,
            generation_id=generation_id,
            source="chat",
        )
        await run_image_generation(request, ctx)
        # Record the turn NOW (with its generation_id) so a refresh mid-generation
        # keeps it in the chat and reconciles the image once it lands.
        await _persist_generating_placeholder(ctx, agent_ctx, action, models)
        # Wait only briefly: fast providers finish inside the settle window and
        # return their images inline; slow ones (Midjourney) come back as
        # pending and stream in via the frontend's poll fallback so the chat
        # request never hangs.
        items = await _collect_by_generation(
            ctx, ctx.user_id, generation_id, timeout=CHAT_SETTLE_TIMEOUT_S
        )
        for it in items:
            await _record("create", it, instruction)
    else:  # edit
        # A mask painted on a specific generated image retargets the edit to
        # that image; otherwise the thread's newest image is edited.
        edit_source = (
            agent_ctx.mask_image_url if agent_ctx.mask_url and agent_ctx.mask_image_url
            else agent_ctx.current_image_url
        )
        if not edit_source:
            return "There is no image to edit in this thread yet — generate one first."
        from pltt_image_backend.api.routes.generate_image import (
            EditImageRequest,
            edit_image_generation,
        )

        doc_ids: list[str] = []
        for m in models:
            res = await edit_image_generation(
                EditImageRequest(
                    model_name=m,
                    image_url=edit_source,
                    prompt=instruction,
                    project_id=agent_ctx.project_id,
                    key_frame_id=agent_ctx.key_frame_id,
                    aspect_ratio=agent_ctx.aspect_ratio,
                    resolution=agent_ctx.resolution,
                    # The painted mask (if any) rides along: the edit gets both
                    # the original image and the mask as references. Attached
                    # reference images follow the base image.
                    mask_url=agent_ctx.mask_url,
                    reference_images=agent_ctx.reference_images or None,
                    source="chat",
                ),
                ctx,
            )
            if res.get("doc_id"):
                doc_ids.append(res["doc_id"])
            if res.get("generation_id"):
                agent_ctx.generation_ids.append(res["generation_id"])
        # Record the turn NOW (with its generation_id[s]) so a refresh
        # mid-generation keeps it and reconciles the edited image when it lands.
        await _persist_generating_placeholder(ctx, agent_ctx, action, models)
        items = list(
            await asyncio.gather(
                *[
                    _poll_doc(ctx, ctx.user_id, d, timeout=CHAT_SETTLE_TIMEOUT_S)
                    for d in doc_ids
                ]
            )
        )
        for it in items:
            await _record("edit", it, instruction)

    if not items:
        return "The generation didn't start properly — please try again."

    def _label(it: dict) -> str:
        return IMAGE_MODEL_LABELS.get(it.get("model_name") or "", it.get("model_name") or "model")

    done = [_label(it) for it in items if it.get("status") == "completed"]
    failed = [_label(it) for it in items if it.get("status") == "failed"]
    pending = len(items) - len(done) - len(failed)
    verb = "generated" if action == "create" else "edited"
    bits: list[str] = []
    if done:
        bits.append(f"{verb} with {_join_labels(done)}")
    if failed:
        bits.append(f"{_join_labels(failed)} failed")
    if pending:
        bits.append(f"{pending} still generating — it will appear shortly")
    return f"Done — {'; '.join(bits)}." if done else f"{'; '.join(bits).capitalize()}."


async def _finalize_thread_id(
    ctx: PluginContext, thread: dict, agent_ctx: AgentContext
) -> str:
    """A draft thread (no base image) adopts the id of the first completed
    image it generates: the whole conversation is re-keyed under that image so
    an Edit click on it later reopens the same history. Anchored threads (and
    drafts whose turn produced nothing completed) keep their id."""
    if thread.get("base_image_id"):
        return thread["id"]
    anchor = next(
        (
            c for c in agent_ctx.created
            if c.get("status") == "completed" and c.get("url")
        ),
        None,
    )
    if anchor is None:
        return thread["id"]
    rekeyed = await store.rekey_thread(ctx, thread["id"], anchor)
    return rekeyed["id"] if rekeyed else thread["id"]


def _extract_actions(turn_messages: list) -> list[dict]:
    """Collect the tool calls (+ their results) the agent made this turn, as
    compact dicts for persistence: [{tool, args, result}]. Tool calls and tool
    results are matched by tool_call_id."""
    calls: dict[str, dict] = {}
    order: list[str] = []
    for msg in turn_messages:
        msg_type = getattr(msg, "type", "")
        if msg_type == "ai":
            for tc in getattr(msg, "tool_calls", None) or []:
                tc_id = tc.get("id") or f"call_{len(order)}"
                args = {
                    k: (v if isinstance(v, (int, float, bool)) else str(v)[:120])
                    for k, v in (tc.get("args") or {}).items()
                    if v is not None
                }
                calls[tc_id] = {"tool": tc.get("name"), "args": args, "result": None}
                order.append(tc_id)
        elif msg_type == "tool":
            tc_id = getattr(msg, "tool_call_id", None)
            if tc_id in calls:
                content = getattr(msg, "content", "")
                if not isinstance(content, str):
                    content = str(content)
                calls[tc_id]["result"] = content[:300]
    return [calls[i] for i in order]


def _assistant_history_content(m: dict) -> str:
    """Reconstruct an assistant turn for the LLM history: the reply text plus a
    bracketed log of the actions completed that turn, so later turns can see
    what already happened (and never redo it on an \"ok\"). Older rows without
    an `actions` record fall back to the created-images list."""
    content = m.get("content") or ""
    tc = m.get("tool_calls") or {}
    lines: list[str] = []
    mr = tc.get("model_request")
    if mr:
        lines.append(
            f"- asked the user to choose model(s) to {mr.get('action')}: "
            f"{(mr.get('instruction') or '')[:80]}"
        )
    if tc.get("models"):
        lines.append(f"- executed with models: {', '.join(tc['models'])}")
    for a in tc.get("actions") or []:
        args = a.get("args") or {}
        arg_str = ", ".join(f"{k}={v}" for k, v in args.items())
        line = f"- {a.get('tool') or 'tool'}({arg_str})"
        result = (a.get("result") or "").strip()
        if result:
            line += f" → {result[:160]}"
        lines.append(line)
    if not lines:
        for img in tc.get("created") or []:
            lines.append(
                f"- {img.get('kind') or 'image'} id={img.get('image_id')} "
                f"status={img.get('status')}"
            )
    if lines:
        content += (
            "\n\n[Actions already completed in this turn — do not repeat them "
            "unless the user explicitly asks again:\n" + "\n".join(lines) + "\n]"
        )
    return content


@router.post("/agent/threads", dependencies=[require_permission("resources:write")])
async def start_thread(
    body: StartThreadRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    """Open (or reuse) the chat thread for a given image, reopen an existing
    thread by id, or reopen/create the keyframe's draft thread.

    The keyframe-default case GET-OR-CREATEs the keyframe's un-graduated draft
    (rather than always making a new one) so a page refresh recovers the same
    in-flight conversation server-side — the client localStorage id it used to
    rely on doesn't survive a refresh in the sandboxed hosted runtime."""
    if body.image_id:
        base = await locate_item(ctx.db, ctx.user_id, body.image_id)
        if base is None:
            raise HTTPException(status_code=404, detail="Image not found")
        thread = await store.get_or_create_thread(ctx, base)
    elif body.thread_id:
        thread = await store.get_thread(ctx, body.thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Thread not found")
    else:
        thread = await store.get_or_create_draft_thread(
            ctx, project_id=body.project_id, key_frame_id=body.key_frame_id
        )
    images = await store.list_thread_images(ctx, thread["id"])
    messages = await store.get_messages(ctx, thread["id"])
    return {"thread": thread, "images": images, "messages": messages}


@router.get("/agent/threads", dependencies=[require_permission("resources:read")])
async def list_threads_endpoint(ctx: PluginContext = Depends(get_ctx)):
    return {"threads": await store.list_threads(ctx)}


@router.get("/agent/threads/{thread_id}", dependencies=[require_permission("resources:read")])
async def get_thread_endpoint(
    thread_id: str, ctx: PluginContext = Depends(get_ctx)
):
    thread = await store.get_thread(ctx, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return {
        "thread": thread,
        "images": await store.list_thread_images(ctx, thread_id),
        "messages": await store.get_messages(ctx, thread_id),
    }


@router.delete("/agent/threads/{thread_id}", dependencies=[require_permission("resources:write")])
async def delete_thread_endpoint(
    thread_id: str, ctx: PluginContext = Depends(get_ctx)
):
    if not await store.delete_thread(ctx, thread_id):
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"status": "success", "message": "Thread deleted"}


@router.post("/agent/chat", dependencies=[require_permission("resources:write")])
async def chat_endpoint(
    body: ChatRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    """Send a message to a thread. Every message is first run through the
    intent router, and only verified action requests reach the tool-bearing
    agent — acknowledgments and questions are answered directly, so they can
    never re-trigger a generation."""
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    thread = await store.get_thread(ctx, body.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    # Tracing (no-op unless the LANGSMITH_API_KEY secret is configured).
    enable_langsmith(ctx)

    images = await store.list_thread_images(ctx, thread["id"])
    cur_id, cur_url = _current_image(thread, images)

    # An inpainting mask painted for this turn: upload the PNG to app storage
    # once, then hand the hosted URL to every edit path (white = editable,
    # black = preserve). Confirmation turns echo an already-uploaded mask_url.
    mask_url = (body.mask_url or "").strip() or None
    if body.mask and not mask_url:
        from pltt_image_backend.api.core.storage_helper import upload_data_url_to_storage

        try:
            mask_url = await upload_data_url_to_storage(ctx, body.mask, "masks")
        except Exception as e:
            logger.error(f"❌ Mask upload failed (continuing without mask): {e}")

    # Inline any attached references that live in local dev storage into data
    # URIs and delete the local copies — done once here so the agent, the
    # generation, and the persisted message all use the durable URLs (and
    # dev-storage doesn't accumulate). Prod GCS https URLs pass through.
    if body.reference_images:
        body.reference_images = _inline_and_cleanup_refs(body.reference_images)

    agent_ctx = AgentContext(
        plugin_ctx=ctx,
        user_id=ctx.user_id,
        thread_id=thread["id"],
        base_image_id=thread["base_image_id"],
        current_image_id=cur_id,
        current_image_url=cur_url,
        model_name=thread.get("model_name"),
        project_id=thread.get("project_id"),
        key_frame_id=thread.get("key_frame_id"),
        # The chat's settings popover wins; fall back to the thread's defaults.
        aspect_ratio=(body.aspect_ratio or "").strip() or thread.get("aspect_ratio"),
        resolution=(body.resolution or "").strip() or thread.get("resolution"),
        num_images=min(max(int(body.count or 1), 1), 4),
        mask_url=mask_url,
        mask_image_url=(body.mask_image_url or "").strip() or None,
        reference_images=[u for u in (body.reference_images or []) if (u or "").strip()],
    )
    set_agent_context(agent_ctx)

    # Persist the chosen generation settings on the thread so they stick for the
    # next turn (and keep the thread context / any thread-derived default in
    # sync with what the user just picked in the composer).
    await store.update_thread_settings(
        ctx, thread["id"],
        aspect_ratio=(body.aspect_ratio or "").strip() or None,
        resolution=(body.resolution or "").strip() or None,
    )

    # Build the LangChain message list: system context + prior turns + new msg.
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    history = await store.get_messages(ctx, thread["id"])
    lc_history = []
    for m in history:
        if m["role"] == "user":
            lc_history.append(HumanMessage(content=m["content"]))
        elif m["role"] == "assistant":
            # Replay the turn's completed actions alongside the reply so the
            # router and the agent both see what already happened.
            lc_history.append(AIMessage(content=_assistant_history_content(m)))

    # Step 0 — the user answered a model-selection request: execute it
    # directly for every chosen model. No router, no LLM — fully deterministic.
    if body.pending_action in ("create", "edit"):
        allowed = _models_for(body.pending_action)
        selected = [m for m in (body.models or []) if m in allowed]
        if not selected:
            raise HTTPException(status_code=400, detail="No valid models selected")
        instruction = (body.pending_instruction or "").strip() or body.message
        await store.add_message(
            ctx, thread["id"], "user", body.message,
            tool_calls={"reference_images": body.reference_images} if body.reference_images else None,
        )
        reply = _strip_internal_ids(
            await _execute_models(ctx, agent_ctx, body.pending_action, instruction, selected)
        )
        gen_meta = _generation_meta(agent_ctx)
        await _finish_assistant_message(
            ctx, agent_ctx, thread["id"], reply,
            {
                "created": agent_ctx.created,
                "intent": body.pending_action,
                "models": selected,
                "generation_ids": gen_meta["generation_ids"],
            },
        )
        await store.touch_thread(ctx, thread["id"])
        return {
            "thread_id": await _finalize_thread_id(ctx, thread, agent_ctx),
            "reply": reply,
            "images": agent_ctx.created,
            "current_image_id": agent_ctx.current_image_id,
            "current_image_url": agent_ctx.current_image_url,
            "model_request": None,
            **gen_meta,
        }

    # Step 1 — verify what the latest message actually asks for. Conversational
    # turns ("ok", "thanks", questions) are answered here and NEVER reach the
    # tools; only explicit create/edit/regenerate/inspect requests run the agent.
    decision = await classify_intent(ctx, lc_history, body.message, provider=body.llm)

    # Persist the user's message before producing the reply. Attached reference
    # images ride along in tool_calls so they re-display when the thread reloads.
    await store.add_message(
        ctx, thread["id"], "user", body.message,
        tool_calls={"reference_images": body.reference_images} if body.reference_images else None,
    )

    if decision is not None and decision.intent in ("chat", "unclear"):
        reply = _strip_internal_ids((decision.reply or "").strip())
        if not reply:
            reply = (
                "Could you tell me a bit more about what you'd like me to do "
                "with the image?"
                if decision.intent == "unclear"
                else "Glad to help! Tell me when you want to create or edit an image."
            )
        await store.add_message(
            ctx, thread["id"], "assistant", reply,
            tool_calls={"created": [], "intent": decision.intent},
        )
        await store.touch_thread(ctx, thread["id"])
        return {
            "thread_id": thread["id"],
            "reply": reply,
            "images": [],
            "current_image_id": cur_id,
            "current_image_url": cur_url,
            "model_request": None,
        }

    # Step 1.5 — create/edit requests. If the user named model(s), run them all
    # directly; otherwise ask which model(s) to use (the UI renders the options
    # below the message as selectable chips, GPT Image 2 preselected).
    if decision is not None and decision.intent in ("create", "edit"):
        instruction = (decision.instruction or "").strip() or body.message
        allowed = _models_for(decision.intent)
        mentioned = [m for m in (decision.models or []) if m in allowed]

        if mentioned:
            reply = _strip_internal_ids(
                await _execute_models(ctx, agent_ctx, decision.intent, instruction, mentioned)
            )
            gen_meta = _generation_meta(agent_ctx)
            await _finish_assistant_message(
                ctx, agent_ctx, thread["id"], reply,
                {
                    "created": agent_ctx.created,
                    "intent": decision.intent,
                    "models": mentioned,
                    "generation_ids": gen_meta["generation_ids"],
                },
            )
            await store.touch_thread(ctx, thread["id"])
            return {
                "thread_id": await _finalize_thread_id(ctx, thread, agent_ctx),
                "reply": reply,
                "images": agent_ctx.created,
                "current_image_id": agent_ctx.current_image_id,
                "current_image_url": agent_ctx.current_image_url,
                "model_request": None,
                **gen_meta,
            }

        if decision.intent == "edit" and not agent_ctx.current_image_url:
            reply = "There is no image to edit in this thread yet — generate one first."
            await store.add_message(
                ctx, thread["id"], "assistant", reply,
                tool_calls={"created": [], "intent": decision.intent},
            )
            await store.touch_thread(ctx, thread["id"])
            return {
                "thread_id": thread["id"],
                "reply": reply,
                "images": [],
                "current_image_id": cur_id,
                "current_image_url": cur_url,
                "model_request": None,
            }

        model_request = _build_model_request(
            decision.intent, instruction,
            mask_url=mask_url, mask_image_url=agent_ctx.mask_image_url,
            reference_images=agent_ctx.reference_images,
        )
        verb = "generate this image" if decision.intent == "create" else "apply this edit"
        reply = (
            f"Which model would you like to use to {verb}? Select one or more "
            "below — GPT Image 2 is the default."
        )
        await store.add_message(
            ctx, thread["id"], "assistant", reply,
            tool_calls={
                "created": [],
                "intent": decision.intent,
                "model_request": model_request,
            },
        )
        await store.touch_thread(ctx, thread["id"])
        return {
            "thread_id": thread["id"],
            "reply": reply,
            "images": [],
            "current_image_id": cur_id,
            "current_image_url": cur_url,
            "model_request": model_request,
        }

    # Step 2 — verified action request (or router unavailable): run the agent.
    # Report THIS turn's settings (the composer's current choice), not the
    # thread's stored defaults — otherwise the agent would generate at a stale
    # aspect/resolution. The create/edit tools also default to these when the
    # call omits them.
    context_block = (
        f"\n\nCurrent thread context:\n"
        f"- base_image_id: {thread['base_image_id']}\n"
        f"- current_image_id: {cur_id}\n"
        f"- current_image_url: {cur_url}\n"
        f"- model: {thread.get('model_name')}\n"
        f"- aspect_ratio: {agent_ctx.aspect_ratio} | resolution: {agent_ctx.resolution}\n"
        f"  (use these exact settings unless the user explicitly asks for a different size)\n"
        f"- project_id: {thread.get('project_id')} | key_frame_id: {thread.get('key_frame_id')}"
    )
    if mask_url:
        context_block += (
            "\n- The user painted an edit mask for the current image (white = "
            "area to edit, black = area to preserve). It is applied "
            "automatically when you use the edit tool."
        )
    if agent_ctx.reference_images:
        context_block += (
            f"\n- The user attached {len(agent_ctx.reference_images)} reference "
            "image(s) to this message. For an edit they are passed to the model "
            "automatically; to BLEND/MERGE images into one, call `midjourney_blend` "
            "(it uses these attachments)."
        )
    if decision is not None:
        context_block += (
            f"\n\nVerified intent of the latest user message: {decision.intent}"
        )
        if decision.instruction:
            context_block += f"\nDistilled instruction: {decision.instruction}"

    lc_messages = [SystemMessage(content=SYSTEM_PROMPT + context_block)]
    lc_messages.extend(lc_history)
    lc_messages.append(HumanMessage(content=body.message))

    try:
        result = await run_agent(
            ctx, lc_messages,
            metadata={
                "thread_id": thread["id"],
                "intent": decision.intent if decision else "unrouted",
            },
            provider=body.llm,
        )
    except Exception as e:
        logger.error(f"❌ Agent run failed: {e}")
        raise HTTPException(status_code=502, detail=f"Agent error: {e}")

    # The final AI message is the reply. Sanitized so internal ids/UUIDs never
    # reach the UI — they stay available in the persisted actions record.
    reply = ""
    for msg in reversed(result.get("messages", [])):
        content = getattr(msg, "content", None)
        if getattr(msg, "type", "") == "ai" and content:
            reply = content if isinstance(content, str) else str(content)
            break
    reply = _strip_internal_ids(reply)

    # Persist what the agent DID this turn, not just what it said. Only the
    # messages appended beyond our input belong to this turn.
    actions = _extract_actions(result.get("messages", [])[len(lc_messages):])

    gen_meta = _generation_meta(agent_ctx)
    await store.add_message(
        ctx, thread["id"], "assistant", reply,
        tool_calls={
            "created": agent_ctx.created,
            "actions": actions,
            "intent": decision.intent if decision else "unrouted",
            "generation_ids": gen_meta["generation_ids"],
        },
    )
    await store.touch_thread(ctx, thread["id"])

    return {
        "thread_id": await _finalize_thread_id(ctx, thread, agent_ctx),
        "reply": reply,
        "images": agent_ctx.created,
        "current_image_id": agent_ctx.current_image_id,
        "current_image_url": agent_ctx.current_image_url,
        "model_request": None,
        **gen_meta,
    }
