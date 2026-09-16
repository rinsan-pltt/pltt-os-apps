"""Plugin-wide org settings (base display currency).

Adds the org-scoped `expense_receipt_tracker__settings` key/value table (with
RLS) that backs the dashboard's base-currency preference. The default value is
supplied by the application on first read (see core/settings_store.py), so no
data migration is needed here.

Revision ID: 0003_settings
Revises: 0002_categories
Create Date: 2026-08-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from palette_sdk.db import ensure_org_rls

revision = "0003_settings"
down_revision = "0002_categories"
branch_labels = None
depends_on = None

_TABLE = "expense_receipt_tracker__settings"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("key", sa.String(40), nullable=False, index=True),
        sa.Column("value", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    ensure_org_rls(op, _TABLE)


def downgrade() -> None:
    op.drop_table(_TABLE)
