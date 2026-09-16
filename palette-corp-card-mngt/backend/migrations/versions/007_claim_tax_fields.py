"""Add tax fields to settlement claims."""

from alembic import op
import sqlalchemy as sa


revision = "007_claim_tax_fields"
down_revision = "006_statement_recon"


def upgrade() -> None:
    op.add_column(
        "corporate_card_system__settlement_claims",
        sa.Column("tax_amount_cents", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("corporate_card_system__settlement_claims", sa.Column("tax_type", sa.String(length=40), nullable=True))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("tax_rate_percent", sa.Float(), nullable=True))
    op.add_column(
        "corporate_card_system__settlement_claims",
        sa.Column("tax_included", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("corporate_card_system__settlement_claims", "tax_included")
    op.drop_column("corporate_card_system__settlement_claims", "tax_rate_percent")
    op.drop_column("corporate_card_system__settlement_claims", "tax_type")
    op.drop_column("corporate_card_system__settlement_claims", "tax_amount_cents")
