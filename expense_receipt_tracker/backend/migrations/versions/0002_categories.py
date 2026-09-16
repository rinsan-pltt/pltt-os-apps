"""User-editable expense categories.

Adds the org-scoped `expense_receipt_tracker__categories` table (with RLS) that
backs the category management page. Categories are seeded per organization from
the static defaults on first read by the application, so no data migration is
needed here.

Revision ID: 0002_categories
Revises: 0001_init
Create Date: 2026-08-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from palette_sdk.db import ensure_org_rls

revision = "0002_categories"
down_revision = "0001_init"
branch_labels = None
depends_on = None

_TABLE = "expense_receipt_tracker__categories"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("slug", sa.String(40), nullable=False, index=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("keywords", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, _TABLE)


def downgrade() -> None:
    op.drop_table(_TABLE)
