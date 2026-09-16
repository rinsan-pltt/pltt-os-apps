"""Move app role assignments onto the organisation role vocabulary.

The app used to carry its own roles (STAFF, TEAM_LEADER, ADMIN, FINANCE, CFO).
It now uses the four roles Palette OS already assigns — viewer, member, admin,
owner — so stored overrides are remapped: everything that could approve,
monitor, or export becomes `admin`, and plain submitters become `member`.
Stored permission lists are cleared so each remapped row falls back to the
permission set of its new role.
"""

from alembic import op
import sqlalchemy as sa


revision = "010_org_role_vocabulary"
down_revision = "009_localized_invoice_policy"


TABLE = "corporate_card_system__role_assignments"

# old app role -> organisation role
FORWARD = {
    "STAFF": "member",
    "TEAM_LEADER": "admin",
    "ADMIN": "admin",
    "FINANCE": "admin",
    "CFO": "admin",
}
# organisation role -> old app role, for a rollback
BACKWARD = {
    "viewer": "STAFF",
    "member": "STAFF",
    "admin": "ADMIN",
    "owner": "ADMIN",
}


def _remap(mapping: dict[str, str]) -> None:
    for source, target in mapping.items():
        op.execute(
            sa.text(f"UPDATE {TABLE} SET app_role = :target, permissions_json = '[]' WHERE app_role = :source").bindparams(
                target=target, source=source
            )
        )


def upgrade() -> None:
    _remap(FORWARD)


def downgrade() -> None:
    _remap(BACKWARD)
