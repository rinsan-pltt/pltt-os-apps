"""Add app role assignments."""

from alembic import op
import sqlalchemy as sa

from palette_sdk.db import ensure_org_rls


revision = "008_role_assignments"
down_revision = "007_claim_tax_fields"


def upgrade() -> None:
    op.create_table(
        "corporate_card_system__role_assignments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("member_id", sa.String(length=128), nullable=False),
        sa.Column("app_role", sa.String(length=40), nullable=False, server_default="STAFF"),
        sa.Column("permissions_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("assigned_by_member_id", sa.String(length=128), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_corporate_card_system__role_assignments_member",
        "corporate_card_system__role_assignments",
        ["organization_id", "member_id"],
        unique=True,
    )
    op.create_index(
        "ix_corporate_card_system__role_assignments_role",
        "corporate_card_system__role_assignments",
        ["organization_id", "app_role"],
    )
    ensure_org_rls(op, "corporate_card_system__role_assignments")


def downgrade() -> None:
    op.drop_index("ix_corporate_card_system__role_assignments_role", table_name="corporate_card_system__role_assignments")
    op.drop_index("ix_corporate_card_system__role_assignments_member", table_name="corporate_card_system__role_assignments")
    op.drop_table("corporate_card_system__role_assignments")
