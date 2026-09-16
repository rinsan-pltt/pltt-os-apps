"""Add business-trip fields to pre-spend requests."""

from alembic import op
import sqlalchemy as sa


revision = "005_business_trip_pre_spend"
down_revision = "004_policy_pre_spend"


def upgrade() -> None:
    op.add_column(
        "corporate_card_system__pre_spend_requests",
        sa.Column("request_type", sa.String(length=40), nullable=False, server_default="purchase"),
    )
    op.add_column("corporate_card_system__pre_spend_requests", sa.Column("trip_area", sa.String(length=240), nullable=True))
    op.add_column("corporate_card_system__pre_spend_requests", sa.Column("trip_start_date", sa.String(length=40), nullable=True))
    op.add_column("corporate_card_system__pre_spend_requests", sa.Column("trip_end_date", sa.String(length=40), nullable=True))
    op.add_column(
        "corporate_card_system__pre_spend_requests",
        sa.Column("budget_items_json", sa.Text(), nullable=False, server_default="[]"),
    )
    op.create_index(
        "ix_corporate_card_system__pre_spend_type",
        "corporate_card_system__pre_spend_requests",
        ["organization_id", "request_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_corporate_card_system__pre_spend_type", table_name="corporate_card_system__pre_spend_requests")
    op.drop_column("corporate_card_system__pre_spend_requests", "budget_items_json")
    op.drop_column("corporate_card_system__pre_spend_requests", "trip_end_date")
    op.drop_column("corporate_card_system__pre_spend_requests", "trip_start_date")
    op.drop_column("corporate_card_system__pre_spend_requests", "trip_area")
    op.drop_column("corporate_card_system__pre_spend_requests", "request_type")
