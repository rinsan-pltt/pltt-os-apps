"""Persist per-keyframe video-generation inputs.

Adds `video_refs` (JSON) to key frames: the start/end frames, reference
images and Kling elements the user attached in the video panel, kept until
the user removes them so reopening a keyframe restores its inputs.

Revision ID: 005_keyframe_video_refs
Revises: 004_draft_threads
Create Date: 2026-07-03
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "005_keyframe_video_refs"
down_revision = "004_draft_threads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pltt_storyboard_video_maker__key_frames",
        sa.Column("video_refs", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pltt_storyboard_video_maker__key_frames", "video_refs")
