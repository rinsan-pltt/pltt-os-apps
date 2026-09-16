"""Add gen_params to items so variations can reproduce base settings.

Stores the full generation params (aspect_ratio, resolution, quality,
num_images, image_references, …) used to produce each item, so a "Variation"
click for non-Midjourney models can regenerate with the exact base settings.

Revision ID: 002_item_gen_params
Revises: 001_init
Create Date: 2026-06-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "002_item_gen_params"
down_revision = "001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pltt_creative__items",
        sa.Column("gen_params", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pltt_creative__items", "gen_params")
