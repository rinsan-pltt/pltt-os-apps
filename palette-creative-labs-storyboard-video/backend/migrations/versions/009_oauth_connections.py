"""Per-user OAuth connections for social publishing (YouTube Shorts now,
Instagram Reels to follow the same shape later).

One row per (user_id, provider). Access/refresh tokens are stored
Fernet-encrypted at the application layer (backend/api/core/oauth_crypto.py)
— this table only ever holds ciphertext. RLS-scoped like every other table.

Revision ID: 009_oauth_connections
Revises: 008_item_thumbnail_url
Create Date: 2026-07-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls


revision = "009_oauth_connections"
down_revision = "008_item_thumbnail_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pltt_storyboard_video_maker__oauth_connections",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("access_token_enc", sa.Text(), nullable=False),
        sa.Column("refresh_token_enc", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scopes", sa.Text(), nullable=True),
        sa.Column("account_label", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "provider", name="uq_oauth_conn_user_provider"),
    )
    ensure_org_rls(op, "pltt_storyboard_video_maker__oauth_connections")


def downgrade() -> None:
    op.drop_table("pltt_storyboard_video_maker__oauth_connections")
