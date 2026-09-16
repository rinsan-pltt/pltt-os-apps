"""Store vision-model analysis on reference assets.

Adds `analysis` (JSON) to assets: the Long Video mode analyses each uploaded
reference image (Gemini vision) and keeps {kind, name, description} with the
image so re-uploads (content-hash dedup) reuse the analysis and the story
planner can weave the references into scenes.

Revision ID: 006_asset_analysis
Revises: 005_keyframe_video_refs
Create Date: 2026-07-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "006_asset_analysis"
down_revision = "005_keyframe_video_refs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pltt_storyboard_video_maker__assets",
        sa.Column("analysis", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pltt_storyboard_video_maker__assets", "analysis")
