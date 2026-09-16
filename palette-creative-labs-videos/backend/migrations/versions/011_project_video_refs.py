"""Move the video panel's saved inputs to the project level.

Reference images / start & end frames / elements now follow the user across
key frames instead of living on a single key frame — projects.video_refs
holds them; the older key_frames.video_refs stays for legacy hydration.

Revision ID: 011_project_video_refs
Revises: 010_scenes
Create Date: 2026-07-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "011_project_video_refs"
down_revision = "010_scenes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pltt_creative_video__projects",
        sa.Column("video_refs", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pltt_creative_video__projects", "video_refs")
