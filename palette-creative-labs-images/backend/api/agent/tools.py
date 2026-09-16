"""Agent tools — create / edit / regenerate images and inspect the thread.

Each tool drives the *existing* generation route handlers in-process with the
request's PluginContext (so the fal/runware/midjourney + SSE pipeline and the
UI stay in sync), then polls the items table until the generation reaches a
terminal state, records the produced image against the current thread, and
returns a concise summary the LLM can relay to the user.

Polling always uses a fresh standalone session per probe: the generation
handlers commit from their own background sessions, and a one-shot NullPool
connection is the reliable way to observe those commits without colliding
with the request session.
"""

import asyncio
import logging
import uuid
from typing import Optional

from sqlalchemy import and_, select

from pltt_image_backend.api.core.bg_session import standalone_background_session
from pltt_image_backend.api.db_helpers import locate_item
from pltt_image_backend.api.models import Item

from . import db as store
from .config import (
    CHAT_SETTLE_TIMEOUT_S,
    DEFAULT_EDIT_MODEL,
    DEFAULT_GENERATION_MODEL,
    GENERATION_POLL_INTERVAL_S,
    GENERATION_POLL_TIMEOUT_S,
)
from .context import get_agent_context

logger = logging.getLogger("pltt_creative.agent.tools")


# --------------------------------------------------------------------------- #
# Internal helpers
# --------------------------------------------------------------------------- #

async def _poll_doc(pctx, user_id: str, doc_id: str, timeout: float | None = None) -> dict:
    """Poll a single item by id until it completes/fails or times out."""
    limit = GENERATION_POLL_TIMEOUT_S if timeout is None else timeout
    waited = 0.0
    last: dict = {}
    while waited <= limit:
        async with standalone_background_session(pctx) as db:
            item = await locate_item(db, user_id, doc_id)
        if item:
            last = item
            if item.get("status") in ("completed", "failed"):
                return item
        await asyncio.sleep(GENERATION_POLL_INTERVAL_S)
        waited += GENERATION_POLL_INTERVAL_S
    return last


async def _collect_by_generation(
    pctx, user_id: str, generation_id: str, timeout: float | None = None
) -> list[dict]:
    """Poll for the item(s) produced by a `/generate/image` call until they
    reach a terminal state or time out."""
    from pltt_image_backend.api.db_helpers import _item_to_dict

    limit = GENERATION_POLL_TIMEOUT_S if timeout is None else timeout
    waited = 0.0
    found: list[dict] = []
    while waited <= limit:
        async with standalone_background_session(pctx) as db:
            res = await db.execute(
                select(Item).where(
                    and_(Item.user_id == user_id, Item.generation_id == generation_id)
                )
            )
            items = [_item_to_dict(i) for i in res.scalars().all()]
        if items:
            found = items
            if all(it.get("status") in ("completed", "failed") for it in items):
                return items
        await asyncio.sleep(GENERATION_POLL_INTERVAL_S)
        waited += GENERATION_POLL_INTERVAL_S
    return found


async def _record(kind: str, item: dict, prompt: Optional[str]) -> None:
    """Record a produced image on the current thread and the turn's output."""
    ctx = get_agent_context()
    image_id = item.get("id")
    if not image_id:
        return
    ctx.created.append({
        "image_id": image_id,
        "kind": kind,
        "status": item.get("status"),
        "url": item.get("url"),
        "prompt": prompt or item.get("prompt"),
    })
    try:
        # If a previous turn already seeded this id (e.g. a regenerated base
        # image), update it; otherwise insert.
        existing = await store.add_thread_image(
            ctx.plugin_ctx, ctx.thread_id, image_id, kind,
            prompt=prompt or item.get("prompt"),
            url=item.get("url"), status=item.get("status"), dedupe=True,
        )
        if existing is None:
            await store.update_thread_image(
                ctx.plugin_ctx, ctx.thread_id, image_id,
                url=item.get("url"), status=item.get("status"),
            )
    except Exception as e:  # pragma: no cover - best effort
        logger.warning(f"⚠️ failed to record thread image {image_id}: {e}")
    # Advance the chat's focus to the freshly produced image when it succeeded.
    if item.get("status") == "completed" and item.get("url"):
        ctx.current_image_id = image_id
        ctx.current_image_url = item.get("url")


def _summary(items: list[dict]) -> str:
    out = []
    for it in items:
        if it.get("status") == "completed":
            out.append(f"id={it.get('id')} status=completed url={it.get('url')}")
        elif it.get("status") == "failed":
            out.append(f"id={it.get('id')} status=failed error={it.get('error_message') or it.get('error')}")
        else:
            out.append(f"id={it.get('id')} status={it.get('status') or 'pending'} (still generating; will appear in the UI)")
    return "; ".join(out) if out else "no result yet (still generating; it will appear in the UI shortly)"


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #

