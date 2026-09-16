"""Image generation endpoints.

Ported from pltt-agg's routes/generate_image.py. Replaces:
  * `core.security.get_current_user_id`  → `ctx.user_id`
  * `core.database.*`                    → pltt_image_backend.api.db_helpers
  * `core.gcs_helper.*`                  → backend.core.storage_helper (ctx.storage)
  * env API keys                         → `ctx.secret(...)`
  * SSE broadcast keyed on user_id       → keyed on ctx.organization_id

For correctness this is the full multi-model + Midjourney + actions flow.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import uuid
from typing import Optional

import anyio
import fal_client
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from pltt_image_backend.api.db_helpers import (
    add_assets_to_key_frame,
    create_initial_item,
    find_existing_action_item,
    get_key_frame,
    get_project,
    locate_item,
    save_assets,
    set_item_fields,
    set_key_frame_prompt,
    touch_project,
    update_item_failed,
    update_item_success,
    update_project_thumbnail,
)
from pltt_image_backend.api.core.fal_helper import generate_image, upscale_image
from pltt_image_backend.api.core.midjourney_helper import (
    ACTION_MAP,
    blend_midjourney_images,
    fetch_midjourney_job,
    perform_midjourney_action,
    submit_midjourney_job,
    _build_prompt as _build_midjourney_prompt,
)
from pltt_image_backend.api.core.runware_helper import (
    aspect_ratio_to_dimensions,
    generate_image_runware,
    get_runware_model,
)
from pltt_image_backend.api.core.router_helper import (
    RouterUnavailable,
    apply_secrets as apply_router_secrets,
    generate_image_router,
    edit_image_router,
    upscale_image_router,
    midjourney_generate_router,
)
from pltt_image_backend.api.core.sse_manager import broadcast_event, broadcast_event_threadsafe, bind_user_id
from pltt_image_backend.api.core.storage_helper import upload_media_to_storage, provider_safe_image_url, resize_and_store
from pltt_image_backend.api.core.bg_session import background_session, standalone_background_session
from pltt_image_backend.api.core.secrets import read_secret as _secret

logger = logging.getLogger("pltt_creative.generate_image")


def _router_size(aspect_ratio: Optional[str], resolution: Optional[str]) -> Optional[str]:
    """Build the router's `size` ("WxH") from the app's aspect ratio + resolution.
    Returns None when it can't be computed (the router then uses its default)."""
    try:
        w, h = aspect_ratio_to_dimensions(aspect_ratio or "1:1", resolution or "1K")
        return f"{int(w)}x{int(h)}"
    except Exception:
        return None
router = PluginRouter(tags=["generate-image"])


class ImageReference(BaseModel):
    id: Optional[str] = None
    url: str


class ImageGenerationRequest(BaseModel):
    prompt: str
    models: Optional[List[str]] = []
    params: Optional[Dict[str, Any]] = {}
    image_references: Optional[List[ImageReference]] = None
    project_id: Optional[str] = None
    key_frame_id: Optional[str] = None
    # Optional client-supplied UUID. When provided, the backend uses it as
    # the canonical generation_id for the run so the frontend can stamp its
    # optimistic placeholders with the same id BEFORE the POST returns, and
    # avoid a duplicate card when the SSE "started" event lands first.
    generation_id: Optional[str] = None
    # Where the generation was initiated from: "chat" when the agent's tools
    # drive it, otherwise unset (the PROMPT panel posts directly). Stamped into
    # the item's gen_params so the SSE "started" event carries it and the chat
    # UI can show "Generating…" only for its OWN generations.
    source: Optional[str] = None
    # Retry an EXISTING failed item in place: when set, the run regenerates into
    # that item (reset to in_progress, then completed/failed) instead of creating
    # a new one — so a retry doesn't spawn a second card. Forces num_images=1.
    retry_doc_id: Optional[str] = None


async def _resolve_image_references(db, refs, organization_id: int, user_id: str) -> List[str]:
    fresh: list[str] = []
    out: list[str] = []
    for ref in refs or []:
        ref_id = getattr(ref, "id", None) if not isinstance(ref, dict) else ref.get("id")
        ref_url = getattr(ref, "url", None) if not isinstance(ref, dict) else ref.get("url")
        if not ref_url:
            continue
        out.append(ref_url)
        if not ref_id:
            fresh.append(ref_url)
    if fresh:
        try:
            await save_assets(db, organization_id, user_id, fresh)
        except Exception as e:
            logger.warning(f"⚠️ Failed to persist fresh refs: {e}")
    return out


def _build_model_payload(actual_model_name: str, request, merged_params: dict, num_images: int) -> dict:
    model_payload: dict = {}
    # Reference/edit images must be fetchable by the provider — local dev
    # file:// URLs are inlined as data URIs (the stored references stay as-is).
    safe_refs = [provider_safe_image_url(u) for u in (request.image_references or [])]
    if "nano_banana" in actual_model_name:
        nb_ratios = {"auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"}
        nb_res = {"1K", "2K", "4K"}
        res = merged_params.get("resolution")
        model_payload["resolution"] = res.upper() if isinstance(res, str) and res.upper() in nb_res else "1K"
        ar = merged_params.get("aspect_ratio")
        if isinstance(ar, str) and ar in nb_ratios:
            model_payload["aspect_ratio"] = ar
        model_payload["num_images"] = num_images
        if safe_refs:
            model_payload["image_urls"] = safe_refs
    elif "flux" in actual_model_name:
        model_payload["num_images"] = num_images
        if "aspect_ratio" in merged_params:
            ar_map = {
                "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9",
                "4:3": "landscape_4_3", "3:4": "portrait_4_3",
            }
            model_payload["image_size"] = ar_map.get(merged_params["aspect_ratio"], "square_hd")
    elif "openai" in actual_model_name:
        model_payload["num_images"] = num_images
        model_payload["quality"] = merged_params.get("quality", "low")
        if safe_refs:
            model_payload["image_urls"] = safe_refs
        base = {"1K": 1024, "2K": 2048, "4K": 4096}.get(merged_params.get("resolution", "AUTO"), 1024)
        ar = merged_params.get("aspect_ratio", "1:1")
        if ar == "16:9":
            w, h = base, int(base * 9 / 16)
        elif ar == "9:16":
            w, h = int(base * 9 / 16), base
        elif ar == "4:3":
            w, h = base, int(base * 3 / 4)
        elif ar == "3:4":
            w, h = int(base * 3 / 4), base
        elif ar == "21:9":
            w, h = base, int(base * 9 / 21)
        else:
            w, h = base, base
        model_payload["image_size"] = {"width": w, "height": h}
    return model_payload


