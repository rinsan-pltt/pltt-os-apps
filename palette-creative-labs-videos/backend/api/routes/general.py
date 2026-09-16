"""General plugin endpoints: status, model registry, items by project, delete
item, and prompt rewriting (blending a preset/inspiration into the prompt)."""

from __future__ import annotations

import logging
import os

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from palette_sdk import (
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

from backend.api.db_helpers import delete_item, get_items_by_project_id
from backend.api.core.fal_helper import get_registered_models
from backend.api.core.secrets import read_secret

logger = logging.getLogger("pltt_creative_video.general")

router = PluginRouter(tags=["general"])


@router.get("/status", dependencies=[require_permission("tasks:read")])
async def status(ctx: PluginContext = Depends(get_ctx)):
    return {
        "plugin_id": ctx.plugin_id,
        "user_id": ctx.user_id,
        "organization_id": ctx.organization_id,
    }


@router.get("/models", dependencies=[require_permission("resources:read")])
async def list_models():
    """Returns the registered Fal image/video model catalog."""
    return get_registered_models()


@router.get(
    "/generations/{project_id}",
    dependencies=[require_permission("resources:read")],
)
async def fetch_generations(
    project_id: str,
    ctx: PluginContext = Depends(get_ctx),
):
    return await get_items_by_project_id(ctx.db, ctx.user_id, project_id)


@router.delete("/images/{doc_id}", dependencies=[require_permission("resources:write")])
async def delete_image(doc_id: str, ctx: PluginContext = Depends(get_ctx)):
    ok = await delete_item(ctx.db, ctx.user_id, doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Record {doc_id} not found.")
    return {"status": "success", "message": f"Record {doc_id} deleted."}


# --- Prompt rewriting -------------------------------------------------------
# Blends a selected preset/inspiration into the user's typed prompt so the
# result reads naturally instead of a comma-glued list. Uses the same LLM
# secrets as the chat agent: OpenAI primary, Gemini fallback.

_REWRITE_SYSTEM = (
    "You refine prompts for AI video/image generation. Rewrite the user's "
    "prompt so it naturally incorporates the requested feature, as one "
    "flowing description. Preserve the original subject, style and intent; "
    "do not add unrelated ideas. If the feature conflicts with something "
    "already in the prompt (e.g. a different camera movement), replace that "
    "part with the feature. Keep it about the same length as the original. "
    "Write in the same language the prompt is written in. Return ONLY the "
    "rewritten prompt text — no quotes, labels or commentary."
)


class PromptRewriteRequest(BaseModel):
    prompt: str
    feature: str


def _clean_llm_text(text: str) -> str:
    t = (text or "").strip()
    # Strip a single pair of wrapping quotes some models add.
    if len(t) >= 2 and t[0] == t[-1] and t[0] in ("\"", "'", "“"):
        t = t.strip("\"'“”").strip()
    return t


def _rewrite_user_message(prompt: str, feature: str) -> str:
    return f"Prompt:\n{prompt}\n\nFeature to incorporate:\n{feature}"


async def _rewrite_openai(api_key: str, prompt: str, feature: str) -> str:
    import httpx

    model = os.getenv("AGENT_OPENAI_MODEL", "gpt-5.5")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": _REWRITE_SYSTEM},
                    {"role": "user", "content": _rewrite_user_message(prompt, feature)},
                ],
            },
        )
        r.raise_for_status()
        return _clean_llm_text(r.json()["choices"][0]["message"]["content"])


async def _rewrite_gemini(api_key: str, prompt: str, feature: str) -> str:
    import httpx

    model = os.getenv("AGENT_GEMINI_MODEL", "gemini-2.5-pro")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": api_key},
            json={
                "system_instruction": {"parts": [{"text": _REWRITE_SYSTEM}]},
                "contents": [
                    {"parts": [{"text": _rewrite_user_message(prompt, feature)}]}
                ],
            },
        )
        r.raise_for_status()
        data = r.json()
        return _clean_llm_text(data["candidates"][0]["content"]["parts"][0]["text"])


@router.post("/prompt/rewrite", dependencies=[require_permission("resources:write")])
async def rewrite_prompt(
    body: PromptRewriteRequest,
    ctx: PluginContext = Depends(get_ctx),
):
    base = (body.prompt or "").strip()
    feature = (body.feature or "").strip()
    if not feature:
        raise HTTPException(status_code=400, detail="feature is required")
    # Nothing to blend into — the feature simply becomes the prompt.
    if not base:
        return {"status": "success", "prompt": feature}

    errors: list[str] = []
    openai_key = read_secret(ctx, "OPENAI_KEY")
    if openai_key:
        try:
            rewritten = await _rewrite_openai(openai_key, base, feature)
            if rewritten:
                return {"status": "success", "prompt": rewritten}
        except Exception as e:  # noqa: BLE001 — fall through to Gemini
            errors.append(f"openai: {e}")
            logger.warning("prompt rewrite via OpenAI failed: %s", e)

    gemini_key = read_secret(ctx, "GOOGLE_AI_API_KEY")
    if gemini_key:
        try:
            rewritten = await _rewrite_gemini(gemini_key, base, feature)
            if rewritten:
                return {"status": "success", "prompt": rewritten}
        except Exception as e:  # noqa: BLE001
            errors.append(f"gemini: {e}")
            logger.warning("prompt rewrite via Gemini failed: %s", e)

    raise HTTPException(
        status_code=502,
        detail="; ".join(errors) or "No LLM configured (set OPENAI_KEY or GOOGLE_AI_API_KEY)",
    )
