"""Minimal OpenAI Chat Completions client (httpx, no SDK dependency)."""

from __future__ import annotations

import json
import logging
import os
import time

from fastapi import HTTPException

logger = logging.getLogger(__name__)

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.2")


def call_openai(
    api_key: str,
    messages: list[dict],
    *,
    json_mode: bool = False,
    model: str | None = None,
) -> tuple[str, str]:
    """Send a chat completion request; returns (content, model_used)."""
    import httpx

    if not api_key:
        raise HTTPException(
            status_code=424,
            detail=(
                "OPENAI_KEY is not configured. Add it to the plugin's .env "
                "(local) or plugin secrets (hosted) and restart."
            ),
        )

    payload: dict = {
        "model": model or DEFAULT_MODEL,
        "messages": messages,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    logger.info("Calling OpenAI (%s)...", payload["model"])
    start = time.monotonic()
    try:
        resp = httpx.post(
            OPENAI_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
            timeout=httpx.Timeout(60.0, connect=15.0),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach OpenAI: {exc}")
    logger.info("OpenAI responded in %.2fs (HTTP %s).", time.monotonic() - start, resp.status_code)

    if resp.status_code == 401:
        raise HTTPException(status_code=424, detail="OpenAI rejected the API key (401). Check OPENAI_KEY.")
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="OpenAI rate limit reached. Try again in a moment.")
    if resp.status_code >= 400:
        try:
            message = resp.json().get("error", {}).get("message", resp.text[:300])
        except Exception:  # noqa: BLE001
            message = resp.text[:300]
        raise HTTPException(status_code=502, detail=f"OpenAI error ({resp.status_code}): {message}")

    try:
        body = resp.json()
        content = body["choices"][0]["message"]["content"]
        used_model = body.get("model", payload["model"])
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"Unexpected OpenAI response: {exc}")

    if not content or not content.strip():
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response.")
    return content.strip(), used_model


async def call_openai_async(
    api_key: str,
    messages: list[dict],
    *,
    json_mode: bool = False,
    model: str | None = None,
) -> tuple[str, str]:
    """`call_openai` off the event loop.

    The synchronous version is fine for the one-shot calls in extraction.py, but
    the chat agent runs up to `MAX_TOOL_STEPS` requests back to back for a
    single message. Blocking the loop for that long stalls every other request
    the plugin is serving, so the chat path hands the httpx call to a worker
    thread instead.
    """
    import functools

    from anyio import to_thread

    return await to_thread.run_sync(
        functools.partial(call_openai, api_key, messages, json_mode=json_mode, model=model)
    )
