from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from palette_sdk.db import OrgScopedTable

# Postgres JSONB in production; plain JSON under the SQLite dev simulator, which
# can't compile JSONB (mirrors migrations/versions/001_init.py's JSONType).
JSONType = JSON().with_variant(JSONB(), "postgresql")
# Same story for ARRAY — SQLite has no ARRAY compiler support.
StringArrayType = ARRAY(String).with_variant(JSON(), "sqlite")

# `pltt dev`'s local simulator (.palette/dev/backend_runner.py) bare-imports
# this file a second time under the plain name "models" (separate from the
# `newsletter_backend.api.models` copy main.py loads) to populate
# PluginBase.metadata before create_all — so every table below gets defined
# twice against the same shared MetaData. extend_existing lets the second
# definition redefine the same Table instead of raising "already defined".
_TABLE_ARGS = {"extend_existing": True}


def _uuid() -> str:
    return str(uuid.uuid4())


class Document(OrgScopedTable):
    __tablename__ = "newsletter__document"
    __table_args__ = _TABLE_ARGS

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    filename: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    # absolute URL returned by storage.save_media (platform storage or local-GCS fallback)
    storage_url: Mapped[str] = mapped_column(String)
    # uploaded | parsing | embedding | ready | error
    status: Mapped[str] = mapped_column(String, default="uploaded")
    summary: Mapped[str] = mapped_column(Text, default="")
    facts: Mapped[dict] = mapped_column(JSONType, default=dict)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class DocumentChunk(OrgScopedTable):
    __tablename__ = "newsletter__document_chunk"
    __table_args__ = _TABLE_ARGS

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("newsletter__document.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    # True once this chunk has been upserted into ctx.vector (settings.vector_index).
    # No in-table vector column — plugin Postgres schemas can't add the pgvector
    # extension; semantic search lives entirely in the managed ctx.vector service,
    # with a keyword/sequential fallback in dataroom.py when ctx.vector is unavailable.
    embedded: Mapped[bool] = mapped_column(Boolean, default=False)

    document: Mapped["Document"] = relationship(back_populates="chunks")


class Newsletter(OrgScopedTable):
    __tablename__ = "newsletter__newsletter"
    __table_args__ = _TABLE_ARGS

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="draft")  # draft | ready
    language: Mapped[str] = mapped_column(String, default="en")
    focus_prompt: Mapped[str] = mapped_column(Text, default="")
    brand_theme_id: Mapped[str | None] = mapped_column(
        ForeignKey("newsletter__brand_theme.id", ondelete="SET NULL"), nullable=True
    )
    # snapshot captured at pick time: {themeName, palette, typography, headers, footers}
    theme_snapshot: Mapped[dict] = mapped_column(JSONType, default=dict)
    layout: Mapped[dict] = mapped_column(JSONType, default=dict)
    source_document_ids: Mapped[list[str]] = mapped_column(StringArrayType, default=list)
    # page-level mascot overlays: [{id, type, imageUrl, xPct, yPct, wPct, rotation}]
    overlays: Mapped[list] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    blocks: Mapped[list["NewsletterBlock"]] = relationship(
        back_populates="newsletter",
        cascade="all, delete-orphan",
        order_by="NewsletterBlock.order_index",
    )


class NewsletterBlock(OrgScopedTable):
    __tablename__ = "newsletter__newsletter_block"
    __table_args__ = _TABLE_ARGS

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    newsletter_id: Mapped[str] = mapped_column(
        ForeignKey("newsletter__newsletter.id", ondelete="CASCADE"), index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    layout_key: Mapped[str] = mapped_column(String, default="single_column")
    title: Mapped[str] = mapped_column(String, default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    image_desc: Mapped[str] = mapped_column(Text, default="")
    # per-slot image URLs (list[str])
    images: Mapped[list] = mapped_column(JSONType, default=list)
    # list of {document_id, document_name, chunk_id, snippet}
    citations: Mapped[list] = mapped_column(JSONType, default=list)
    # id of the parent block when this block is an auto/manual continuation
    continuation_of: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # force this block to start a fresh page
    force_page_break: Mapped[bool] = mapped_column(Boolean, default=False)
    # keep this block on the same page as the next one (orphan control)
    keep_next: Mapped[bool] = mapped_column(Boolean, default=False)

    newsletter: Mapped["Newsletter"] = relationship(back_populates="blocks")


class Brand(OrgScopedTable):
    __tablename__ = "newsletter__brand"
    __table_args__ = _TABLE_ARGS

    # One row per organization (get-or-create, looked up by organization_id — RLS
    # already scopes reads/writes, so unlike the source app's fixed id="default"
    # singleton, id must be a real per-row UUID since the PK is shared across every
    # org's row in this one physical table).
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, default="Brand")
    logo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BrandTheme(OrgScopedTable):
    __tablename__ = "newsletter__brand_theme"
    __table_args__ = _TABLE_ARGS

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String)
    # {bg, title, body, accent, highlights}
    palette: Mapped[dict] = mapped_column(JSONType, default=dict)
    # {fontFamily, scale}
    typography: Mapped[dict] = mapped_column(JSONType, default=dict)
    # [{id, name, rule, height, elements}] rule ∈ first|subsequent|odd|even|all
    headers: Mapped[list] = mapped_column(JSONType, default=list)
    footers: Mapped[list] = mapped_column(JSONType, default=list)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MediaJob(OrgScopedTable):
    """Row-backed status for async image-edit / mascot-pose gateway jobs.

    Background tasks run after the request's DB session/connection context
    closes, and a naive reused session won't carry the RLS org GUC, schema
    search_path, or plugin role that the platform applies per-request (see
    jobs.py) — so job status is persisted on a row via a freshly-scoped
    session rather than kept in an in-process dict, which would also break if
    the hosted platform ever runs more than one backend instance (the request
    that starts a job and the request that polls it could land on different
    instances with no shared memory).
    """

    __tablename__ = "newsletter__media_job"
    __table_args__ = _TABLE_ARGS

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String)  # "image_edit" | "mascot_pose"
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | ready | error
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Mascot(OrgScopedTable):
    __tablename__ = "newsletter__mascot"
    __table_args__ = _TABLE_ARGS

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String)
    # absolute URL returned by storage.save_media
    storage_url: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String, default="image/png")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
