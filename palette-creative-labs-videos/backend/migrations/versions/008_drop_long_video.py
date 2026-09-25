"""Remove Long Video (story) mode: drop its session table and the
vision-analysis column it added to reference assets.

The drop of `pltt_creative_video__story_sessions` is one-way. The platform
migration lint rejects any migration that recreates a table an earlier
migration already created, so `downgrade()` must not bring the table back —
restoring it means rolling back to 007 (or re-adding it under a new revision
with a fresh table name).

Revision ID: 008_drop_long_video
Revises: 007_story_sessions
Create Date: 2026-07-16
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "008_drop_long_video"
down_revision = "007_story_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("pltt_creative_video__story_sessions")
    op.drop_column("pltt_creative_video__assets", "analysis")


def downgrade() -> None:
    # Only the column comes back; see the module docstring for why the
    # story-sessions table is not recreated here.
    op.add_column(
        "pltt_creative_video__assets",
        sa.Column("analysis", sa.JSON(), nullable=True),
    )
