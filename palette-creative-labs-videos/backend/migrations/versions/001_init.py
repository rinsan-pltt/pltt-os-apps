"""Initial schema for the Pltt Creative Video plugin.

Creates the projects / key_frames / key_frame_assets / items / assets tables
and enables row-level security on each so Palette can scope rows to the
current organization automatically.

Revision ID: 001_init
Revises:
Create Date: 2026-05-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls


revision = "001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pltt_creative_video__projects",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("client", sa.String(255), nullable=True),
        sa.Column("thumbnail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=True),
        sa.Column("model_name", sa.String(64), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("aspect_ratio", sa.String(16), nullable=True),
        sa.Column("resolution", sa.String(16), nullable=True),
        sa.Column("duration", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__projects")

    op.create_table(
        "pltt_creative_video__key_frames",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column(
            "project_id",
            sa.String(64),
            sa.ForeignKey("pltt_creative_video__projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("key_frame_name", sa.String(64), nullable=False),
        sa.Column("key_frame_number", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__key_frames")

    op.create_table(
        "pltt_creative_video__key_frame_assets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column(
            "key_frame_id",
            sa.String(64),
            sa.ForeignKey("pltt_creative_video__key_frames.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__key_frame_assets")

    op.create_table(
        "pltt_creative_video__items",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("project_id", sa.String(64), nullable=True, index=True),
        sa.Column("key_frame_id", sa.String(64), nullable=True, index=True),
        sa.Column("generation_id", sa.String(64), nullable=True, index=True),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("model_name", sa.String(64), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="in_progress"),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("all_generated_urls", sa.JSON(), nullable=True),
        sa.Column("image_references", sa.JSON(), nullable=True),
        sa.Column("aspect_ratio", sa.String(16), nullable=True),
        sa.Column("resolution", sa.String(16), nullable=True),
        sa.Column("duration", sa.String(16), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("group", sa.String(16), nullable=True),
        sa.Column("is_favourite", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_sample", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("midjourney_job_id", sa.String(128), nullable=True),
        sa.Column("midjourney_action", sa.String(8), nullable=True),
        sa.Column("source_doc_id", sa.String(64), nullable=True, index=True),
        sa.Column("is_upscaled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("upscaled_doc_id", sa.String(64), nullable=True),
        sa.Column("is_upscale_image", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("url_before_upscale", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, "pltt_creative_video__items")

    op.create_table(
        "pltt_creative_video__assets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=True, index=True),
        sa.Column("type", sa.String(32), nullable=False, server_default="reference_image"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_pltt_creative_video__assets_user_content_hash",
        "pltt_creative_video__assets",
        ["organization_id", "user_id", "content_hash"],
        unique=True,
        postgresql_where=sa.text("content_hash IS NOT NULL"),
    )
    ensure_org_rls(op, "pltt_creative_video__assets")


def downgrade() -> None:
    op.drop_index("ix_pltt_creative_video__assets_user_content_hash", table_name="pltt_creative_video__assets")
    op.drop_table("pltt_creative_video__assets")
    op.drop_table("pltt_creative_video__items")
    op.drop_table("pltt_creative_video__key_frame_assets")
    op.drop_table("pltt_creative_video__key_frames")
    op.drop_table("pltt_creative_video__projects")
