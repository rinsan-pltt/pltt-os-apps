"""Per-request agent context, shared with the tools via a contextvar.

The chat route sets this before invoking the agent; the (async) tools read it
to know which user/thread/image they're acting on, and carry the request's
PluginContext so they can drive the generation handlers and open their own
DB sessions.
"""

import contextvars
from dataclasses import dataclass, field
from typing import Optional

from palette_sdk import PluginContext


@dataclass
class AgentContext:
    plugin_ctx: PluginContext
    user_id: str
    thread_id: str
    # None while the thread is still a draft (no image generated yet).
    base_image_id: Optional[str]
    # The image the chat is currently focused on (starts at the base image,
    # advances to the newest completed edit/creation within a turn).
    current_image_id: Optional[str] = None
    current_image_url: Optional[str] = None
    model_name: Optional[str] = None
    project_id: Optional[str] = None
    key_frame_id: Optional[str] = None
    aspect_ratio: Optional[str] = None
    resolution: Optional[str] = None
    # How many images a create should produce, from the chat's settings popover
    # (clamped 1–4 by the route). Edits/blends always produce one.
    num_images: int = 1
    # Storage URL of the inpainting mask painted for this turn's edit (white =
    # editable area, black = preserved). Passed with the image as references.
    mask_url: Optional[str] = None
    # The image the mask was painted on — when set, edits target this image
    # instead of the thread's newest one (the user can mask ANY generated
    # image in the chat).
    mask_image_url: Optional[str] = None
    # Hosted URLs of reference images the user attached to this turn — passed
    # to edit models after the image being edited (the base reference).
    reference_images: list = field(default_factory=list)
    # Images produced during this turn (tools append; the route reads it back).
    created: list = field(default_factory=list)
    # generation_id(s) this turn kicked off. Surfaced in the chat response so
    # the frontend can register an optimistic item and drive the
    # `/generations/{project_id}` poll fallback (the chat may return before the
    # images finish — e.g. Midjourney — and reconcile them by generation_id).
    generation_ids: list = field(default_factory=list)
    # Id of the assistant "generating" placeholder message persisted BEFORE the
    # settle wait, so a refresh mid-generation still shows the turn. The route
    # updates this message with the final reply once generation settles.
    placeholder_message_id: Optional[object] = None


_ctx: contextvars.ContextVar[Optional[AgentContext]] = contextvars.ContextVar(
    "pltt_creative_video_agent_ctx", default=None
)


def set_agent_context(ctx: AgentContext) -> None:
    _ctx.set(ctx)


def get_agent_context() -> AgentContext:
    ctx = _ctx.get()
    if ctx is None:
        raise RuntimeError("AgentContext is not set for this request")
    return ctx
