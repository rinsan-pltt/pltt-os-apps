"""Add policy controls, pre-spend requests, and ERP export linkage."""

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls

revision = "004_policy_pre_spend"
down_revision = "003_broker_resolver_sources"


def upgrade() -> None:
    op.add_column("corporate_card_system__settlement_claims", sa.Column("transaction_date", sa.String(length=40), nullable=True))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("card_last4", sa.String(length=4), nullable=True))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("cost_center", sa.String(length=80), nullable=True))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("project_code", sa.String(length=80), nullable=True))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("attendees_json", sa.Text(), nullable=False, server_default="[]"))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("receipt_status", sa.String(length=40), nullable=False, server_default="missing"))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("missing_receipt_reason", sa.Text(), nullable=True))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("pre_approval_id", sa.Integer(), nullable=True))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("policy_status", sa.String(length=40), nullable=False, server_default="warning"))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("policy_evaluation_json", sa.Text(), nullable=False, server_default="{}"))
    op.add_column("corporate_card_system__settlement_claims", sa.Column("erp_export_id", sa.Integer(), nullable=True))
    op.create_index(
        "ix_corporate_card_system__claims_policy_status",
        "corporate_card_system__settlement_claims",
        ["organization_id", "policy_status"],
    )
    op.create_index(
        "ix_corporate_card_system__claims_export",
        "corporate_card_system__settlement_claims",
        ["organization_id", "erp_export_id"],
    )

    op.add_column("corporate_card_system__approval_steps", sa.Column("decision_source", sa.String(length=80), nullable=False, server_default="assigned_approver"))

    op.create_table(
        "corporate_card_system__pre_spend_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("requester_member_id", sa.String(length=128), nullable=False),
        sa.Column("requester_name", sa.String(length=200), nullable=False),
        sa.Column("vendor", sa.String(length=240), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=12), nullable=False, server_default="KRW"),
        sa.Column("category", sa.String(length=80), nullable=False, server_default="general"),
        sa.Column("business_purpose", sa.Text(), nullable=False),
        sa.Column("expected_purchase_date", sa.String(length=40), nullable=True),
        sa.Column("cost_center", sa.String(length=80), nullable=True),
        sa.Column("project_code", sa.String(length=80), nullable=True),
        sa.Column("attendees_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("state", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("approval_snapshot_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("policy_evaluation_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("linked_claim_id", sa.Integer(), nullable=True),
        sa.Column("decided_by_member_id", sa.String(length=128), nullable=True),
        sa.Column("decision_memo", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__pre_spend_org",
        "corporate_card_system__pre_spend_requests",
        ["organization_id"],
    )
    op.create_index(
        "ix_corporate_card_system__pre_spend_requester",
        "corporate_card_system__pre_spend_requests",
        ["organization_id", "requester_member_id"],
    )
    op.create_index(
        "ix_corporate_card_system__pre_spend_state",
        "corporate_card_system__pre_spend_requests",
        ["organization_id", "state"],
    )
    ensure_org_rls(op, "corporate_card_system__pre_spend_requests")


def downgrade() -> None:
    op.drop_index("ix_corporate_card_system__pre_spend_state", table_name="corporate_card_system__pre_spend_requests")
    op.drop_index("ix_corporate_card_system__pre_spend_requester", table_name="corporate_card_system__pre_spend_requests")
    op.drop_index("ix_corporate_card_system__pre_spend_org", table_name="corporate_card_system__pre_spend_requests")
    op.drop_table("corporate_card_system__pre_spend_requests")
    op.drop_column("corporate_card_system__approval_steps", "decision_source")
    op.drop_index("ix_corporate_card_system__claims_export", table_name="corporate_card_system__settlement_claims")
    op.drop_index("ix_corporate_card_system__claims_policy_status", table_name="corporate_card_system__settlement_claims")
    op.drop_column("corporate_card_system__settlement_claims", "erp_export_id")
    op.drop_column("corporate_card_system__settlement_claims", "policy_evaluation_json")
    op.drop_column("corporate_card_system__settlement_claims", "policy_status")
    op.drop_column("corporate_card_system__settlement_claims", "pre_approval_id")
    op.drop_column("corporate_card_system__settlement_claims", "missing_receipt_reason")
    op.drop_column("corporate_card_system__settlement_claims", "receipt_status")
    op.drop_column("corporate_card_system__settlement_claims", "attendees_json")
    op.drop_column("corporate_card_system__settlement_claims", "project_code")
    op.drop_column("corporate_card_system__settlement_claims", "cost_center")
    op.drop_column("corporate_card_system__settlement_claims", "card_last4")
    op.drop_column("corporate_card_system__settlement_claims", "transaction_date")