async def create_image(
    prompt: str,
    model_name: Optional[str] = None,
    aspect_ratio: Optional[str] = None,
    resolution: Optional[str] = None,
) -> str:
    """Generate a brand-new image from a text prompt in the current thread's
    project/keyframe. Use this when the user asks to *create/generate* a new
    image (not modify the existing one). `model_name` must be one of:
    "nano_banana_pro", "openai/gpt-image-2", "midjourney" — it defaults to the
    thread's model; `aspect_ratio` (e.g. "1:1", "16:9", "9:16") and
    `resolution` ("HD"/"2K"/"4K") default to the base image's settings."""
    from pltt_image_backend.api.routes.generate_image import (
        ImageGenerationRequest,
        run_image_generation,
    )

    ctx = get_agent_context()
    # GPT Image 2 unless the user (or the router) named a model explicitly.
    model = model_name or DEFAULT_GENERATION_MODEL
    generation_id = str(uuid.uuid4())
    ctx.generation_ids.append(generation_id)
    request = ImageGenerationRequest(
        prompt=prompt,
        models=[model],
        params={
            "aspect_ratio": aspect_ratio or ctx.aspect_ratio,
            "resolution": resolution or ctx.resolution,
            "num_images": ctx.num_images or 1,
        },
        project_id=ctx.project_id,
        key_frame_id=ctx.key_frame_id,
        generation_id=generation_id,
        source="chat",
    )
    try:
        await run_image_generation(request, ctx.plugin_ctx)
    except Exception as e:
        return f"Could not start the generation: {e}"
    items = await _collect_by_generation(
        ctx.plugin_ctx, ctx.user_id, generation_id, timeout=CHAT_SETTLE_TIMEOUT_S
    )
    for it in items:
        await _record("create", it, prompt)
    return f"Started a new generation with {model}. Result(s): {_summary(items)}"


async def edit_image(prompt: str, model_name: Optional[str] = None) -> str:
    """Edit the image the chat is currently focused on using an instruction
    prompt (e.g. "make the sky purple", "remove the person on the left").
    Produces a new edited image in the same thread. Only reference-capable
    models can edit; if the current model can't, a suitable edit model is used
    automatically."""
    from pltt_image_backend.api.routes.generate_image import (
        _EDIT_ALLOWED_MODELS,
        EditImageRequest,
        edit_image_generation,
    )

    ctx = get_agent_context()
    # A mask painted on a specific generated image retargets the edit to that
    # image; otherwise the thread's newest image is edited.
    edit_source = (
        ctx.mask_image_url if ctx.mask_url and ctx.mask_image_url
        else ctx.current_image_url
    )
    if not edit_source:
        return "There is no image to edit in this thread yet."
    # GPT Image 2 unless the user named an edit-capable model explicitly.
    model = model_name or DEFAULT_EDIT_MODEL
    if model not in _EDIT_ALLOWED_MODELS:
        model = DEFAULT_EDIT_MODEL
    request = EditImageRequest(
        model_name=model,
        image_url=edit_source,
        prompt=prompt,
        project_id=ctx.project_id,
        key_frame_id=ctx.key_frame_id,
        aspect_ratio=ctx.aspect_ratio,
        resolution=ctx.resolution,
        # Mask painted for this turn (if any): the edit passes both the image
        # and the mask as references (white = editable, black = preserve).
        # Reference images attached to the turn follow the base image.
        mask_url=ctx.mask_url,
        reference_images=ctx.reference_images or None,
        source="chat",
    )
    try:
        res = await edit_image_generation(request, ctx.plugin_ctx)
    except Exception as e:
        return f"Could not start the edit: {e}"
    doc_id = res.get("doc_id")
    if not doc_id:
        return "Edit started but no document id was returned."
    if res.get("generation_id"):
        ctx.generation_ids.append(res["generation_id"])
    item = await _poll_doc(
        ctx.plugin_ctx, ctx.user_id, doc_id, timeout=CHAT_SETTLE_TIMEOUT_S
    )
    await _record("edit", item, prompt)
    return f"Edited the image with {model}. Result: {_summary([item])}"


