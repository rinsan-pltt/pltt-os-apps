"""Standalone LLM router client for the newsletter plugin.

Pattern copied from 3pages/backend/api/llm_router.py (itself copied from
corporate-card-system) and trimmed to what this plugin needs: JSON chat
completions (newsletter generation, document summarization) and the gateway's
native image routes (generate / edit / background-removal for mascots and
free-floating overlay images). No client-side embeddings — semantic search for
documents goes through the managed ctx.vector service, which embeds server-side.

ZERO imports from other plugin code.

Public API:
    config_value(ctx, key) -> str | None
    chat_json(ctx, *, model, system, user, temperature) -> dict
    generate_image(ctx, *, prompt, model) -> (bytes, url)
    edit_image(ctx, *, prompt, source_image_url, model) -> (bytes, url)
    remove_background(ctx, *, image_url, model) -> (bytes, url)
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config resolution: ctx.secret -> os.environ -> .palette/.env.local / .env
# ---------------------------------------------------------------------------

CONFIG_ALIASES: dict[str, tuple[str, ...]] = {
    "LLM_ROUTER_API_KEY": ("NUXT_PUBLIC_GATEWAY_KEY",),
}

PLACEHOLDER_CONFIG_VALUES = {
    "change-me",
    "changeme",
    "placeholder",
    "todo",
    "your-key-here",
}


def _clean_config_value(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().strip('"').strip("'")
    lowered = cleaned.lower()
    if not cleaned or lowered in PLACEHOLDER_CONFIG_VALUES:
        return None
    if lowered.startswith("<") and lowered.endswith(">"):
        return None
    return cleaned


def _env_file_value(keys: tuple[str, ...]) -> str | None:
    """Walk up from __file__ looking for a .palette/.env.local or .env file."""
    candidates_paths = []
    for parent in Path(__file__).resolve().parents:
        palette_env = parent / ".palette" / ".env.local"
        plain_env = parent / ".env"
        if palette_env.exists():
            candidates_paths.append(palette_env)
        if plain_env.exists():
            candidates_paths.append(plain_env)

    for env_path in candidates_paths:
        values: dict[str, str] = {}
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name, _, value = stripped.partition("=")
            values[name.strip()] = value
        for key in keys:
            cleaned = _clean_config_value(values.get(key))
            if cleaned:
                return cleaned
    return None


def config_value(ctx: Any, key: str) -> str | None:
    """Resolve config: ctx.secret -> os.environ -> .env file. Handles aliases."""
    candidates = (key, *CONFIG_ALIASES.get(key, ()))
    for candidate in candidates:
        value = _clean_config_value(ctx.secret(candidate))
        if value:
            return value
    for candidate in candidates:
        value = _clean_config_value(os.environ.get(candidate))
        if value:
            return value
    return _env_file_value(candidates)


def _local_development_enabled() -> bool:
    val = os.environ.get("LOCAL_DEVELOPMENT", "").strip().lower()
    return val in {"1", "true", "yes"}


def _running_inside_docker() -> bool:
    return Path("/.dockerenv").exists()


def router_base_url(ctx: Any) -> str | None:
    """Return the LLM router base URL, remapping localhost -> host.docker.internal
    when running inside a Docker container in local development (the container
    can't reach the host's loopback address by its own localhost)."""
    base_url = config_value(ctx, "LLM_ROUTER_BASE_URL")
    if not base_url:
        return None
    parsed = urlsplit(base_url)
    if (
        _local_development_enabled()
        and _running_inside_docker()
        and parsed.hostname in {"127.0.0.1", "localhost"}
    ):
        netloc = "host.docker.internal"
        if parsed.port:
            netloc = f"{netloc}:{parsed.port}"
        return urlunsplit((parsed.scheme or "http", netloc, parsed.path, parsed.query, parsed.fragment))
    return base_url


# ---------------------------------------------------------------------------
# Chat JSON response parsing
# ---------------------------------------------------------------------------


def _text_from_llm_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False)
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            text = part.get("text") or part.get("content")
            if isinstance(text, str):
                parts.append(text)
            elif isinstance(text, dict):
                parts.append(json.dumps(text, ensure_ascii=False))
        return "".join(parts)
    return ""


def content_from_choice_payload(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        output_text = data.get("output_text")
        return output_text if isinstance(output_text, str) else ""
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") or {}
    delta = choice.get("delta") or {}
    for container in (message, delta):
        content = container.get("content") if isinstance(container, dict) else None
        text = _text_from_llm_content(content)
        if text:
            return text
    return ""


def _balanced_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for index, char in enumerate(text[start:], start=start):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def json_from_text(text: str) -> dict[str, Any] | None:
    candidates = [text.strip()]
    candidates.extend(
        match.strip() for match in re.findall(r"```(?:json)?\s*(.*?)```", text, re.IGNORECASE | re.DOTALL)
    )
    for candidate in tuple(candidates):
        obj = _balanced_json_object(candidate)
        if obj and obj != candidate:
            candidates.append(obj)

    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def read_router_stream(request: Request) -> str:
    """Execute a urllib Request and accumulate the response text."""
    with urlopen(request, timeout=90) as response:
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" not in content_type:
            body = response.read().decode("utf-8", errors="replace")
            try:
                return content_from_choice_payload(json.loads(body))
            except json.JSONDecodeError:
                return body

        parts: list[str] = []
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or line.startswith(":"):
                continue
            if line.startswith("data:"):
                line = line.removeprefix("data:").strip()
            if line == "[DONE]":
                break
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            part = content_from_choice_payload(event)
            if part:
                parts.append(part)
        return "".join(parts)


async def chat_json(
    ctx: Any,
    *,
    model: str,
    system: str,
    user: str,
    temperature: float = 0.4,
) -> dict[str, Any]:
    """Chat completion returning a parsed JSON dict.

    Raises 503 when the router is unconfigured, 502 on router errors or
    non-JSON output.
    """
    base_url = router_base_url(ctx)
    api_key = config_value(ctx, "LLM_ROUTER_API_KEY")
    if not base_url or not api_key:
        raise HTTPException(status_code=503, detail="LLM router is not configured.")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "stream": False,
    }

    def _call() -> str:
        req = Request(
            f"{base_url.rstrip('/')}/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        return read_router_stream(req)

    try:
        response_text = await asyncio.to_thread(_call)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise HTTPException(status_code=502, detail=f"LLM router error: {detail}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=502, detail=f"LLM router request failed: {exc}") from exc

    parsed = json_from_text(response_text)
    if parsed is None:
        raise HTTPException(
            status_code=502,
            detail=f"LLM router returned non-JSON content: {response_text[:500]}",
        )
    return parsed


# ---------------------------------------------------------------------------
# Native image routes (Gateway Events over SSE)
#
#   POST {base}/image                      body: {prompt, model?}
#   POST {base}/image/edit                 body: {prompt, model?, inputs: [{type:"image", url}]}
#   POST {base}/image/background-removal   body: {model?, inputs: [{type:"image", url}]}
# Responses stream SSE Gateway Events: {event, data}. data.type == "image_done"
# carries the output (data.url or data.output.output_url); data.type == "error"
# carries the failure.
# ---------------------------------------------------------------------------


def _absolute_http_url(url: str) -> str | None:
    """Return url if it's an absolute http(s) URL the gateway can fetch, else None.

    Platform storage / the local-GCS fallback always return absolute URLs (see
    storage.py), so any image reference this plugin produced is already
    fetchable by the gateway — this only guards against passing something else
    (a relative path, a data: URI) that the gateway can't reach."""
    if url and (url.startswith("http://") or url.startswith("https://")):
        return url
    return None


