"""Remove Long Video (story) mode: drop its session table and the
vision-analysis column it added to reference assets.

Revision ID: 008_drop_long_video
Revises: 007_story_sessions
Create Date: 2026-07-16
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls


revision = "008_drop_long_video"
down_revision = "007_story_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("pltt_creative_video__story_sessions")
    op.drop_column("pltt_creative_video__assets", "analysis")


def downgrade() -> None:
    op.add_column(
        "pltt_creative_video__assets",
        sa.Column("analysis", sa.JSON(), nullable=True),
    )
    op.create_table(
        "pltt_creative_video__story_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("project_id", sa.String(64), nullable=True, index=True),
        sa.Column("key_frame_id", sa.String(64), nullable=True, index=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__story_sessions")
