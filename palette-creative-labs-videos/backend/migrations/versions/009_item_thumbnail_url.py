"""Add thumbnail_url to items so videos can show a poster frame instantly.

Populated by extracting the first frame of a completed video (ffmpeg) right
after it finishes generating, so galleries/previews can render that still
image immediately instead of waiting on the full video to load.

Revision ID: 009_item_thumbnail_url
Revises: 008_drop_long_video
Create Date: 2026-07-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "009_item_thumbnail_url"
down_revision = "008_drop_long_video"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pltt_creative_video__items",
        sa.Column("thumbnail_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pltt_creative_video__items", "thumbnail_url")
