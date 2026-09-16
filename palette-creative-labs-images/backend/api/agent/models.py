"""SQLAlchemy ORM models owned by the chat agent.

These live in their own module — NOT in `pltt_image_backend.api.models` — deliberately.
The hosted runtime is a long-lived process that caches modules in
`sys.modules` across plugin revisions: `pltt_image_backend.api.models` is routinely a
STALE module object from a pre-chat revision, so `from pltt_image_backend.api.models
import AgentMessage` raises ImportError there no matter what the file on disk
says (that file never re-executes while the cached module satisfies the
import). A module name that has never existed in any previous revision can
never be stale-cached, so this one is always loaded fresh from the current
bundle.

`pltt_image_backend.api.models` re-exports these classes on first load for fresh
environments; agent code must import them from HERE so it works in both.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from palette_sdk import OrgScopedTable

# SQLite (local dev fallback) only autoincrements INTEGER primary keys.
_BigPk = BigInteger().with_variant(Integer, "sqlite")


class AgentThread(OrgScopedTable):
    """Chat-agent thread. One thread per base image (`id == base_image_id`),
    so everything created/edited from that image groups with its
    conversation. A thread can start as a draft (`base_image_id` NULL,
    random id) before any image exists; once the chat generates its first
    image the thread is re-keyed to that image's id."""

    __tablename__ = "pltt_creative__agent_threads"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    base_image_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    base_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    model_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    project_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    key_frame_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    aspect_ratio: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AgentMessage(OrgScopedTable):
    __tablename__ = "pltt_creative__agent_messages"

    id: Mapped[int] = mapped_column(_BigPk, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("pltt_creative__agent_threads.id", ondelete="CASCADE"),
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    tool_calls: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AgentThreadImage(OrgScopedTable):
    """An image associated with an agent thread: the base image plus every
    create/edit/regenerate the chat produced."""

    __tablename__ = "pltt_creative__agent_thread_images"

    id: Mapped[int] = mapped_column(_BigPk, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("pltt_creative__agent_threads.id", ondelete="CASCADE"),
        index=True,
    )
    image_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
