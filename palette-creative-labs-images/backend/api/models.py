"""SQLAlchemy ORM models for the Pltt Creative plugin.

All tables inherit OrgScopedTable so Palette automatically scopes rows to
the current organization and enables Postgres RLS. Table names are prefixed
with `pltt_creative__` per the plugin schema convention.

Import-alias note: the Palette CLI's local dev runner pre-imports this file
as the flat top-level name `models` (it adds `backend/api/` to sys.path
before loading the entry). The rest of our code imports it as
`pltt_image_backend.api.models`. Without the bookkeeping below, SQLAlchemy ends up
with two distinct module objects re-registering the same OrgScopedTable
classes on the shared `PluginBase.metadata`, which raises "Table
'pltt_creative__projects' is already defined for this MetaData instance."
The block below registers both names in `sys.modules` pointing at the same
module so the second importer just gets the already-loaded copy.
"""

from __future__ import annotations

import sys as _sys

_THIS = _sys.modules[__name__]
_ALIASES = ("models", "pltt_image_backend.api.models")


def _is_this_apps_models(mod) -> bool:
    """True only for a module that defines THIS app's tables. In the shared
    hosted process the sibling video plugin registers the same generic alias
    names ("models"); adopting its copy would bind every query here to
    `pltt_creative_video__*` tables that don't exist in this schema."""
    proj = getattr(mod, "Project", None)
    return getattr(proj, "__tablename__", None) == "pltt_creative__projects"


_other = next(
    (
        _sys.modules[_n]
        for _n in _ALIASES
        if _n in _sys.modules
        and _sys.modules[_n] is not _THIS
        and _is_this_apps_models(_sys.modules[_n])
    ),
    None,
)

if _other is not None:
    # Another import path already executed this file (same app — verified by
    # table prefix above). Re-export its public attributes and rebind our name
    # in sys.modules so future imports under `__name__` hit the same module.
    globals().update(
        {_k: _v for _k, _v in _other.__dict__.items() if not _k.startswith("__")}
    )
    _sys.modules[__name__] = _other
else:
    # First load. Register ourselves under every alias *before* defining the
    # classes, so a re-entrant import triggered by SQLAlchemy registry hooks
    # won't try to load us a second time. A FOREIGN module squatting on an
    # alias (e.g. the video app's "models") is overwritten, never adopted.
    for _name in _ALIASES:
        _cached = _sys.modules.get(_name)
        if _cached is None or not _is_this_apps_models(_cached):
            _sys.modules[_name] = _THIS

    import uuid
    from datetime import datetime
    from typing import Any, Optional

    from sqlalchemy import (
        JSON,
        BigInteger,
        Boolean,
        DateTime,
        ForeignKey,
        Integer,
        String,
        Text,
        func,
    )
    from sqlalchemy.orm import Mapped, mapped_column

    from palette_sdk import OrgScopedTable

    def _uuid() -> str:
        return str(uuid.uuid4())

    class Project(OrgScopedTable):
        __tablename__ = "pltt_creative__projects"

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
        user_id: Mapped[str] = mapped_column(String(64), index=True)
        type: Mapped[str] = mapped_column(String(16))
        name: Mapped[str] = mapped_column(String(255))
        client: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
        thumbnail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
        model_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
        prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        aspect_ratio: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
        resolution: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
        duration: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now()
        )
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )

    class KeyFrame(OrgScopedTable):
        __tablename__ = "pltt_creative__key_frames"

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
        project_id: Mapped[str] = mapped_column(
            String(64),
            ForeignKey("pltt_creative__projects.id", ondelete="CASCADE"),
            index=True,
        )
        key_frame_name: Mapped[str] = mapped_column(String(64))
        key_frame_number: Mapped[int] = mapped_column(Integer)
        prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now()
        )
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )

    class KeyFrameAsset(OrgScopedTable):
        __tablename__ = "pltt_creative__key_frame_assets"

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
        key_frame_id: Mapped[str] = mapped_column(
            String(64),
            ForeignKey("pltt_creative__key_frames.id", ondelete="CASCADE"),
            index=True,
        )
        url: Mapped[str] = mapped_column(Text)
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now()
        )

    class Item(OrgScopedTable):
        """A single generated image or video. Replaces both the embedded
        `key_frames[].items[]` and flat docs in pltt-agg's Mongo schema."""

        __tablename__ = "pltt_creative__items"

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
        user_id: Mapped[str] = mapped_column(String(64), index=True)
        project_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
        key_frame_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
        generation_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
        type: Mapped[str] = mapped_column(String(16))
        model_name: Mapped[str] = mapped_column(String(64))
        prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        status: Mapped[str] = mapped_column(String(32), default="in_progress")
        url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        all_generated_urls: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
        image_references: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
        # Full generation params (aspect_ratio, resolution, quality, num_images,
        # image_references, …) used to produce this item. Persisted so a
        # "Variation" click can regenerate with the exact base settings, and so
        # variations of variations stay faithful down the chain.
        gen_params: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
        aspect_ratio: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
        resolution: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
        duration: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
        error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        group: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
        is_favourite: Mapped[bool] = mapped_column(Boolean, default=False)
        is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
        midjourney_job_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
        midjourney_action: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
        source_doc_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
        is_upscaled: Mapped[bool] = mapped_column(Boolean, default=False)
        upscaled_doc_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
        is_upscale_image: Mapped[bool] = mapped_column(Boolean, default=False)
        url_before_upscale: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now()
        )
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )

    class Asset(OrgScopedTable):
        """User reference assets (uploaded reference images)."""

        __tablename__ = "pltt_creative__assets"

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
        user_id: Mapped[str] = mapped_column(String(64), index=True)
        url: Mapped[str] = mapped_column(Text)
        content_hash: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
        type: Mapped[str] = mapped_column(String(32), default="reference_image")
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now()
        )
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )

    # The chat-agent tables live in `pltt_image_backend.api.agent.models` — a module name
    # no previous revision ever had, so the hosted runtime's stale
    # `sys.modules` cache can never shadow it (this module here IS routinely
    # stale-cached in that runtime, and a cached pre-chat copy has no agent
    # classes regardless of what this file says). Re-exported for fresh
    # environments; agent code imports them from `pltt_image_backend.api.agent.models`.
    from pltt_image_backend.api.agent.models import (  # noqa: F401
        AgentMessage,
        AgentThread,
        AgentThreadImage,
    )
