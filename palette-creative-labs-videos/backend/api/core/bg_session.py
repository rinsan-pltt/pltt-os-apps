"""Background-task DB session helper.

The platform binds the request's `AsyncSession` (and, on the hosted runtime, its
engine/connection) to the request lifecycle and tears it down the moment the
response is sent. A detached `asyncio.create_task` that keeps writing through
`ctx.db` therefore races that teardown — surfacing as either
`asyncpg … another operation is in progress` (connection shared with the
finishing request) or `ResourceClosedError: This Connection is closed` (engine
already disposed). For long generations (e.g. Midjourney/fal actions on old
jobs) the result lands after the request is long gone, so the final
`update_item_success` / `update_item_failed` write never persists — the item is
stuck "generating" or completes invisibly.

`background_session(ctx)` solves this with a process-lifetime engine that is
independent of any request. It reproduces the two pieces of per-connection
context the platform sets so plugin queries behave identically:

  * `search_path` → the plugin schema (tables are unqualified in the models),
  * `app.current_org_id` → the org id the RLS policy filters on; without it the
    org-isolation policy matches zero rows and every read/write silently no-ops.

`NullPool` means each checkout is a fresh connection, so the `connect` event
re-applies the context every time — including the connection a helper picks up
*after* its own `commit()` releases the previous one.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from contextvars import ContextVar

from sqlalchemy import event
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from palette_sdk import PluginContext

from backend.api.core.org_db import install_org_rls_listener

# Plugin Postgres schema (matches palette-plugin.json `database.schema`).
_SCHEMA = "app_pltt_creative_video"

# Org id for the connection the current background task is using. Read inside
# the engine `connect` event so each fresh NullPool connection is scoped to the
# right organisation.
_bg_org_id: ContextVar[int | None] = ContextVar("_bg_org_id", default=None)

_bg_engine = None


def _resolve_url(ctx: PluginContext):
    """Best-effort DB URL: the request engine's URL, else the env var."""
    bind = ctx.db.bind
    src = getattr(bind, "engine", bind)
    url = getattr(src, "url", None)
    if url is not None:
        return url
    raw = os.environ.get("DATABASE_URL") or os.environ.get("PALETTE_DEV_DATABASE_URL")
    return make_url(raw) if raw else None


def _get_engine(ctx: PluginContext):
    global _bg_engine
    if _bg_engine is not None:
        return _bg_engine

    url = _resolve_url(ctx)
    if url is None:
        # Nothing to build from — fall back to the request engine (best effort).
        return ctx.db.bind

    # `pool_pre_ping` is harmless with NullPool but keeps intent clear; NullPool
    # already hands out a fresh connection per checkout so stale sockets from a
    # long generation can't linger.
    engine = create_async_engine(url, poolclass=NullPool, pool_pre_ping=True)

    # Postgres-only: dev may fall back to SQLite, which has no search_path / RLS.
    if engine.dialect.name == "postgresql":
        @event.listens_for(engine.sync_engine, "connect")
        def _apply_plugin_context(dbapi_connection, _record):  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute(f'SET search_path TO "{_SCHEMA}", public')
                org = _bg_org_id.get()
                if org is not None:
                    # Inline the org id as an integer (injection-safe — it is
                    # numeric) to avoid DBAPI param-style ambiguity in this
                    # connect-event cursor. session-level (is_local=False) so it
                    # survives the transactions the CRUD helpers commit here.
                    try:
                        oid = int(org)
                    except (TypeError, ValueError):
                        oid = None
                    if oid is not None:
                        cursor.execute(
                            f"SELECT set_config('app.current_org_id', '{oid}', false)"
                        )
            finally:
                cursor.close()

    _bg_engine = engine
    return _bg_engine


@asynccontextmanager
async def standalone_background_session(ctx: PluginContext):
    """A self-contained background session that does NOT swap ``ctx.db``.

    Use this for tasks that run CONCURRENTLY (e.g. parallel Midjourney
    variations): each gets its own session/connection, so they don't collide on
    a shared session ("another operation is in progress"). Pass the yielded
    session explicitly to the db helpers instead of using ``ctx.db``. The org
    RLS context is applied per-connection via the engine connect event.
    """
    engine = _get_engine(ctx)
    token = _bg_org_id.set(getattr(ctx, "organization_id", None))
    session = AsyncSession(bind=engine, expire_on_commit=False)
    # Belt and braces: the `connect` event above only covers connections this
    # module's own engine opens. If `_get_engine` had to fall back to the
    # request engine (pooled), the org context has to be re-applied per
    # transaction instead — see `core/org_db.py`.
    install_org_rls_listener(session, getattr(ctx, "organization_id", None))
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
        _bg_org_id.reset(token)


@asynccontextmanager
async def background_session(ctx: PluginContext):
    engine = _get_engine(ctx)
    token = _bg_org_id.set(getattr(ctx, "organization_id", None))
    new_session = AsyncSession(bind=engine, expire_on_commit=False)
    install_org_rls_listener(new_session, getattr(ctx, "organization_id", None))
    original = ctx.db
    ctx.db = new_session
    try:
        yield new_session
        await new_session.commit()
    except Exception:
        await new_session.rollback()
        raise
    finally:
        await new_session.close()
        ctx.db = original
        _bg_org_id.reset(token)
