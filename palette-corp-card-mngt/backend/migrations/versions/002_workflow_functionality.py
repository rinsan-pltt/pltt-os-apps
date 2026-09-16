"""Add statement reconciliation, ERP exports, and policy Q&A."""

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls

revision = "002_workflow_functionality"
down_revision = "001_init"


def upgrade() -> None:
    op.create_table(
        "corporate_card_system__statement_uploads",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("filename", sa.String(length=240), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("matched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("missing_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uploaded_by_member_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__statement_uploads_org",
        "corporate_card_system__statement_uploads",
        ["organization_id"],
    )
    ensure_org_rls(op, "corporate_card_system__statement_uploads")

    op.create_table(
        "corporate_card_system__statement_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("upload_id", sa.Integer(), nullable=False),
        sa.Column("transaction_date", sa.String(length=40), nullable=True),
        sa.Column("card_last4", sa.String(length=4), nullable=True),
        sa.Column("cardholder_member_id", sa.String(length=128), nullable=True),
        sa.Column("cardholder_name", sa.String(length=200), nullable=True),
        sa.Column("vendor", sa.String(length=240), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=12), nullable=False, server_default="KRW"),
        sa.Column("category", sa.String(length=80), nullable=False, server_default="general"),
        sa.Column("match_status", sa.String(length=40), nullable=False, server_default="missing"),
        sa.Column("match_claim_id", sa.Integer(), nullable=True),
        sa.Column("raw_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__statement_rows_org",
        "corporate_card_system__statement_rows",
        ["organization_id"],
    )
    op.create_index(
        "ix_corporate_card_system__statement_rows_upload",
        "corporate_card_system__statement_rows",
        ["organization_id", "upload_id"],
    )
    op.create_index(
        "ix_corporate_card_system__statement_rows_member",
        "corporate_card_system__statement_rows",
        ["organization_id", "cardholder_member_id"],
    )
    op.create_index(
        "ix_corporate_card_system__statement_rows_status",
        "corporate_card_system__statement_rows",
        ["organization_id", "match_status"],
    )
    ensure_org_rls(op, "corporate_card_system__statement_rows")

    op.create_table(
        "corporate_card_system__erp_exports",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("filename", sa.String(length=240), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_amount_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("generated_by_member_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__erp_exports_org",
        "corporate_card_system__erp_exports",
        ["organization_id"],
    )
    ensure_org_rls(op, "corporate_card_system__erp_exports")

    op.create_table(
        "corporate_card_system__policy_questions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("asked_by_member_id", sa.String(length=128), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False, server_default="local_policy"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__policy_questions_org",
        "corporate_card_system__policy_questions",
        ["organization_id"],
    )
    ensure_org_rls(op, "corporate_card_system__policy_questions")


def downgrade() -> None:
    op.drop_index("ix_corporate_card_system__policy_questions_org", table_name="corporate_card_system__policy_questions")
    op.drop_table("corporate_card_system__policy_questions")
    op.drop_index("ix_corporate_card_system__erp_exports_org", table_name="corporate_card_system__erp_exports")
    op.drop_table("corporate_card_system__erp_exports")
    op.drop_index("ix_corporate_card_system__statement_rows_status", table_name="corporate_card_system__statement_rows")
    op.drop_index("ix_corporate_card_system__statement_rows_member", table_name="corporate_card_system__statement_rows")
    op.drop_index("ix_corporate_card_system__statement_rows_upload", table_name="corporate_card_system__statement_rows")
    op.drop_index("ix_corporate_card_system__statement_rows_org", table_name="corporate_card_system__statement_rows")
    op.drop_table("corporate_card_system__statement_rows")
    op.drop_index("ix_corporate_card_system__statement_uploads_org", table_name="corporate_card_system__statement_uploads")
    op.drop_table("corporate_card_system__statement_uploads")
