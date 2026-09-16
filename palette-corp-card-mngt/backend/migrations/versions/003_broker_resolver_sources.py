"""Track hierarchy broker resolver sources on approval steps."""

from alembic import op
import sqlalchemy as sa

revision = "003_broker_resolver_sources"
down_revision = "002_workflow_functionality"


def upgrade() -> None:
    op.add_column(
        "corporate_card_system__approval_steps",
        sa.Column("source", sa.String(length=80), nullable=False, server_default="local_json_hierarchy"),
    )
    op.add_column(
        "corporate_card_system__approval_steps",
        sa.Column("resolver_source", sa.String(length=120), nullable=False, server_default="local_json_hierarchy"),
    )


def downgrade() -> None:
    op.drop_column("corporate_card_system__approval_steps", "resolver_source")
    op.drop_column("corporate_card_system__approval_steps", "source")