def _read_gateway_events(req: Request) -> tuple[str | None, str | None]:
    """Consume a Gateway Events SSE stream. Returns (output_url, error_message)."""
    current_event = ""
    with urlopen(req, timeout=300) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or line.startswith(":"):
                continue
            if line.startswith("event:"):
                current_event = line.removeprefix("event:").strip()
                continue
            if not line.startswith("data:"):
                continue
            payload = line.removeprefix("data:").strip()
            if payload == "[DONE]":
                break
            if current_event == "error":
                return None, payload[:500]
            try:
                event = json.loads(payload)
            except json.JSONDecodeError:
                continue
            data = event.get("data") or {}
            kind = data.get("type")
            if kind in {"image_done", "file_done"}:
                url = data.get("url")
                if not url:
                    output = data.get("output") or {}
                    url = output.get("output_url")
                    if not url:
                        urls = output.get("output_urls") or []
                        url = urls[0] if urls else None
                if url:
                    return url, None
            elif kind == "error":
                err = data.get("error") if isinstance(data.get("error"), dict) else data
                return None, str(err.get("message") or err)[:500]
    return None, None


async def _download_media(base_url: str, api_key: str, url: str) -> bytes:
    """Download a generated image. Gateway-relative /media/... URLs resolve
    against the gateway; data: URLs decode inline."""
    import httpx  # noqa: PLC0415

    if url.startswith("data:"):
        _, _, b64 = url.partition(",")
        return base64.b64decode(b64.replace("\n", "").replace(" ", ""))
    if url.startswith("/"):
        url = f"{base_url.rstrip('/')}{url}"
    headers = {}
    if url.startswith(base_url.rstrip("/")):
        headers["Authorization"] = f"Bearer {api_key}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(url, headers=headers, follow_redirects=True)
        resp.raise_for_status()
        return resp.content


