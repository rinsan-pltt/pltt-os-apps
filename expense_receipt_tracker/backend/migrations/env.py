"""Alembic environment for the Expense & Receipt Tracker plugin.

Thin shim per the SDK contract: the platform provides the target schema, role
and DB URL via environment variables, and `palette_sdk.db.alembic_env` applies
them before running the migrations under `versions/`.
"""

from palette_sdk.db.alembic_env import run_migrations

run_migrations()
