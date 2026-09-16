"""Chat-agent tables: threads, messages and per-thread images.

One thread per base image (`agent_threads.id == base_image_id`); messages and
thread images cascade with their thread. RLS-scoped to the organization like
every other plugin table.

Revision ID: 003_agent_tables
Revises: 002_item_gen_params
Create Date: 2026-06-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls


revision = "003_agent_tables"
down_revision = "002_item_gen_params"
branch_labels = None
depends_on = None

# SQLite (local dev fallback) only autoincrements INTEGER primary keys.
_BigPk = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "pltt_creative_video__agent_threads",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("base_image_id", sa.String(64), nullable=False),
        sa.Column("base_image_url", sa.Text(), nullable=True),
        sa.Column("model_name", sa.String(64), nullable=True),
        sa.Column("project_id", sa.String(64), nullable=True),
        sa.Column("key_frame_id", sa.String(64), nullable=True),
        sa.Column("aspect_ratio", sa.String(16), nullable=True),
        sa.Column("resolution", sa.String(16), nullable=True),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__agent_threads")

    op.create_table(
        "pltt_creative_video__agent_messages",
        sa.Column("id", _BigPk, primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column(
            "thread_id",
            sa.String(64),
            sa.ForeignKey("pltt_creative_video__agent_threads.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("tool_calls", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__agent_messages")

    op.create_table(
        "pltt_creative_video__agent_thread_images",
        sa.Column("id", _BigPk, primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column(
            "thread_id",
            sa.String(64),
            sa.ForeignKey("pltt_creative_video__agent_threads.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("image_id", sa.String(64), nullable=False, index=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__agent_thread_images")


def downgrade() -> None:
    op.drop_table("pltt_creative_video__agent_thread_images")
    op.drop_table("pltt_creative_video__agent_messages")
    op.drop_table("pltt_creative_video__agent_threads")