async def _media_request(ctx: Any, path: str, payload: dict[str, Any], *, error_label: str) -> tuple[bytes, str]:
    base_url = router_base_url(ctx)
    api_key = config_value(ctx, "LLM_ROUTER_API_KEY")
    if not base_url or not api_key:
        raise HTTPException(status_code=503, detail="LLM router is not configured.")

    def _call() -> tuple[str | None, str | None]:
        req = Request(
            f"{base_url.rstrip('/')}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            method="POST",
        )
        return _read_gateway_events(req)

    try:
        output_url, error_msg = await asyncio.to_thread(_call)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise HTTPException(status_code=502, detail=f"{error_label}: {detail}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=502, detail=f"{error_label} request failed: {exc}") from exc

    if error_msg:
        raise HTTPException(status_code=502, detail=f"{error_label}: {error_msg}")
    if not output_url:
        raise HTTPException(status_code=502, detail=f"{error_label}: gateway returned no image output")

    try:
        data = await _download_media(base_url, api_key, output_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{error_label}: failed to download output ({exc})") from exc
    # Bytes AND the gateway's own output URL (a gateway-hosted URL — may be a
    # loopback address in local dev). Callers re-host the bytes via
    # storage.save_media and only fall back to this URL as a last resort.
    return data, output_url


async def generate_image(ctx: Any, *, prompt: str, model: str | None = None) -> tuple[bytes, str]:
    """Pure text-to-image generation via the gateway's native POST /image route."""
    payload: dict[str, Any] = {"prompt": prompt}
    if model:
        payload["model"] = model
    return await _media_request(ctx, "/image", payload, error_label="LLM router image generation")


async def edit_image(ctx: Any, *, prompt: str, source_image_url: str, model: str | None = None) -> tuple[bytes, str]:
    """Reference-guided image edit via the gateway's native POST /image/edit route.

    Used for overlay-image reference edits and mascot AI pose generation
    (style-preservation prompt supplied by the caller).
    """
    absolute = _absolute_http_url(source_image_url)
    if not absolute:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot pass source image to the gateway: not an absolute http(s) URL ('{source_image_url[:80]}').",
        )
    payload: dict[str, Any] = {"prompt": prompt, "inputs": [{"type": "image", "url": absolute}]}
    if model:
        payload["model"] = model
    return await _media_request(ctx, "/image/edit", payload, error_label="LLM router image edit")


async def remove_background(ctx: Any, *, image_url: str, model: str | None = None) -> tuple[bytes, str]:
    """Background removal via the gateway's native POST /image/background-removal route.

    Used as the final step of mascot AI pose generation.
    """
    absolute = _absolute_http_url(image_url)
    if not absolute:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot pass source image to the gateway: not an absolute http(s) URL ('{image_url[:80]}').",
        )
    payload: dict[str, Any] = {"inputs": [{"type": "image", "url": absolute}]}
    if model:
        payload["model"] = model
    return await _media_request(
        ctx, "/image/background-removal", payload, error_label="LLM router background removal"
    )
