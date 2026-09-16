"""Add scenes: a group of videos generated together inside a key frame.

Each video generation in a key frame opens a new scene ("Scene N",
renameable), so a specific run's clips stay directly accessible from the
sidebar. Video items link to their scene via items.scene_id.

Revision ID: 010_scenes
Revises: 009_item_thumbnail_url
Create Date: 2026-07-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls


revision = "010_scenes"
down_revision = "009_item_thumbnail_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pltt_creative_video__scenes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column(
            "key_frame_id",
            sa.String(64),
            sa.ForeignKey("pltt_creative_video__key_frames.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("scene_name", sa.String(64), nullable=False),
        sa.Column("scene_number", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__scenes")

    op.add_column(
        "pltt_creative_video__items",
        sa.Column("scene_id", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_pltt_creative_video__items_scene_id",
        "pltt_creative_video__items",
        ["scene_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_pltt_creative_video__items_scene_id",
        table_name="pltt_creative_video__items",
    )
    op.drop_column("pltt_creative_video__items", "scene_id")
    op.drop_table("pltt_creative_video__scenes")
