"""Fal.ai model registry + generation helpers.

Ported from pltt-agg. API key is supplied per-call by the caller (which reads
it via `ctx.secret("FAL_KEY")`) instead of being read from a process-wide env
variable.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Dict, Literal, Optional

import fal_client

logger = logging.getLogger("pltt_creative_video.fal")


_VIDEO_MODELS: Dict[str, str] = {
    "kling_3_0_pro": "fal-ai/kling-video/v3/pro/text-to-video",
    "kling_3_0_standard": "fal-ai/kling-video/v3/standard/text-to-video",
    "kling_o3_pro": "fal-ai/kling-video/o3/pro/text-to-video",
    "seedance_2_0": "bytedance/seedance-2.0/fast/text-to-video",
    "ltx_video": "fal-ai/ltx-video",
}

# Image-to-video endpoints, used when a start/reference image is supplied. The
# start frame is passed as `image_url`; Kling additionally accepts a `tail_image_url`
# for the end frame.
_VIDEO_I2V_MODELS: Dict[str, str] = {
    "kling_3_0_pro": "fal-ai/kling-video/v3/pro/image-to-video",
    "kling_3_0_standard": "fal-ai/kling-video/v3/standard/image-to-video",
    "kling_o3_pro": "fal-ai/kling-video/o3/pro/image-to-video",
    "seedance_2_0": "bytedance/seedance-2.0/fast/image-to-video",
    "ltx_video": "fal-ai/ltx-video/image-to-video",
}

# Reference-to-video endpoints (multiple reference images conditioning).
_VIDEO_REF2V_MODELS: Dict[str, str] = {
    "seedance_2_0": "bytedance/seedance-2.0/reference-to-video",
}

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
    "kling_3_0_pro": {"duration": "5", "aspect_ratio": "16:9", "negative_prompt": "blur, distort, and low quality", "generate_audio": True},
    "kling_3_0_standard": {"duration": "5", "aspect_ratio": "16:9", "negative_prompt": "blur, distort, and low quality", "generate_audio": True},
    "seedance_2_0": {"duration": "auto", "aspect_ratio": "16:9", "generate_audio": True},
    "kling_o3_pro": {"duration": "5", "aspect_ratio": "16:9", "negative_prompt": "blur, distort, and low quality", "generate_audio": True},
    "ltx_video": {"num_inference_steps": 30, "guidance_scale": 3.0, "negative_prompt": "blurry, distorted, low quality, artifacts"},
    "nano_banana": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "nano_banana_pro": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "nano_banana_2": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "nano_banana_edit": {"aspect_ratio": "1:1", "num_images": 1, "enable_safety_checker": True, "output_format": "png"},
    "flux_schnell": {"image_size": "square_hd", "num_images": 1, "num_inference_steps": 4, "enable_safety_checker": True, "output_format": "png"},
    "openai/gpt-image-2": {"quality": "low", "image_size": {"width": 1024, "height": 1024}, "num_images": 1, "output_format": "png"},
}


def get_registered_models(category: Optional[Literal["video", "image"]] = None) -> Dict[str, Any]:
    def _b(reg):
        return {k: {"id": v, "defaults": _DEFAULT_PAYLOADS.get(k, {})} for k, v in reg.items()}
    if category == "video":
        return _b(_VIDEO_MODELS)
    if category == "image":
        return _b(_IMAGE_MODELS)
    return {"video": _b(_VIDEO_MODELS), "image": _b(_IMAGE_MODELS)}


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


def generate_video(
    api_key: str,
    name: str,
    prompt: str,
    on_progress: Optional[Callable] = None,
    *,
    start_image: Optional[str] = None,
    end_image: Optional[str] = None,
    image_references: Optional[list] = None,
    elements: Optional[list] = None,
    **kwargs,
) -> Any:
    # A start/reference image switches the request to the image-to-video
    # endpoint; the frame is passed as `image_url` (and `tail_image_url` for the
    # end frame on models that support it).
    first_ref = image_references[0] if image_references else None
    start = start_image or first_ref
    model_id = _VIDEO_MODELS.get(name)
    if name == "seedance_2_0" and image_references and not start_image:
        # Seedance "reference images" mode → the reference-to-video endpoint,
        # conditioned on multiple reference images.
        model_id = _VIDEO_REF2V_MODELS[name]
        kwargs["reference_image_urls"] = list(image_references)
    elif start and name in _VIDEO_I2V_MODELS:
        model_id = _VIDEO_I2V_MODELS[name]
        # Provider-specific field names for the start/end frames:
        #   Kling 3.0 Pro       → start_image_url / end_image_url
        #   Kling o3 Pro        → image_url        / end_image_url
        #   Seedance            → image_url        / end_image_url
        #   LTX                 → image_url (single reference, no end frame)
        if name in ("kling_o3_pro", "seedance_2_0"):
            kwargs["image_url"] = start
            if end_image:
                kwargs["end_image_url"] = end_image
        elif name.startswith("kling"):
            kwargs["start_image_url"] = start
            if end_image:
                kwargs["end_image_url"] = end_image
        else:
            kwargs["image_url"] = start
    # Kling Elements (@Element1, @Element2, …): pass through as `elements` so the
    # provider can bind the prompt references to their image sets.
    if elements:
        kwargs["elements"] = [
            {
                "frontal_image_url": el.get("frontal_image"),
                "reference_image_urls": el.get("reference_images") or [],
            }
            for el in elements
        ]
    if not model_id:
        raise ValueError(f"Video model '{name}' not found. Available: {list(_VIDEO_MODELS)}")
    return _run_gen(api_key, name, model_id, prompt, on_progress=on_progress, **kwargs)


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
