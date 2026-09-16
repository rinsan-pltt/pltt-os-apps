"""Fal.ai model registry + generation helpers.

Ported from pltt-agg. API key is supplied per-call by the caller (which reads
it via `ctx.secret("FAL_KEY")`) instead of being read from a process-wide env
variable.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Dict, Optional

import fal_client

logger = logging.getLogger("pltt_creative.fal")


_IMAGE_MODELS: Dict[str, str] = {
    "nano_banana": "fal-ai/nano-banana",
    "nano_banana_pro": "fal-ai/nano-banana-pro",
    "nano_banana_2": "fal-ai/nano-banana-2",
    "nano_banana_edit": "fal-ai/nano-banana/edit",
    "flux_schnell": "fal-ai/flux/schnell",
    "openai/gpt-image-2": "openai/gpt-image-2",
    "midjourney": "midjourney/imagine",
}


_DEFAULT_PAYLOADS: Dict[str, Dict[str, Any]] = {
    "nano_banana": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "nano_banana_pro": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "nano_banana_2": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "nano_banana_edit": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "flux_schnell": {"image_size": "square_hd", "num_images": 1, "num_inference_steps": 4, "enable_safety_checker": True, "output_format": "png"},
    "openai/gpt-image-2": {"quality": "low", "image_size": {"width": 1024, "height": 1024}, "num_images": 1, "output_format": "png"},
}


def get_registered_models() -> Dict[str, Any]:
    return {
        "image": {
            k: {"id": v, "defaults": _DEFAULT_PAYLOADS.get(k, {})}
            for k, v in _IMAGE_MODELS.items()
        }
    }


def _run_gen(
    api_key: str,
    model_name: str,
    model_id: str,
    prompt: str,
    on_progress: Optional[Callable] = None,
    **kwargs,
) -> Any:
    payload = _DEFAULT_PAYLOADS.get(model_name, {}).copy()
    payload["prompt"] = prompt
    payload.update(kwargs)

    logger.info(f"🚀 [Fal] Triggering: {model_id}")
    logger.debug(f"📦 [Fal] Payload: {json.dumps(payload, default=str)}")

    # fal_client reads FAL_KEY from env; set it on this process for the call.
    prev = os.environ.get("FAL_KEY")
    os.environ["FAL_KEY"] = api_key
    try:
        return fal_client.subscribe(
            model_id, arguments=payload, with_logs=True, on_queue_update=on_progress
        )
    finally:
        if prev is None:
            os.environ.pop("FAL_KEY", None)
        else:
            os.environ["FAL_KEY"] = prev


def upscale_image(
    api_key: str,
    image_url: str,
    upscale_mode: str = "factor",
    upscale_factor: int = 2,
    target_resolution: Optional[str] = "1080p",
    noise_scale: float = 0.1,
    output_format: str = "png",
    on_progress: Optional[Callable] = None,
) -> Any:
    payload: Dict[str, Any] = {
        "image_url": image_url,
        "upscale_mode": upscale_mode,
        "upscale_factor": upscale_factor,
        "noise_scale": noise_scale,
        "output_format": output_format,
    }
    if target_resolution:
        payload["target_resolution"] = target_resolution

    model_id = "fal-ai/seedvr/upscale/image"
    prev = os.environ.get("FAL_KEY")
    os.environ["FAL_KEY"] = api_key
    try:
        return fal_client.subscribe(model_id, arguments=payload, with_logs=True, on_queue_update=on_progress)
    finally:
        if prev is None:
            os.environ.pop("FAL_KEY", None)
        else:
            os.environ["FAL_KEY"] = prev


def generate_image(api_key: str, name: str, prompt: str, on_progress: Optional[Callable] = None, **kwargs) -> Any:
    model_id = _IMAGE_MODELS.get(name)
    if not model_id:
        raise ValueError(f"Image model '{name}' not found. Available: {list(_IMAGE_MODELS)}")

    reference_keys = ["image_url", "image_urls", "image", "image_references"]
    if any(kwargs.get(k) for k in reference_keys):
        if not model_id.endswith("/edit"):
            model_id = f"{model_id.rstrip('/')}/edit"

    return _run_gen(api_key, name, model_id, prompt, on_progress=on_progress, **kwargs)
