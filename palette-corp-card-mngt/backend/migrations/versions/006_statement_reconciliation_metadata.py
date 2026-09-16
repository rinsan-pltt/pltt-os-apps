"""Add statement reconciliation metadata."""

from alembic import op
import sqlalchemy as sa


revision = "006_statement_recon"
down_revision = "005_business_trip_pre_spend"


def upgrade() -> None:
    op.add_column("corporate_card_system__statement_rows", sa.Column("match_pre_approval_id", sa.Integer(), nullable=True))
    op.add_column(
        "corporate_card_system__statement_rows",
        sa.Column("reconciliation_json", sa.Text(), nullable=False, server_default="{}"),
    )
    op.create_index(
        "ix_corporate_card_system__statement_rows_pre_approval",
        "corporate_card_system__statement_rows",
        ["organization_id", "match_pre_approval_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_corporate_card_system__statement_rows_pre_approval",
        table_name="corporate_card_system__statement_rows",
    )
    op.drop_column("corporate_card_system__statement_rows", "reconciliation_json")
    op.drop_column("corporate_card_system__statement_rows", "match_pre_approval_id")
