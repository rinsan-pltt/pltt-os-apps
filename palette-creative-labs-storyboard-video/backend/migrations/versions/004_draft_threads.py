"""Allow draft chat threads with no base image.

A thread can now be opened before any image exists (`base_image_id` NULL,
random id). When the chat generates its first image the thread is re-keyed to
that image's id, restoring the `id == base_image_id` invariant.

Revision ID: 004_draft_threads
Revises: 003_agent_tables
Create Date: 2026-06-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "004_draft_threads"
down_revision = "003_agent_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "pltt_storyboard_video_maker__agent_threads",
        "base_image_id",
        existing_type=sa.String(64),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "pltt_storyboard_video_maker__agent_threads",
        "base_image_id",
        existing_type=sa.String(64),
        nullable=False,
    )
