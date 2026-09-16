"""Initial schema for the Expense & Receipt Tracker plugin.

Creates the org-scoped `expense_receipt_tracker__expenses` table and enables
row-level security so Palette scopes rows to the current organization
automatically.

Revision ID: 0001_init
Revises:
Create Date: 2026-08-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from palette_sdk.db import ensure_org_rls

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None

_TABLE = "expense_receipt_tracker__expenses"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("vendor", sa.String(200), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("category", sa.String(40), nullable=False, server_default="other"),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("receipt_filename", sa.String(255), nullable=True),
        sa.Column("receipt_original_name", sa.String(255), nullable=True),
        sa.Column("receipt_content_type", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, _TABLE)


def downgrade() -> None:
    op.drop_table(_TABLE)