async def regenerate_image(image_id: Optional[str] = None) -> str:
    """Regenerate (retry) a FAILED image in this thread, re-running the same
    model and parameters. Defaults to the image the chat is focused on; pass
    `image_id` to retry a specific one."""
    from pltt_image_backend.api.routes.generate_image import (
        ImageGenerationRequest,
        ImageReference,
        run_image_generation,
    )

    ctx = get_agent_context()
    doc_id = image_id
    # "Try again" after a failure must retry the FAILED item itself — it carries
    # the edit prompt + its source/reference images. The chat's current-image
    # focus tracks the newest COMPLETED image and skips failed ones, so without
    # this we'd re-run the base image and lose the references. Prefer the newest
    # failed image in the thread.
    if not doc_id:
        try:
            rows = await store.list_thread_images(ctx.plugin_ctx, ctx.thread_id)
            failed = [r for r in rows if r.get("status") == "failed" and r.get("image_id")]
            if failed:
                doc_id = failed[-1]["image_id"]
        except Exception as e:  # pragma: no cover - best effort
            logger.warning(f"⚠️ failed to look up failed thread image: {e}")
    doc_id = doc_id or ctx.current_image_id or ctx.base_image_id
    if not doc_id:
        return "No image id available to regenerate."
    async with standalone_background_session(ctx.plugin_ctx) as db:
        source = await locate_item(db, ctx.user_id, doc_id)
    if not source:
        return f"Image {doc_id} was not found."

    # There is no dedicated retry endpoint on this platform — re-run the
    # source's stored prompt/model/params as a fresh generation instead.
    params = dict(source.get("gen_params") or {})
    params.setdefault("aspect_ratio", source.get("aspect_ratio"))
    params.setdefault("resolution", source.get("resolution"))
    params["num_images"] = 1
    refs = [
        ImageReference(url=u) if isinstance(u, str) else ImageReference(**u)
        for u in (params.pop("image_references", None) or [])
        if u
    ]
    generation_id = str(uuid.uuid4())
    ctx.generation_ids.append(generation_id)
    request = ImageGenerationRequest(
        prompt=source.get("prompt") or "",
        models=[source.get("model_name")],
        params=params,
        image_references=refs or None,
        project_id=source.get("project_id"),
        key_frame_id=source.get("key_frame_id"),
        generation_id=generation_id,
        source="chat",
    )
    try:
        await run_image_generation(request, ctx.plugin_ctx)
    except Exception as e:
        return f"Could not start the regeneration: {e}"
    items = await _collect_by_generation(
        ctx.plugin_ctx, ctx.user_id, generation_id, timeout=CHAT_SETTLE_TIMEOUT_S
    )
    for it in items:
        await _record("regenerate", it, it.get("prompt"))
    return f"Regenerated image {doc_id}. Result: {_summary(items)}"


async def midjourney_blend(dimensions: Optional[str] = None) -> str:
    """Blend two or more images into one NEW image using Midjourney blend
    (always produces a Midjourney image, whatever the inputs were). When the
    user attached the whole set to combine (e.g. "blend these two images"),
    blends exactly those attachments; with a single attachment, blends it with
    the focused image. Needs at least two images total — if fewer are available,
    ask the user to attach the other image(s) with the + button. `dimensions` is
    one of PORTRAIT, SQUARE (default), or LANDSCAPE. The focused image does NOT
    need to be a Midjourney image."""
    from pltt_image_backend.api.routes.generate_image import (
        MidjourneyBlendRequest,
        midjourney_blend_generation,
    )

    ctx = get_agent_context()
    refs = [u for u in (ctx.reference_images or []) if u]
    # The user attached the set to combine → blend exactly those; a single
    # attachment → blend it with the focused image.
    if len(refs) >= 2:
        images = refs
    else:
        images = ([ctx.current_image_url] if ctx.current_image_url else []) + refs
    if len(images) < 2:
        return (
            "Blend needs at least two images. Ask the user to attach the other "
            "image(s) with the + button, then try again."
        )
    images = images[:5]
    request = MidjourneyBlendRequest(
        image_urls=images,
        dimensions=(dimensions or "SQUARE"),
        project_id=ctx.project_id,
        key_frame_id=ctx.key_frame_id,
        source="chat",
    )
    try:
        res = await midjourney_blend_generation(request, ctx.plugin_ctx)
    except Exception as e:
        return f"Could not start the blend: {e}"
    doc_id = res.get("doc_id")
    if not doc_id:
        return "Blend started but no document id was returned."
    if res.get("generation_id"):
        ctx.generation_ids.append(res["generation_id"])
    item = await _poll_doc(
        ctx.plugin_ctx, ctx.user_id, doc_id, timeout=CHAT_SETTLE_TIMEOUT_S
    )
    await _record("midjourney", item, "Blend")
    return f"Blended {len(images)} images with Midjourney. Result: {_summary([item])}"


async def list_thread_images() -> str:
    """List the images in the current thread (the base image and everything
    created/edited/regenerated from it) with their status and ids."""
    ctx = get_agent_context()
    rows = await store.list_thread_images(ctx.plugin_ctx, ctx.thread_id)
    if not rows:
        return "No images in this thread yet."
    return "\n".join(
        f"- {r['kind']} id={r['image_id']} status={r.get('status')} prompt={(r.get('prompt') or '')[:60]}"
        for r in rows
    )


# langchain is imported lazily: the platform's publish gate imports the
# backend entry in an environment without the agent's LLM dependencies, and a
# module-level `from langchain_core.tools import tool` there would fail the
# import of the whole routes package (and with it the route gate).
_TOOLS: Optional[list] = None


def get_tools() -> list:
    """The agent's tools, wrapped with `@tool` on first use."""
    global _TOOLS
    if _TOOLS is None:
        from langchain_core.tools import tool

        _TOOLS = [
            tool(create_image),
            tool(edit_image),
            tool(regenerate_image),
            tool(midjourney_blend),
            tool(list_thread_images),
        ]
    return _TOOLS
