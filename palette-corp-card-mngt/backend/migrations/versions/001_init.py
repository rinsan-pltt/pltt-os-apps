"""Initial migration - corporate card workflow tables."""

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls

revision = "001_init"
down_revision = None


def upgrade() -> None:
    op.create_table(
        "corporate_card_system__cards",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("member_id", sa.String(length=128), nullable=False),
        sa.Column("member_name", sa.String(length=200), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("last4", sa.String(length=4), nullable=False),
        sa.Column("monthly_limit_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_corporate_card_system__cards_org", "corporate_card_system__cards", ["organization_id"])
    op.create_index(
        "ix_corporate_card_system__cards_member",
        "corporate_card_system__cards",
        ["organization_id", "member_id"],
    )
    ensure_org_rls(op, "corporate_card_system__cards")

    op.create_table(
        "corporate_card_system__settlement_claims",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("requester_member_id", sa.String(length=128), nullable=False),
        sa.Column("requester_name", sa.String(length=200), nullable=False),
        sa.Column("vendor", sa.String(length=240), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=12), nullable=False, server_default="KRW"),
        sa.Column("category", sa.String(length=80), nullable=False, server_default="general"),
        sa.Column("business_purpose", sa.Text(), nullable=False),
        sa.Column("receipt_file_url", sa.Text(), nullable=True),
        sa.Column("state", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("approval_snapshot_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__claims_org",
        "corporate_card_system__settlement_claims",
        ["organization_id"],
    )
    op.create_index(
        "ix_corporate_card_system__claims_requester",
        "corporate_card_system__settlement_claims",
        ["organization_id", "requester_member_id"],
    )
    op.create_index(
        "ix_corporate_card_system__claims_state",
        "corporate_card_system__settlement_claims",
        ["organization_id", "state"],
    )
    ensure_org_rls(op, "corporate_card_system__settlement_claims")

    op.create_table(
        "corporate_card_system__approval_steps",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("claim_id", sa.Integer(), nullable=False),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.Column("approver_member_id", sa.String(length=128), nullable=True),
        sa.Column("approver_name", sa.String(length=200), nullable=False),
        sa.Column("approver_title", sa.String(length=200), nullable=True),
        sa.Column("reason", sa.String(length=120), nullable=False),
        sa.Column("state", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("decision_memo", sa.Text(), nullable=True),
        sa.Column("decided_by_member_id", sa.String(length=128), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__steps_org",
        "corporate_card_system__approval_steps",
        ["organization_id"],
    )
    op.create_index(
        "ix_corporate_card_system__steps_claim",
        "corporate_card_system__approval_steps",
        ["organization_id", "claim_id", "step_order"],
    )
    op.create_index(
        "ix_corporate_card_system__steps_approver",
        "corporate_card_system__approval_steps",
        ["organization_id", "approver_member_id", "state"],
    )
    ensure_org_rls(op, "corporate_card_system__approval_steps")

    op.create_table(
        "corporate_card_system__policy_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False, server_default="general"),
        sa.Column("threshold_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("action", sa.String(length=80), nullable=False, server_default="require_approval"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__rules_org",
        "corporate_card_system__policy_rules",
        ["organization_id"],
    )
    ensure_org_rls(op, "corporate_card_system__policy_rules")


def downgrade() -> None:
    op.drop_index("ix_corporate_card_system__rules_org", table_name="corporate_card_system__policy_rules")
    op.drop_table("corporate_card_system__policy_rules")
    op.drop_index("ix_corporate_card_system__steps_approver", table_name="corporate_card_system__approval_steps")
    op.drop_index("ix_corporate_card_system__steps_claim", table_name="corporate_card_system__approval_steps")
    op.drop_index("ix_corporate_card_system__steps_org", table_name="corporate_card_system__approval_steps")
    op.drop_table("corporate_card_system__approval_steps")
    op.drop_index("ix_corporate_card_system__claims_state", table_name="corporate_card_system__settlement_claims")
    op.drop_index("ix_corporate_card_system__claims_requester", table_name="corporate_card_system__settlement_claims")
    op.drop_index("ix_corporate_card_system__claims_org", table_name="corporate_card_system__settlement_claims")
    op.drop_table("corporate_card_system__settlement_claims")
    op.drop_index("ix_corporate_card_system__cards_member", table_name="corporate_card_system__cards")
    op.drop_index("ix_corporate_card_system__cards_org", table_name="corporate_card_system__cards")
    op.drop_table("corporate_card_system__cards")
