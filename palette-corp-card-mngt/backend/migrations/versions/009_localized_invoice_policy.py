"""Add localized invoice evidence fields."""

from alembic import op
import sqlalchemy as sa


revision = "009_localized_invoice_policy"
down_revision = "008_role_assignments"


INVOICE_COLUMNS = (
    sa.Column("employee_locality", sa.String(length=12), nullable=True),
    sa.Column("supplier_gstin", sa.String(length=32), nullable=True),
    sa.Column("supplier_business_registration_number", sa.String(length=40), nullable=True),
    sa.Column("supplier_legal_name", sa.String(length=240), nullable=True),
    sa.Column("invoice_number", sa.String(length=80), nullable=True),
    sa.Column("invoice_date", sa.String(length=40), nullable=True),
    sa.Column("place_of_supply", sa.String(length=120), nullable=True),
    sa.Column("payment_method", sa.String(length=80), nullable=True),
    sa.Column("fx_evidence_url", sa.Text(), nullable=True),
    sa.Column("fx_evidence_description", sa.Text(), nullable=True),
    sa.Column("cash_receipt_reference", sa.String(length=120), nullable=True),
)


def upgrade() -> None:
    for table_name in (
        "corporate_card_system__settlement_claims",
        "corporate_card_system__pre_spend_requests",
    ):
        for column in INVOICE_COLUMNS:
            op.add_column(table_name, column.copy())


def downgrade() -> None:
    for table_name in (
        "corporate_card_system__pre_spend_requests",
        "corporate_card_system__settlement_claims",
    ):
        for column in reversed(INVOICE_COLUMNS):
            op.drop_column(table_name, column.name)
