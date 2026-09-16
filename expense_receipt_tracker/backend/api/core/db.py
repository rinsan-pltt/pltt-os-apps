"""Database base + session handling.

On the Palette platform (and under `pltt dev`/`pltt test`) the request
`AsyncSession` is provided by the SDK as `ctx.db` (see core/palette.py), the
plugin's Postgres schema is created by the Alembic migrations under
`backend/migrations/`, and every table is org-scoped with row-level security.
The plugin therefore NEVER builds its own engine or runs `create_all` at import
— doing IO at import time against the platform's async Postgres URL is exactly
what raised the `greenlet_spawn … await_only()` error the loader rejects.

Standalone dev (plain `uvicorn`) and `pytest` run without the SDK. There we
fall back to a local async SQLite engine so the same async route code works
out of the box; tables are created on app startup (see api/main.py).
"""

from __future__ import annotations

import os
from pathlib import Path

# Model base. On the platform/`pltt` this is the SDK's OrgScopedTable, which
# adds the `organization_id` column + RLS registration the migrations rely on.
# Standalone (no SDK) gets an equivalent local base so the same models import
# and run against SQLite.
try:
    from palette_sdk.db import OrgScopedTable  # type: ignore

    HAS_SDK = True
except ImportError:  # standalone dev / pytest
    from sqlalchemy import BigInteger
    from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

    class _PluginBase(DeclarativeBase):
        pass

    class OrgScopedTable(_PluginBase):  # type: ignore[no-redef]
        __abstract__ = True

        # Inherited by every concrete table (matches the SDK's OrgScopedTable
        # column). No RLS off-platform — SQLite has no row-level security.
        organization_id: Mapped[int] = mapped_column(
            BigInteger, nullable=False, default=0, index=True
        )

    HAS_SDK = False

Base = OrgScopedTable


# ---------------------------------------------------------------------------
# Standalone-only local async engine (dev + tests). On the platform the request
# AsyncSession comes from `ctx.db` and none of the below is ever touched, so no
# database IO happens at import time.
# ---------------------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_engine = None
_sessionmaker = None


def _local_url() -> str:
    raw = os.environ.get("DATABASE_URL")
    if raw:
        # A sync SQLite URL (e.g. the tests' conftest) → the async aiosqlite driver.
        if raw.startswith("sqlite:///"):
            return raw.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return raw
    default = _BACKEND_DIR / "data" / "expenses.db"
    default.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{default}"


def local_sessionmaker():
    """Lazily build (once) the standalone async session factory."""
    global _engine, _sessionmaker
    if _sessionmaker is None:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        _engine = create_async_engine(_local_url(), future=True)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _sessionmaker


async def local_create_all() -> None:
    """Create the tables on the local SQLite engine (standalone dev/tests only)."""
    from . import models  # noqa: F401 — register models on Base.metadata

    local_sessionmaker()  # ensure engine exists
    assert _engine is not None
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
