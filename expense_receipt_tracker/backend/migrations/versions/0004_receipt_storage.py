"""Durable receipt storage references.

Adds `receipt_object_path` and `receipt_url` to the expenses table so an
uploaded receipt can be persisted in the platform's durable storage service
(palette.storage — GCS in production) instead of the plugin's local filesystem,
which is ephemeral on the hosted platform and would lose receipt files on a
server restart. Existing rows (and the standalone/local-disk fallback path)
leave these NULL and keep using `receipt_filename`.

Revision ID: 0004_receipt_storage
Revises: 0003_settings
Create Date: 2026-08-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_receipt_storage"
down_revision = "0003_settings"
branch_labels = None
depends_on = None

_TABLE = "expense_receipt_tracker__expenses"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("receipt_object_path", sa.String(512), nullable=True))
    op.add_column(_TABLE, sa.Column("receipt_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column(_TABLE, "receipt_url")
    op.drop_column(_TABLE, "receipt_object_path")