@router.post("/generate/image", dependencies=[require_permission("resources:write")])
async def run_image_generation(
    request: ImageGenerationRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    org_id = ctx.organization_id
    bind_user_id(ctx.user_id)

    if request.project_id:
        project = await get_project(ctx.db, ctx.user_id, request.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.get("type") != "image":
            raise HTTPException(status_code=400, detail="Project type is not 'image'")
        if not request.key_frame_id:
            raise HTTPException(status_code=400, detail="key_frame_id is required when project_id is provided")
        project_id = request.project_id
    else:
        project_id = str(uuid.uuid4())

    # Honour a client-supplied generation_id so the frontend optimistic
    # placeholder and the SSE events share the same id from the first frame.
    # Fall back to a server-generated UUID for callers that don't send one.
    generation_id = (request.generation_id or "").strip() or str(uuid.uuid4())
    models_to_run = request.models if request.models else ["flux_schnell"]

    if request.project_id:
        kf = await get_key_frame(ctx.db, ctx.user_id, project_id, request.key_frame_id)
        if kf is None:
            raise HTTPException(status_code=404, detail="Key frame not found")
        key_frame_id = kf["id"]
        await set_key_frame_prompt(ctx.db, ctx.user_id, project_id, key_frame_id, request.prompt)
    else:
        key_frame_id = None

    if request.image_references:
        request.image_references = await _resolve_image_references(
            ctx.db, request.image_references, ctx.organization_id, ctx.user_id
        )

    if request.project_id and key_frame_id and request.image_references:
        await add_assets_to_key_frame(ctx.db, ctx.organization_id, key_frame_id, request.image_references)

    merged_params: dict = (request.params or {}).copy()
    if request.image_references:
        merged_params["image_references"] = request.image_references
    if request.source:
        merged_params["source"] = request.source
    if "resolution" in merged_params and isinstance(merged_params["resolution"], str):
        if merged_params["resolution"].lower() == "auto":
            del merged_params["resolution"]
        else:
            merged_params["resolution"] = merged_params["resolution"].upper()

    # Surface the resolved generation settings — confirms (in prod logs) that the
    # composer's aspect/resolution actually reached the pipeline for every model.
    logger.info(
        f"🎛️  [Gen] models={models_to_run} source={merged_params.get('source')} "
        f"aspect_ratio={merged_params.get('aspect_ratio')} "
        f"resolution={merged_params.get('resolution')} "
        f"num_images={merged_params.get('num_images')}"
    )

    # Resolve the router config from the platform secret store so it's tried
    # first in production too (not just `pltt dev`). Without this it reads only
    # process env, which is empty in the published runtime → router disabled.
    apply_router_secrets(ctx)

    fal_key = _secret(ctx, "FAL_KEY")
    runware_key = _secret(ctx, "RUNWARE_KEY")
    midjourney_key = _secret(ctx, "MIDJOURNEY_KEY")
    midjourney_fallback_key = _secret(ctx, "MIDJOURNEY_TT_API_KEY_FALLBACK")

    # Validate only the provider keys actually required by the requested
    # models, and name the correct key in the error. A Midjourney-only request
    # must not fail on FAL_KEY (it needs MIDJOURNEY_KEY), and a Fal request must
    # not be reported as a Midjourney problem.
    needs_fal = any(m != "midjourney" for m in models_to_run)
    needs_midjourney = "midjourney" in models_to_run
    missing: list[str] = []
    if needs_fal and not fal_key:
        missing.append("FAL_KEY")
    if needs_midjourney and not (midjourney_key or midjourney_fallback_key):
        missing.append("MIDJOURNEY_KEY")
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"{' and '.join(missing)} is not configured for this environment.",
        )

    # Retry-in-place: regenerate into the existing failed item instead of making
    # a new one (no second card). Force a single image, and reset the item to
    # in_progress NOW (synchronously) so a client refresh right after this
    # returns shows the SAME card regenerating rather than the stale failure.
    if request.retry_doc_id:
        merged_params["num_images"] = 1
        try:
            existing = await locate_item(ctx.db, ctx.user_id, request.retry_doc_id)
            # Keep the retry in the SAME batch as the failed item: reuse the
            # item's OWN generation_id for every broadcast/record, never a fresh
            # one (a different id would group the regenerated image into a new
            # batch — the "stray card next to the failed one").
            if existing and existing.get("generation_id"):
                generation_id = existing["generation_id"]
            # Retry is a right-side action — drop any "chat" source so the chat
            # indicator doesn't fire (unless this request is itself a chat turn).
            gp = dict((existing or {}).get("gen_params") or {})
            if request.source:
                gp["source"] = request.source
            else:
                gp.pop("source", None)
            reset = await set_item_fields(
                ctx.db, request.retry_doc_id,
                {"status": "in_progress", "error_message": None, "url": None, "gen_params": gp},
            )
            if reset:
                await broadcast_event(
                    org_id, "started",
                    {**reset, "project_id": project_id, "generation_id": generation_id},
                    request.retry_doc_id, project_id,
                )
        except Exception as e:  # pragma: no cover - best effort
            logger.warning(f"⚠️ retry reset failed for {request.retry_doc_id}: {e}")

    async def _make_doc(db, model_name: str) -> dict:
        """Reuse the failed item for a retry (reset to in_progress), otherwise
        create a fresh item. Retry always runs a single image, so reusing the
        one id is safe."""
        if request.retry_doc_id:
            existing = await locate_item(db, ctx.user_id, request.retry_doc_id)
            if existing:
                # Retry is a RIGHT-SIDE action — drop any "chat" source so the
                # chat's "Generating…" indicator doesn't fire for it (unless the
                # request itself is a chat turn, which sets request.source).
                gp = dict(existing.get("gen_params") or {})
                if request.source:
                    gp["source"] = request.source
                else:
                    gp.pop("source", None)
                await set_item_fields(
                    db, request.retry_doc_id,
                    {"status": "in_progress", "error_message": None, "url": None, "gen_params": gp},
                )
                return {**existing, "status": "in_progress", "url": None, "gen_params": gp}
        return await create_initial_item(
            db,
            organization_id=ctx.organization_id, user_id=ctx.user_id, type="image",
            model_name=model_name, prompt=request.prompt, params=merged_params,
            project_id=project_id, key_frame_id=key_frame_id, generation_id=generation_id,
        )

    async def _midjourney_task(model_name: str) -> list:
        num_images = merged_params.get("num_images", 1)

        async def _one() -> dict:
            # The per-image runs (and the sibling model tasks) execute
            # concurrently, so each owns its OWN session/connection — a single
            # AsyncSession can't service concurrent operations.
            async with standalone_background_session(ctx) as db:
                doc = await _make_doc(db, model_name)
                record_id = doc["id"]
                await broadcast_event(
                    org_id, "started",
                    {**doc, "project_id": project_id, "generation_id": generation_id},
                    record_id, project_id,
                )
                try:
                    grid_job_id = None
                    final_image_url = None
                    final_job_id = None
                    # Provider order: router → TTAPI. The router runs imagine + U1
                    # internally and hands back the grid + the upscaled image.
                    try:
                        mj_prompt = _build_midjourney_prompt(
                            request.prompt,
                            merged_params.get("aspect_ratio"),
                            request.image_references or [],
                        )
                        r = await midjourney_generate_router(mj_prompt)
                        grid_job_id = r.get("grid_job_id")
                        final_image_url = r.get("image_url")
                        final_job_id = r.get("upscale_job_id")
                        if grid_job_id:
                            await set_item_fields(db, record_id, {"midjourney_job_id": grid_job_id})
                    except RouterUnavailable:
                        pass
                    except Exception as router_err:
                        logger.warning(f"⚠️ [Router] midjourney create failed: {router_err}. Trying TTAPI…")

                    if not final_image_url:
                        # Step 1: submit the imagine job. This produces the 4-grid
                        # internally; we never surface it to the user — we just need
                        # its job_id so we can pull a single quadrant out via U1, and
                        # so subsequent Variation clicks can chain Un / V actions
                        # against the same grid.
                        grid_job_id = await submit_midjourney_job(
                            midjourney_key, request.prompt,
                            aspect_ratio=merged_params.get("aspect_ratio"),
                            image_references=request.image_references or [],
                            fallback_api_key=midjourney_fallback_key,
                        )
                        await set_item_fields(db, record_id, {"midjourney_job_id": grid_job_id})
                        # Step 2: wait for the grid to finish —
                        # perform_midjourney_action requires a completed source job.
                        await fetch_midjourney_job(
                            midjourney_key, grid_job_id, fallback_api_key=midjourney_fallback_key
                        )
                        # Step 3: pull U1 of the grid and return that single image
                        # as the item's URL. The grid composite is intentionally
                        # discarded; we keep the grid's job_id so future variations
                        # know which lineage to advance.
                        u1 = await perform_midjourney_action(
                            midjourney_key, grid_job_id, "U1", fallback_api_key=midjourney_fallback_key
                        )
                        final_image_url = u1["image_url"]
                        final_job_id = u1["job_id"]
                    # Midjourney renders at its own native resolution; normalize
                    # the result to the same pixel dimensions other models use for
                    # this aspect + resolution, so MJ images match Nano Banana Pro
                    # / GPT Image 2 in size (the aspect is already set via --ar).
                    mj_ar = merged_params.get("aspect_ratio")
                    try:
                        # Only normalize when an aspect was actually requested.
                        # Defaulting to "1:1" here would SQUARE a portrait/
                        # landscape result whenever the aspect failed to reach
                        # the pipeline — resize_and_store(0,0) instead keeps
                        # Midjourney's native output (which already honors --ar).
                        if mj_ar:
                            tw, th = aspect_ratio_to_dimensions(
                                mj_ar, merged_params.get("resolution") or "1K"
                            )
                        else:
                            tw, th = 0, 0
                    except Exception:
                        tw, th = 0, 0
                    stored = await resize_and_store(ctx, final_image_url, tw, th, "images")
                    final = await update_item_success(
                        db, record_id,
                        url=stored,
                        all_generated_urls=[{
                            "provider": "midjourney",
                            "url": stored,
                            "job_id": final_job_id,
                            "action": "U1",
                        }],
                    )
                    final = await set_item_fields(
                        db, record_id,
                        {
                            "midjourney_job_id": grid_job_id,
                            "midjourney_action": "U1",
                            # Fresh U1 of its grid → position 1, walk not started.
                            "midjourney_grid_position": 1,
                            "midjourney_var_grid": grid_job_id,
                            "midjourney_var_position": 1,
                            "midjourney_var_step": 0,
                            "is_favourite": True,
                        },
                    ) or final
                    await broadcast_event(org_id, "completed", final, record_id, project_id)
                    return final
                except Exception as e:
                    logger.error(f"❌ [MJ] {e}")
                    failed = await update_item_failed(db, record_id, str(e))
                    await broadcast_event(org_id, "failed", failed, record_id, project_id)
                    return failed

        results = await asyncio.gather(*[_one() for _ in range(max(1, num_images))])
        return [r for r in results if r]

    async def _single_model_task(model_name: str) -> list:
        if model_name == "midjourney":
            return await _midjourney_task(model_name)

        # The per-model tasks run CONCURRENTLY (asyncio.gather below), so each
        # owns its OWN session/connection — a single AsyncSession can't service
        # concurrent operations. Sharing ctx.db across models made every DB
        # write race ("another operation is in progress"), so no items were
        # ever persisted on multi-model runs.
        async with standalone_background_session(ctx) as db:
            loop = asyncio.get_running_loop()
            num_images = merged_params.get("num_images", 1)
            docs = []
            for _ in range(num_images):
                doc = await _make_doc(db, model_name)
                docs.append(doc)
            record_ids = [d["id"] for d in docs]
            for d in docs:
                await broadcast_event(
                    org_id, "started",
                    {**d, "project_id": project_id, "generation_id": generation_id},
                    d["id"], project_id,
                )

            def on_fal_update(update):
                for rid in record_ids:
                    data = {
                        "model_name": model_name,
                        "project_id": project_id,
                        "generation_id": generation_id,
                        "key_frame_id": key_frame_id,
                        "id": rid,
                        "status": "processing",
                        "prompt": request.prompt,
                        "aspect_ratio": merged_params.get("aspect_ratio"),
                        "resolution": merged_params.get("resolution"),
                    }
                    if isinstance(update, fal_client.InProgress):
                        data["logs"] = [log["message"] for log in update.logs]
                    elif isinstance(update, fal_client.Queued):
                        data["position"] = update.position
                    broadcast_event_threadsafe(loop, org_id, "processing", data, rid, project_id, ctx.user_id)

            model_payload = _build_model_payload(model_name, request, merged_params, num_images)
            final_docs: list = []

            # Provider order: router → fal → runware. Try the router first; on
            # success record its image(s) and skip the providers below. When the
            # turn carries reference images it's an edit (router /image/edit),
            # otherwise a text-to-image (/image).
            router_refs = [
                provider_safe_image_url(u) for u in (merged_params.get("image_references") or [])
            ]
            router_urls: list[str] = []
            try:
                if router_refs:
                    router_urls = await edit_image_router(
                        model_name, request.prompt, router_refs[0], router_refs[1:],
                    )
                else:
                    router_urls = await generate_image_router(
                        model_name,
                        request.prompt,
                        aspect_ratio=merged_params.get("aspect_ratio"),
                        resolution=merged_params.get("resolution"),
                        num_images=num_images,
                    )
            except RouterUnavailable:
                pass
            except Exception as router_err:
                logger.warning(f"⚠️ [Router] create '{model_name}' failed: {router_err}. Trying fal…")

            if router_urls:
                for i, rid in enumerate(record_ids):
                    if i < len(router_urls):
                        stored = await upload_media_to_storage(ctx, router_urls[i], "images")
                        final = await update_item_success(db, rid, url=stored)
                        final = await set_item_fields(db, rid, {"is_favourite": True}) or final
                        await broadcast_event(org_id, "completed", final, rid, project_id)
                    else:
                        final = await update_item_failed(db, rid, "Router: insufficient images returned")
                        await broadcast_event(org_id, "failed", final, rid, project_id)
                    final_docs.append(final)
                return final_docs

            try:
                res = await anyio.to_thread.run_sync(
                    functools.partial(
                        generate_image, fal_key, model_name, request.prompt,
                        on_progress=on_fal_update, **model_payload,
                    )
                )
                generated = res.get("images", [])
                for i, rid in enumerate(record_ids):
                    if i < len(generated):
                        img_url = generated[i].get("url")
                        stored = await upload_media_to_storage(ctx, img_url, "images")
                        final = await update_item_success(db, rid, url=stored)
                        final = await set_item_fields(db, rid, {"is_favourite": True}) or final
                        await broadcast_event(org_id, "completed", final, rid, project_id)
                    else:
                        final = await update_item_failed(db, rid, "Image not found in result set")
                        await broadcast_event(org_id, "failed", final, rid, project_id)
                    final_docs.append(final)
            except Exception as fal_err:
                logger.warning(f"⚠️ [Fal] {model_name} failed: {fal_err}. Trying Runware fallback...")
                air = get_runware_model(model_name)
                if air and runware_key:
                    try:
                        ar = merged_params.get("aspect_ratio", "1:1")
                        res_label = merged_params.get("resolution", "1K")
                        w, h = aspect_ratio_to_dimensions(ar, res_label, air)
                        urls = await generate_image_runware(
                            runware_key, air, request.prompt, w, h, num_images
                        )
                        for i, rid in enumerate(record_ids):
                            if i < len(urls):
                                stored = await upload_media_to_storage(ctx, urls[i], "images")
                                final = await update_item_success(db, rid, url=stored)
                                final = await set_item_fields(db, rid, {"is_favourite": True}) or final
                                await broadcast_event(org_id, "completed", final, rid, project_id)
                            else:
                                final = await update_item_failed(db, rid, "Runware: insufficient images")
                                await broadcast_event(org_id, "failed", final, rid, project_id)
                            final_docs.append(final)
                    except Exception as rw_err:
                        logger.error(f"❌ [Runware] also failed: {rw_err}")
                        # Store the Runware error — it carries the real reason (e.g.
                        # an OpenAI safety-system rejection) the UI classifies as
                        # content moderation.
                        for rid in record_ids:
                            final = await update_item_failed(db, rid, str(rw_err))
                            await broadcast_event(org_id, "failed", final, rid, project_id)
                            final_docs.append(final)
                else:
                    for rid in record_ids:
                        final = await update_item_failed(db, rid, str(fal_err))
                        await broadcast_event(org_id, "failed", final, rid, project_id)
                        final_docs.append(final)
            return final_docs

    async def _bg():
        try:
            results = await asyncio.gather(
                *[_single_model_task(m) for m in models_to_run], return_exceptions=True
            )
            latest_url = None
            for m, r in zip(models_to_run, results):
                if isinstance(r, BaseException):
                    logger.error(f"❌ Model task '{m}' crashed: {r!r}")
            for r in results:
                if isinstance(r, list):
                    for d in r:
                        if d and d.get("status") == "completed" and d.get("url"):
                            latest_url = d["url"]
            if request.project_id:
                # `_bg` is detached (create_task) so it outlives the request —
                # `ctx.db` is closed by then. Use an own session, like every
                # other generation endpoint's `_bg`.
                async with standalone_background_session(ctx) as db:
                    await touch_project(db, ctx.user_id, request.project_id)
                    if latest_url:
                        await update_project_thumbnail(db, ctx.user_id, request.project_id, latest_url)
        except Exception as e:
            logger.error(f"❌ Background image gen crashed: {e}")

    # Fire-and-forget, exactly like the edit / blend / upscale / action / video
    # endpoints. Awaiting it here blocked the HTTP request for the full provider
    # run — up to Midjourney's 10-min poll — so in production the proxy killed
    # the request mid-generation (cancelling the work) and the chat appeared to
    # hang. Detaching returns immediately; progress flows over SSE, and the
    # frontend's `/generations/{project_id}` poll fallback covers multi-worker
    # deployments where SSE can't reach the browser.
    asyncio.create_task(_bg())

    return {
        "status": "pending",
        "project_id": project_id,
        "generation_id": generation_id,
        "message": "Generation started. Subscribe to /events/{project_id} for SSE updates.",
    }


# ---------------------------------------------------------------------------
# Midjourney action endpoint (U1–U4 upscale, V1–V4 variation)
# ---------------------------------------------------------------------------

class MidjourneyActionRequest(BaseModel):
    doc_id: str
    action: List[str]


@router.post(
    "/generate/midjourney/action",
    dependencies=[require_permission("resources:write")],
)
async def midjourney_action(
    body: MidjourneyActionRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    org_id = ctx.organization_id
    bind_user_id(ctx.user_id)
    if not body.action:
        raise HTTPException(status_code=400, detail="action list cannot be empty")
    actions = [a.upper().strip() for a in body.action]
    invalid = [a for a in actions if a not in ACTION_MAP]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid actions {invalid}")

    source = await locate_item(ctx.db, ctx.user_id, body.doc_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source image not found")
    src_project_id = source.get("project_id")
    src_key_frame_id = source.get("key_frame_id")
    job_id = source.get("midjourney_job_id")
    if not job_id:
        raise HTTPException(status_code=400, detail="Source has no midjourney_job_id")

    prompt = source.get("prompt") or ""
    merged_params = {
        "aspect_ratio": source.get("aspect_ratio"),
        "resolution": source.get("resolution"),
        "image_references": source.get("image_references") or [],
    }
    new_generation_id = str(uuid.uuid4())
    midjourney_key = _secret(ctx, "MIDJOURNEY_KEY")
    midjourney_fallback_key = _secret(ctx, "MIDJOURNEY_TT_API_KEY_FALLBACK")

    async def _run_one(action: str) -> dict:
        # Each action runs concurrently, so it owns its OWN session/connection
        # (a single AsyncSession can't service concurrent operations). The org
        # RLS context is applied per-connection by the engine connect event.
        async with standalone_background_session(ctx) as db:
            if action.startswith("U"):
                existing = await find_existing_action_item(db, ctx.user_id, body.doc_id, action)
                if existing and existing.get("url"):
                    return {"action": action, "status": "completed", "item": {**existing, "reused": True}, "url": existing["url"], "reused": True}
            new_doc = await create_initial_item(
                db,
                organization_id=ctx.organization_id, user_id=ctx.user_id, type="image", model_name="midjourney",
                prompt=prompt, params=merged_params,
                project_id=src_project_id, key_frame_id=src_key_frame_id,
                generation_id=new_generation_id,
            )
            new_id = new_doc["id"]
            await broadcast_event(
                org_id, "started",
                {**new_doc, "project_id": src_project_id, "generation_id": new_generation_id, "action": action},
                new_id, src_project_id,
            )
            try:
                result = await perform_midjourney_action(
                    midjourney_key, job_id, action, fallback_api_key=midjourney_fallback_key
                )
                stored = await upload_media_to_storage(ctx, result["image_url"], "images")
                final = await update_item_success(db, new_id, url=stored)
                extra = {
                    "source_doc_id": body.doc_id,
                    "midjourney_action": action,
                    "is_sample": action.startswith("V"),
                    "is_favourite": True,
                }
                if result.get("job_id"):
                    extra["midjourney_job_id"] = result["job_id"]
                final = await set_item_fields(db, new_id, extra) or final
                await broadcast_event(org_id, "completed", final, new_id, src_project_id)
                return {"action": action, "status": "completed", "item": final, "url": stored}
            except Exception as e:
                logger.error(f"❌ [MJ action {action}] {e}")
                failed = await update_item_failed(db, new_id, str(e))
                await broadcast_event(org_id, "failed", failed, new_id, src_project_id)
                return {"action": action, "status": "failed", "item": failed, "error": str(e)}

    async def _bg():
        try:
            # Run the actions in PARALLEL — each has its own session, so there's
            # no shared-connection contention.
            results = await asyncio.gather(*[_run_one(a) for a in actions], return_exceptions=True)
            latest = None
            for r in results:
                if isinstance(r, dict) and r.get("status") == "completed" and r.get("url"):
                    latest = r["url"]
            if src_project_id and latest:
                async with standalone_background_session(ctx) as db:
                    await update_project_thumbnail(db, ctx.user_id, src_project_id, latest)
        except Exception as e:
            logger.error(f"❌ MJ action batch crashed: {e}")

    asyncio.create_task(_bg())

    return {
        "status": "pending",
        "source_doc_id": body.doc_id,
        "project_id": src_project_id,
        "generation_id": new_generation_id,
        "message": "Action started.",
    }


class MidjourneyBlendRequest(BaseModel):
    image_urls: List[str]
    dimensions: Optional[str] = "SQUARE"
    project_id: Optional[str] = None
    key_frame_id: Optional[str] = None
    # See ImageGenerationRequest.source — "chat" when the agent drives the blend.
    source: Optional[str] = None


@router.post(
    "/generate/midjourney/blend",
    dependencies=[require_permission("resources:write")],
)
async def midjourney_blend_generation(
    body: MidjourneyBlendRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    """Blend 2–5 images into one new image via Midjourney."""
    org_id = ctx.organization_id
    bind_user_id(ctx.user_id)
    urls = [u for u in (body.image_urls or []) if (u or "").strip()]
    if not 2 <= len(urls) <= 5:
        raise HTTPException(status_code=400, detail="blend requires between 2 and 5 images")

    project_id = body.project_id
    key_frame_id = body.key_frame_id
    midjourney_key = _secret(ctx, "MIDJOURNEY_KEY")
    midjourney_fallback_key = _secret(ctx, "MIDJOURNEY_TT_API_KEY_FALLBACK")
    if not (midjourney_key or midjourney_fallback_key):
        raise HTTPException(status_code=400, detail="MIDJOURNEY_KEY is not configured")

    generation_id = str(uuid.uuid4())
    blend_params: dict = {"image_references": urls}
    if body.source:
        blend_params["source"] = body.source
    new_doc = await create_initial_item(
        ctx.db,
        organization_id=ctx.organization_id, user_id=ctx.user_id, type="image", model_name="midjourney",
        prompt="Blend", params=blend_params,
        project_id=project_id, key_frame_id=key_frame_id, generation_id=generation_id,
    )
    new_id = new_doc["id"]
    await broadcast_event(
        org_id, "started",
        {**new_doc, "project_id": project_id, "generation_id": generation_id},
        new_id, project_id,
    )

    async def _bg():
        async with standalone_background_session(ctx) as db:
            try:
                # Inputs must be fetchable by the provider — inline local dev
                # file:// URLs as data URIs.
                safe_urls = [provider_safe_image_url(u) for u in urls]
                # Blend produces a 4-grid; auto-upscale U1 and surface that single
                # image (never the grid), mirroring normal Midjourney generation.
                blend = await blend_midjourney_images(
                    midjourney_key, safe_urls, dimensions=body.dimensions or "SQUARE",
                    fallback_api_key=midjourney_fallback_key,
                )
                grid_job = blend.get("job_id")
                if not grid_job:
                    raise RuntimeError("Blend returned no job id")
                up = await perform_midjourney_action(
                    midjourney_key, grid_job, "U1", fallback_api_key=midjourney_fallback_key
                )
                final_url = up.get("image_url")
                if not final_url:
                    raise RuntimeError("Blend U1 upscale returned no image")
                stored = await upload_media_to_storage(ctx, final_url, "images")
                final = await update_item_success(
                    db, new_id, url=stored,
                    all_generated_urls=[{
                        "provider": "midjourney", "url": stored,
                        "job_id": up.get("job_id"), "action": "U1",
                    }],
                )
                final = await set_item_fields(
                    db, new_id,
                    {
                        # The blend grid this image belongs to — so a later
                        # variation walks U2→U3→U4 then rolls, like any MJ image.
                        "midjourney_job_id": grid_job,
                        "midjourney_action": "U1",
                        "midjourney_grid_position": 1,
                        "midjourney_var_grid": grid_job,
                        "midjourney_var_position": 1,
                        "midjourney_var_step": 0,
                        "is_favourite": True,
                    },
                ) or final
                if project_id:
                    await update_project_thumbnail(db, ctx.user_id, project_id, final.get("url"))
                await broadcast_event(org_id, "completed", final, new_id, project_id)
            except Exception as e:
                logger.error(f"❌ [MJ blend] {e}")
                failed = await update_item_failed(db, new_id, str(e))
                await broadcast_event(org_id, "failed", failed, new_id, project_id)

    asyncio.create_task(_bg())
    return {
        "status": "pending",
        "doc_id": new_id,
        "generation_id": generation_id,
        "project_id": project_id,
        "message": "Blend started. Subscribe to the SSE stream for the result.",
    }


# ---------------------------------------------------------------------------
# Others action endpoint (U1 upscale, V1 regenerate-variant for non-MJ models)
# ---------------------------------------------------------------------------

_SEEDVR_DEFAULTS = {
    "upscale_mode": "factor",
    "upscale_factor": 2,
    "target_resolution": "1080p",
    "noise_scale": 0.1,
    "output_format": "png",
}
_OTHERS_ALLOWED = {"U1", "V1"}

# Midjourney "Variation" stepper. The initial gen, and every Variation click,
# lands the surfaced item on U1 of *some* imagine grid (its midjourney_action
# is therefore "U<n>" and its midjourney_job_id is that grid). A Variation
# click on a U<n> item means "give me a fresh take on this quadrant": we run
# V<n> against its grid — which produces a brand-new grid — and then U1 of the
# new grid to surface a single image. The chain returned here is fed in order
# through `perform_midjourney_action(grid_job_id, …)`; the V<n> step's job_id
# becomes the parent for the following U1 step, the U1 step's image_url is what
# we surface, and the new grid's job_id is stamped on the item so the *next*
# Variation click chains a fresh V/U1 off it (never re-running V<n> on the same
# grid, which TTAPI rejects with "Job already exists").


def _mj_variation_state(item: dict) -> tuple[Optional[str], int, int]:
    """Read an image's Midjourney variation-walk state: (grid_job, position, step).

    - grid_job: the grid the walk currently operates on.
    - position: this image's quadrant within that grid (1–4).
    - step:     how many sibling quadrants of the grid have already been surfaced
                (0–3); on a position-1 image the next variation surfaces U{step+2},
                and at step 3 it rolls V1 onto a fresh grid.

    Falls back to the image's base grid / its U-number / step 0 for images created
    before these fields existed.
    """
    grid = item.get("midjourney_var_grid") or item.get("midjourney_job_id")
    pos = item.get("midjourney_var_position")
    if pos is None:
        pos = item.get("midjourney_grid_position")
    if pos is None:
        label = (item.get("midjourney_action") or "U1").upper()
        pos = int(label[1:]) if len(label) >= 2 and label[1:].isdigit() else 1
    step = item.get("midjourney_var_step") or 0
    return grid, int(pos), int(step)


class OthersActionRequest(BaseModel):
    doc_id: str
    action: str
    model_name: Optional[str] = None


@router.post(
    "/generate/others/action",
    dependencies=[require_permission("resources:write")],
)
async def others_action(
    body: OthersActionRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    org_id = ctx.organization_id
    bind_user_id(ctx.user_id)
    action = body.action.upper().strip()
    if action not in _OTHERS_ALLOWED:
        raise HTTPException(status_code=400, detail=f"Invalid action '{body.action}'")

    source = await locate_item(ctx.db, ctx.user_id, body.doc_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source image not found")
    src_project_id = source.get("project_id")
    src_key_frame_id = source.get("key_frame_id")
    source_url = source.get("url")
    if action == "U1" and not source_url:
        raise HTTPException(status_code=400, detail="Source has no URL to upscale")
    source_model = (body.model_name or "").strip()
    if action == "V1" and not source_model:
        raise HTTPException(status_code=400, detail="model_name required to regenerate variant")

    source_prompt = source.get("prompt") or ""
    source_aspect = source.get("aspect_ratio")
    source_res = source.get("resolution")
    source_refs = source.get("image_references") or []
    # Full params used to generate the source. A "Variation" reuses these so it
    # matches the base image's settings (quality, num_images, etc.). Legacy
    # items predating gen_params fall back to the individually-stored fields.
    source_gen_params = source.get("gen_params") or {}
    new_generation_id = str(uuid.uuid4())
    fal_key = _secret(ctx, "FAL_KEY")
    midjourney_key = _secret(ctx, "MIDJOURNEY_KEY")
    midjourney_fallback_key = _secret(ctx, "MIDJOURNEY_TT_API_KEY_FALLBACK")
    if not fal_key:
        raise HTTPException(
            status_code=503,
            detail="FAL_KEY is not configured for this environment.",
        )

    if action == "U1":
        new_model = "seedvr_upscale"
        initial_refs = [source_url]
        init_params = {
            "aspect_ratio": source_aspect,
            "resolution": source_res,
            "image_references": initial_refs,
        }
    else:
        new_model = source_model
        initial_refs = source_refs
        # Carry the source's full generation params forward so the variation
        # regenerates with the base settings, and so its own gen_params let the
        # next "Variation" click chain identically.
        init_params = {
            **source_gen_params,
            "aspect_ratio": source_gen_params.get("aspect_ratio", source_aspect),
            "resolution": source_gen_params.get("resolution", source_res),
            "image_references": initial_refs,
        }
        # A variation is a RIGHT-SIDE workspace action, not a chat turn — drop any
        # inherited `source` ("chat") so the chat panel's "Generating…" indicator
        # (which keys on gen_params.source === "chat") doesn't fire for it.
        init_params.pop("source", None)

    new_doc = await create_initial_item(
        ctx.db,
        organization_id=ctx.organization_id, user_id=ctx.user_id, type="image", model_name=new_model,
        prompt=source_prompt,
        params=init_params,
        project_id=src_project_id, key_frame_id=src_key_frame_id,
        generation_id=new_generation_id,
    )
    new_id = new_doc["id"]

    updated_source = None
    if action == "U1":
        # Point the base/source image at its (pending) upscale result and
        # broadcast so the card reflects the in-progress state immediately.
        # is_upscaled stays False until the upscale actually lands (see _bg) —
        # the button reads "Upscaling…" while upscaled_doc_id is set but
        # is_upscaled is False, then "Upscaled" once it completes. The failure
        # path clears upscaled_doc_id to re-enable the button.
        updated_source = await set_item_fields(
            ctx.db, body.doc_id, {"upscaled_doc_id": new_id}
        )
        if updated_source:
            await broadcast_event(
                org_id, "completed", updated_source, body.doc_id, src_project_id
            )

    await broadcast_event(
        org_id, "started",
        {**new_doc, "project_id": src_project_id, "generation_id": new_generation_id, "action": action},
        new_id, src_project_id,
    )

    async def _bg():
        async with background_session(ctx):
            try:
                if action == "U1":
                    # Stream upscale progress through the same SSE structure as
                    # generations — "processing" events for the new upscale item
                    # carry fal queue position / logs while the job runs.
                    loop = asyncio.get_running_loop()

                    def on_upscale_progress(update):
                        data = {
                            "model_name": new_model,
                            "project_id": src_project_id,
                            "generation_id": new_generation_id,
                            "key_frame_id": src_key_frame_id,
                            "id": new_id,
                            "status": "processing",
                            "prompt": source_prompt,
                            "aspect_ratio": source_aspect,
                            "resolution": source_res,
                            "action": action,
                        }
                        if isinstance(update, fal_client.InProgress):
                            data["logs"] = [log["message"] for log in update.logs]
                        elif isinstance(update, fal_client.Queued):
                            data["position"] = update.position
                        broadcast_event_threadsafe(
                            loop, org_id, "processing", data, new_id, src_project_id, ctx.user_id
                        )

                    # Provider order: router (SeedVR) → fal (SeedVR). The source
                    # must be fetchable by the provider — inline local file://.
                    safe_source_url = provider_safe_image_url(source_url)
                    out_url = None
                    try:
                        router_urls = await upscale_image_router(safe_source_url)
                        if router_urls:
                            out_url = router_urls[0]
                    except RouterUnavailable:
                        pass
                    except Exception as router_err:
                        logger.warning(f"⚠️ [Router] upscale failed: {router_err}. Trying fal SeedVR…")

                    if not out_url:
                        result = await anyio.to_thread.run_sync(
                            functools.partial(
                                upscale_image, fal_key, safe_source_url,
                                on_progress=on_upscale_progress, **_SEEDVR_DEFAULTS,
                            )
                        )
                        out_url = (
                            (result.get("image") or {}).get("url")
                            or result.get("image_url")
                            or result.get("url")
                        )
                    if not out_url:
                        raise RuntimeError("Upscale missing url (router + fal)")
                    stored = await upload_media_to_storage(ctx, out_url, "images")
                    final = await update_item_success(ctx.db, new_id, url=stored)
                    final = await set_item_fields(
                        ctx.db, new_id,
                        {
                            "source_doc_id": body.doc_id,
                            "midjourney_action": action,
                            "is_upscale_image": True,
                            "url_before_upscale": source_url,
                            "is_favourite": True,
                        },
                    ) or final
                else:
                    if source_model == "midjourney":
                        grid, position, step = _mj_variation_state(source)
                        if not grid:
                            raise RuntimeError(
                                "Midjourney source is missing midjourney_job_id; cannot run variation"
                            )

                        # Variation walk, driven by the image's quadrant position:
                        #   • A position-1 image surfaces its grid's other
                        #     quadrants first (U2→U3→U4), then on the 4th rolls V1
                        #     onto a FRESH grid and continues walking that one.
                        #   • A position-N (N≠1) image immediately rolls V<N> onto
                        #     a fresh grid, then walks that grid as a position-1
                        #     image.
                        # Each produced image stores the job id of the grid it
                        # belongs to, and the source's walk pointer advances on
                        # every click.
                        if position == 1 and step < 3:
                            # Surface the next sibling quadrant of the current grid.
                            final_action = f"U{step + 2}"
                            await set_item_fields(
                                ctx.db, new_id,
                                {"midjourney_job_id": grid, "midjourney_action": final_action},
                            )
                            step_result = await perform_midjourney_action(
                                midjourney_key, grid, final_action,
                                fallback_api_key=midjourney_fallback_key,
                            )
                            result_grid = grid
                            result_position = step + 2
                            result_url = step_result["image_url"]
                            result_action_job_id = step_result["job_id"]
                            source_state = {
                                "midjourney_var_grid": grid,
                                "midjourney_var_position": 1,
                                "midjourney_var_step": step + 1,
                            }
                        else:
                            # Roll: vary this image's quadrant to spawn a new grid,
                            # then surface U1 of it.
                            vary = await perform_midjourney_action(
                                midjourney_key, grid, f"V{position}",
                                fallback_api_key=midjourney_fallback_key,
                            )
                            new_grid = vary["job_id"]
                            await set_item_fields(
                                ctx.db, new_id,
                                {"midjourney_job_id": new_grid, "midjourney_action": "U1"},
                            )
                            up = await perform_midjourney_action(
                                midjourney_key, new_grid, "U1",
                                fallback_api_key=midjourney_fallback_key,
                            )
                            final_action = "U1"
                            result_grid = new_grid
                            result_position = 1
                            result_url = up["image_url"]
                            result_action_job_id = up["job_id"]
                            source_state = {
                                "midjourney_var_grid": new_grid,
                                "midjourney_var_position": 1,
                                "midjourney_var_step": 0,
                            }

                        if not result_url:
                            raise RuntimeError("MJ variation produced no image")
                        stored = await upload_media_to_storage(ctx, result_url, "images")
                        final = await update_item_success(
                            ctx.db, new_id,
                            url=stored,
                            all_generated_urls=[{
                                "provider": "midjourney",
                                "url": stored,
                                "job_id": result_action_job_id,
                                "action": final_action,
                            }],
                        )
                        final = await set_item_fields(
                            ctx.db, new_id,
                            {
                                "source_doc_id": body.doc_id,
                                # The grid this image belongs to — its job id, so
                                # any further action on it uses the right grid.
                                "midjourney_job_id": result_grid,
                                "midjourney_action": final_action,
                                # This image's quadrant within its grid + a fresh
                                # walk pointer, so its own future variations follow
                                # the rule.
                                "midjourney_grid_position": result_position,
                                "midjourney_var_grid": result_grid,
                                "midjourney_var_position": result_position,
                                "midjourney_var_step": 0,
                                "is_favourite": True,
                            },
                        ) or final
                        # Advance the SOURCE image's walk pointer so repeated
                        # variations of the same image step through the sequence.
                        await set_item_fields(ctx.db, body.doc_id, source_state)
                    else:
                        # Regenerate using the source's full generation params
                        # (quality, image settings, …) so the variation matches
                        # how the base image was produced — only the image
                        # count is forced to 1 for a single variation.
                        variation_refs = init_params.get("image_references") or source_refs
                        class _FakeReq:
                            image_references = variation_refs
                        payload = _build_model_payload(source_model, _FakeReq(), init_params, 1)
                        res = await anyio.to_thread.run_sync(
                            functools.partial(generate_image, fal_key, source_model, source_prompt, **payload)
                        )
                        images = res.get("images") or []
                        if not images or not images[0].get("url"):
                            raise RuntimeError(f"Variant missing url: {res}")
                        stored = await upload_media_to_storage(ctx, images[0]["url"], "images")
                        final = await update_item_success(ctx.db, new_id, url=stored)
                        final = await set_item_fields(
                            ctx.db, new_id,
                            {"source_doc_id": body.doc_id, "midjourney_action": action, "is_favourite": True},
                        ) or final
                if src_project_id:
                    await update_project_thumbnail(ctx.db, ctx.user_id, src_project_id, final.get("url"))
                await broadcast_event(org_id, "completed", final, new_id, src_project_id)
                # The upscale landed — flip the base image to the final
                # "Upscaled" state so its button settles from "Upscaling…".
                if action == "U1":
                    upscaled_base = await set_item_fields(
                        ctx.db, body.doc_id, {"is_upscaled": True, "upscaled_doc_id": new_id}
                    )
                    if upscaled_base:
                        await broadcast_event(
                            org_id, "completed", upscaled_base, body.doc_id, src_project_id
                        )
            except Exception as e:
                logger.error(f"❌ Others action {action} failed: {e}")
                failed = await update_item_failed(ctx.db, new_id, str(e))
                await broadcast_event(org_id, "failed", failed, new_id, src_project_id)
                # The base image was put into the "Upscaling…" state on click;
                # the upscale never landed, so clear the pending pointer and
                # re-broadcast to re-enable the Upscale button.
                if action == "U1":
                    reverted = await set_item_fields(
                        ctx.db, body.doc_id, {"is_upscaled": False, "upscaled_doc_id": None}
                    )
                    if reverted:
                        await broadcast_event(
                            org_id, "completed", reverted, body.doc_id, src_project_id
                        )

    asyncio.create_task(_bg())

    response: dict = {
        "status": "pending",
        "action": action,
        "source_doc_id": body.doc_id,
        "project_id": src_project_id,
        "generation_id": new_generation_id,
    }
    if action == "U1":
        response["is_upscale_image"] = True
        response["url_before_upscale"] = source_url
        response["source_item"] = updated_source
    return response


# ---------------------------------------------------------------------------
# Edit endpoint — generate a new image from a source image + an edit prompt.
# Uses the source image as a reference; supported for reference-capable models
# (nano_banana_pro, openai/gpt-image-2). Produces a NEW image record.
# ---------------------------------------------------------------------------

_EDIT_ALLOWED_MODELS = {"nano_banana_pro", "openai/gpt-image-2"}


class EditImageRequest(BaseModel):
    model_name: str
    image_url: str
    prompt: str
    project_id: Optional[str] = None
    key_frame_id: Optional[str] = None
    aspect_ratio: Optional[str] = None
    resolution: Optional[str] = None
    # Optional inpainting mask (already hosted): white = area the model may
    # edit, black = area to preserve. Passed alongside the source image as a
    # second reference.
    mask_url: Optional[str] = None
    # Optional additional reference images (already hosted). The source image
    # stays the FIRST/base reference; these follow it (and the mask, when
    # present, stays last).
    reference_images: Optional[List[str]] = None
    # See ImageGenerationRequest.source — "chat" when the agent drives the edit.
    source: Optional[str] = None


# Appended to the model prompt (NOT the stored item prompt) when a mask rides
# along, so reference-driven edit models know how to read the second image.
_MASK_PROMPT_NOTE = (
    "\n\nThe last reference image is an edit mask for the first image: "
    "white (opaque) areas mark the ONLY region you may change; black "
    "(transparent) areas must be preserved exactly as in the original."
)


@router.post(
    "/generate/image/edit",
    dependencies=[require_permission("resources:write")],
)
async def edit_image_generation(
    body: EditImageRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    org_id = ctx.organization_id
    bind_user_id(ctx.user_id)

    if body.model_name not in _EDIT_ALLOWED_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Edit is not supported for model '{body.model_name}'. Allowed: {sorted(_EDIT_ALLOWED_MODELS)}",
        )
    if not body.image_url:
        raise HTTPException(status_code=400, detail="image_url is required")
    if not (body.prompt or "").strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    if body.project_id and not body.key_frame_id:
        raise HTTPException(status_code=400, detail="key_frame_id is required when project_id is provided")

    model_name = body.model_name
    prompt = body.prompt.strip()
    image_url = body.image_url
    project_id = body.project_id
    key_frame_id = body.key_frame_id
    aspect_ratio = body.aspect_ratio
    resolution = body.resolution
    generation_id = str(uuid.uuid4())
    # Reference order: the image being edited FIRST (the base reference), then
    # any user-attached reference images, then the mask LAST (the mask prompt
    # note tells the model the last reference is the mask). The stored prompt
    # stays clean — only the model prompt gets the mask note.
    extra_refs = [u for u in (body.reference_images or []) if (u or "").strip()]
    references = [image_url, *extra_refs] + ([body.mask_url] if body.mask_url else [])
    model_prompt = prompt + (_MASK_PROMPT_NOTE if body.mask_url else "")
    init_params = {
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "image_references": references,
    }
    if body.source:
        init_params["source"] = body.source

    apply_router_secrets(ctx)
    fal_key = _secret(ctx, "FAL_KEY")
    runware_key = _secret(ctx, "RUNWARE_KEY")

    new_doc = await create_initial_item(
        ctx.db,
        organization_id=ctx.organization_id, user_id=ctx.user_id, type="image",
        model_name=model_name, prompt=prompt, params=init_params,
        project_id=project_id, key_frame_id=key_frame_id, generation_id=generation_id,
    )
    new_id = new_doc["id"]
    await broadcast_event(
        org_id, "started",
        {**new_doc, "project_id": project_id, "generation_id": generation_id},
        new_id, project_id,
    )

    async def _bg():
        # Own session/connection — the chat agent can run several edits (one
        # per selected model) concurrently on the same request ctx, and a
        # ctx.db-swapping background_session would make those tasks race.
        async with standalone_background_session(ctx) as db:
            loop = asyncio.get_running_loop()

            def on_progress(update):
                data = {
                    "model_name": model_name, "project_id": project_id,
                    "generation_id": generation_id, "key_frame_id": key_frame_id,
                    "id": new_id, "status": "processing", "prompt": prompt,
                    "aspect_ratio": aspect_ratio, "resolution": resolution,
                }
                if isinstance(update, fal_client.InProgress):
                    data["logs"] = [log["message"] for log in update.logs]
                elif isinstance(update, fal_client.Queued):
                    data["position"] = update.position
                broadcast_event_threadsafe(loop, org_id, "processing", data, new_id, project_id, ctx.user_id)

            try:
                # References must be fetchable by the providers — local dev
                # file:// URLs are inlined as data URIs. (The stored references
                # keep their original URLs.)
                safe_references = [provider_safe_image_url(u) for u in references]
                src_url = None

                # Provider order: router → fal → runware. The image being edited
                # is the subject; extra refs + mask ride along as references.
                try:
                    router_urls = await edit_image_router(
                        model_name, model_prompt, safe_references[0], safe_references[1:]
                    )
                    if router_urls:
                        src_url = router_urls[0]
                except RouterUnavailable:
                    pass  # disabled / no router model → fal
                except Exception as router_err:
                    logger.warning(f"⚠️ [Router] edit '{model_name}' failed: {router_err}. Trying fal...")

                if src_url is None:
                    class _FakeReq:
                        image_references = references

                    payload = _build_model_payload(model_name, _FakeReq(), init_params, 1)
                    try:
                        if not fal_key:
                            raise RuntimeError("FAL_KEY is not configured")
                        res = await anyio.to_thread.run_sync(
                            functools.partial(generate_image, fal_key, model_name, model_prompt, on_progress=on_progress, **payload)
                        )
                        images = res.get("images") or []
                        if not images or not images[0].get("url"):
                            raise RuntimeError("Image not found in result set")
                        src_url = images[0]["url"]
                    except Exception as fal_err:
                        air = get_runware_model(model_name)
                        if not (air and runware_key):
                            raise
                        logger.warning(f"⚠️ [Fal] edit '{model_name}' failed: {fal_err}. Trying Runware fallback...")
                        w, h = aspect_ratio_to_dimensions(aspect_ratio or "1:1", resolution or "1K", air)
                        urls = await generate_image_runware(
                            runware_key, air, model_prompt, w, h, 1, reference_images=safe_references
                        )
                        if not urls:
                            raise RuntimeError("Runware fallback returned no images")
                        src_url = urls[0]

                stored = await upload_media_to_storage(ctx, src_url, "images")
                final = await update_item_success(db, new_id, url=stored)
                final = await set_item_fields(db, new_id, {"is_favourite": True}) or final
                if project_id:
                    await update_project_thumbnail(db, ctx.user_id, project_id, final.get("url"))
                await broadcast_event(org_id, "completed", final, new_id, project_id)
            except Exception as e:
                logger.error(f"❌ Edit failed for {new_id}: {e}")
                failed = await update_item_failed(db, new_id, str(e))
                await broadcast_event(org_id, "failed", failed, new_id, project_id)

    asyncio.create_task(_bg())

    return {
        "status": "pending",
        "doc_id": new_id,
        "project_id": project_id,
        "generation_id": generation_id,
    }
