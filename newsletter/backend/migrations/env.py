"""Alembic environment for Palette plugin migrations."""

from alembic import context


def _run_with_connection(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=None,
        version_table="alembic_version",
        include_schemas=False,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.config.attributes.get("connection") is not None:
    _run_with_connection(context.config.attributes["connection"])
else:
    from palette_sdk.db.alembic_env import run_migrations

    run_migrations()
