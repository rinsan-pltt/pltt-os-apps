"""Persist Long Video (story) sessions.

One row per story session: the full session snapshot (story, scenes with
prompts/generation ids/urls, references, step, models) lives in `data` so a
page refresh restores the flow exactly where it was — including the inputs it
was generated from. Scoped per key frame within a project (or user-level when
planned from the standalone video page, `project_id`/`key_frame_id` NULL) so a
story shows only on the key frame it was created on. RLS-scoped like every
other table.

Revision ID: 007_story_sessions
Revises: 006_asset_analysis
Create Date: 2026-07-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls


revision = "007_story_sessions"
down_revision = "006_asset_analysis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pltt_storyboard_video_maker__story_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("project_id", sa.String(64), nullable=True, index=True),
        sa.Column("key_frame_id", sa.String(64), nullable=True, index=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_storyboard_video_maker__story_sessions")


def downgrade() -> None:
    op.drop_table("pltt_storyboard_video_maker__story_sessions")
