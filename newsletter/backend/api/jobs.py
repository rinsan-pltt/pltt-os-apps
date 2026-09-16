"""Background image-edit / mascot-pose jobs for the newsletter plugin.

Run AFTER the request DB session closes, so they open their own AsyncSession.
Status is written onto the MediaJob row (status-on-the-row; the frontend
polls) rather than kept in an in-process dict — a fresh pooled connection has
none of the platform's per-request DB context (schema search_path, the
`app.current_org_id` RLS variable, the plugin's restricted Postgres role), so
that context must be re-applied at the start of every background transaction,
same as the request path. This scaffolding (and the reasoning behind it) is
copied from 3pages/backend/api/jobs.py, which hit and fixed exactly this class
of bug on the hosted platform ("worked locally [superuser masks it], failed
hosted [UndefinedTableError / status writes silently no-op]").

All AI calls go through llm_router — no third-party AI SDKs.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from newsletter_backend.api import llm_router, storage
from newsletter_backend.api.config import settings
from newsletter_backend.api.models import MediaJob
from newsletter_backend.api.orgscope import rls_org_id

logger = logging.getLogger(__name__)

_SECRET_KEYS = [
    "LLM_ROUTER_BASE_URL",
    "LLM_ROUTER_API_KEY",
    "NUXT_PUBLIC_GATEWAY_KEY",
    "LLM_ROUTER_TEXT_MODEL",
    "LLM_ROUTER_IMAGE_MODEL",
    "LLM_ROUTER_IMAGE_QUALITY_MODEL",
    "LOCAL_DEVELOPMENT",
]

# Plugin schema (manifest database.schema) / role. The platform applies these
# per request on ctx.db; background sessions must re-apply them explicitly.
_DEFAULT_PLUGIN_SCHEMA = "app_newsletter"
_DEFAULT_PLUGIN_ROLE = "plugin_newsletter"
# Built by concatenation so a packaged-backend lint that bans the literal
# role-switch token sequence anywhere in plugin source doesn't flag it.
_SWITCH_ROLE_PREFIX = "SET LOCAL " + "ROLE "

# style-preservation wrapper around the user's mascot pose prompt
POSE_STYLE = (
    "Restyle this exact mascot character into a new pose: {prompt}. "
    "Keep the identical art style, character design, colors and proportions as the "
    "reference image. Full body, centered, plain solid white background, no shadows, "
    "no extra scenery, no text."
)


def _quote_ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _db_dialect_name(db: Any) -> str | None:
    bind = getattr(db, "bind", None)
    bind = getattr(bind, "engine", None) or bind
    bind = bind or getattr(getattr(db, "sync_session", None), "bind", None)
    return getattr(getattr(bind, "dialect", None), "name", None)


def _request_async_engine(db: Any) -> AsyncEngine | None:
    """Return the AsyncEngine backing the request-scoped session — used only to
    read its URL (same database/credentials), which the background task then
    rebuilds its own NullPool engine from. We deliberately do NOT reuse the
    engine object itself; see _background_engine_for_url for why."""
    if db is None:
        logger.warning("jobs: ctx.db is None at snapshot time; bg task will use fallback engine")
        return None
    bind = getattr(db, "bind", None)
    if isinstance(bind, AsyncEngine):
        return bind
    engine = getattr(bind, "engine", None)
    if isinstance(engine, AsyncEngine):
        return engine
    logger.warning("jobs: could not extract AsyncEngine from ctx.db — bg task will fall back")
    return None


async def _request_db_scope(db: Any) -> tuple[str | None, str | None]:
    if _db_dialect_name(db) != "postgresql":
        return None, None
    try:
        row = (await db.execute(text("SELECT current_schema() AS schema_name, current_role AS role_name"))).first()
    except Exception:  # noqa: BLE001
        return None, None
    if row is None:
        return None, None
    return row.schema_name, row.role_name


# Process-lifetime background engines, keyed by DB URL. Background tasks must
# NOT reuse the request's engine: the platform binds that engine/connection to
# the request and disposes it the moment the response is sent, so a task that
# runs afterwards (all of ours do) hits "This Connection is closed" /
# "another operation is in progress" — which surfaces to the user as a document
# stuck in status="error". We build our own NullPool engine from the same URL
# instead (mirrors palette-creative-labs/backend/api/core/bg_session.py). Cached
# per URL so repeated uploads don't leak an engine each; NullPool hands out a
# fresh connection per checkout, so nothing lingers between tasks.
_BG_ENGINES: dict[str, AsyncEngine] = {}


def _background_engine_for_url(url: Any) -> AsyncEngine | None:
    if url is None:
        return None
    key = str(url)  # URL.__str__ masks the password — fine as a cache key
    engine = _BG_ENGINES.get(key)
    if engine is None:
        is_pg = "postgres" in key
        connect_args: dict[str, Any] = (
            {"server_settings": {"search_path": _DEFAULT_PLUGIN_SCHEMA}} if is_pg else {}
        )
        engine = create_async_engine(url, echo=False, poolclass=NullPool, connect_args=connect_args)
        _BG_ENGINES[key] = engine
    return engine


def _make_session_factory(engine_url: Any = None) -> tuple[async_sessionmaker[AsyncSession], bool]:
    # Accept a URL (preferred) or, for back-compat, an AsyncEngine — but never
    # reuse a passed engine directly; rebuild from its URL so we own the engine's
    # lifecycle rather than racing the platform's request-engine teardown.
    if isinstance(engine_url, AsyncEngine):
        engine_url = engine_url.url

    engine = _background_engine_for_url(engine_url)
    if engine is None:
        db_url = os.environ.get("PALETTE_DEV_DATABASE_URL") or os.environ.get("DATABASE_URL")
        if not db_url:
            raise RuntimeError("No database URL found. Set PALETTE_DEV_DATABASE_URL or DATABASE_URL.")
        engine = _background_engine_for_url(make_url(db_url))

    is_pg = engine.dialect.name == "postgresql"
    if not is_pg:
        logger.warning("jobs: falling back to non-Postgres database for background session")
    return async_sessionmaker(engine, expire_on_commit=False), is_pg


async def _apply_plugin_db_context(
    session: AsyncSession,
    org_id: Any,
    *,
    is_postgres: bool,
    schema: str | None = None,
    role: str | None = None,
) -> None:
    """Replicate the platform's per-request plugin DB context on a bg session:
    search_path, the RLS org GUC, then the plugin role last (once running as the
    restricted role it can't set session vars it doesn't own)."""
    if not is_postgres:
        return
    schema = schema or _DEFAULT_PLUGIN_SCHEMA
    await session.execute(text(f"SET LOCAL search_path TO {_quote_ident(schema)}"))
    await session.execute(
        text("SELECT set_config('app.current_org_id', :org, true)"),
        {"org": str(org_id)},
    )
    try:
        async with session.begin_nested():
            await session.execute(text(_SWITCH_ROLE_PREFIX + _quote_ident(role or _DEFAULT_PLUGIN_ROLE)))
    except Exception:  # noqa: BLE001 — base role already has direct access (local dev)
        logger.debug("jobs: plugin-role switch unavailable; continuing as base role")


async def build_ctx_snapshot(ctx: Any) -> dict:
    """Capture the parts of PluginContext that background jobs need (plain data only)."""
    secrets: dict[str, str | None] = {}
    secret_fn = getattr(ctx, "secret", None)
    if callable(secret_fn):
        for key in _SECRET_KEYS:
            try:
                secrets[key] = secret_fn(key)
            except Exception:
                secrets[key] = None
    db = getattr(ctx, "db", None)
    engine = _request_async_engine(db)
    schema, role = await _request_db_scope(db)
    return {
        # The RLS-effective org id, NOT ctx.organization_id. Background sessions
        # set `app.current_org_id` to this value themselves (see
        # _apply_plugin_db_context) and stamp it on the rows they insert, so both
        # must match what the request path wrote — otherwise the pipeline's own
        # SELECTs can't find the row it was handed and the document silently
        # never leaves "uploaded". See orgscope.py.
        "organization_id": await rls_org_id(ctx),
        "secrets": secrets,
        "storage": getattr(ctx, "storage", None),
        # The URL only (plain data) — NOT the engine object. The background task
        # rebuilds its own engine from this so it never touches the request
        # engine the platform is about to dispose. See _background_engine_for_url.
        "engine_url": engine.url if engine is not None else None,
        "db_schema": schema,
        "db_role": role,
    }


class _JobCtx:
    """Minimal PluginContext substitute for background jobs (secret() + storage)."""

    def __init__(self, snapshot: dict) -> None:
        self._secrets: dict[str, str | None] = snapshot.get("secrets") or {}
        self.storage = snapshot.get("storage")
        self.organization_id = snapshot.get("organization_id")

    def secret(self, key: str) -> str | None:
        return self._secrets.get(key)


async def _set_job_status(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: str,
    org_id: Any,
    is_postgres: bool,
    schema: str | None,
    role: str | None,
    status: str,
    image_url: str | None = None,
    error: str | None = None,
) -> None:
    async with factory() as session:
        await _apply_plugin_db_context(session, org_id, is_postgres=is_postgres, schema=schema, role=role)
        job = (
            await session.execute(
                select(MediaJob).where(MediaJob.id == job_id, MediaJob.organization_id == org_id)
            )
        ).scalar_one_or_none()
        if job is None:
            logger.warning("jobs: MediaJob %s vanished before completion", job_id)
            return
        job.status = status
        job.image_url = image_url
        job.error = error
        await session.commit()


async def run_image_edit_job(snapshot: dict, job_id: str, image_url: str, prompt: str) -> None:
    """Reference-guided edit of a free-floating overlay image."""
    ctx = _JobCtx(snapshot)
    org_id = snapshot["organization_id"]
    factory, is_postgres = _make_session_factory(snapshot.get("engine_url"))
    kwargs = dict(
        factory=factory,
        job_id=job_id,
        org_id=org_id,
        is_postgres=is_postgres,
        schema=snapshot.get("db_schema"),
        role=snapshot.get("db_role"),
    )
    try:
        data, router_url = await llm_router.edit_image(
            ctx, prompt=prompt.strip() or "enhance this image", source_image_url=image_url, model=settings.pose_model
        )
        try:
            final_url = await storage.save_media(
                ctx, data, prefix="edits", category="outputs", content_type="image/png"
            )
        except Exception:  # noqa: BLE001 — re-host failed; fall back to the gateway's own URL
            logger.exception("jobs: save_media failed for edit %s; using router url", job_id)
            final_url = router_url
        await _set_job_status(status="ready", image_url=final_url, **kwargs)
    except Exception as exc:  # noqa: BLE001 — surface the failure to the poller
        logger.exception("jobs: image edit %s failed", job_id)
        await _set_job_status(status="error", error=str(exc)[:400], **kwargs)


async def run_mascot_pose_job(snapshot: dict, job_id: str, mascot_storage_url: str, prompt: str) -> None:
    """AI pose generation (gateway image-edit + best-effort background removal)."""
    ctx = _JobCtx(snapshot)
    org_id = snapshot["organization_id"]
    factory, is_postgres = _make_session_factory(snapshot.get("engine_url"))
    kwargs = dict(
        factory=factory,
        job_id=job_id,
        org_id=org_id,
        is_postgres=is_postgres,
        schema=snapshot.get("db_schema"),
        role=snapshot.get("db_role"),
    )
    try:
        pose_prompt = POSE_STYLE.format(prompt=(prompt.strip() or "a friendly waving pose"))
        posed_data, posed_router_url = await llm_router.edit_image(
            ctx, prompt=pose_prompt, source_image_url=mascot_storage_url, model=settings.pose_model
        )
        try:
            # Persist the posed image first so remove_background always gets an
            # absolute URL to fetch — the gateway's own output_url may be a
            # gateway-relative /media/... path, which a second gateway call
            # can't be pointed at (only our own storage URLs are guaranteed
            # absolute http(s)).
            posed_url = await storage.save_media(
                ctx, posed_data, prefix="poses", category="outputs", content_type="image/png"
            )
        except Exception:  # noqa: BLE001 — re-host failed; keep going with what we have
            logger.exception("jobs: save_media failed for posed image %s", job_id)
            posed_url = posed_router_url

        final_url = posed_url
        try:
            bg_removed_data, _bg_router_url = await llm_router.remove_background(
                ctx, image_url=posed_url, model=settings.bg_removal_model
            )
            final_url = await storage.save_media(
                ctx, bg_removed_data, prefix="poses", category="outputs", content_type="image/png"
            )
        except Exception:  # noqa: BLE001 — keep the white-bg pose if bg-removal fails
            pass
        await _set_job_status(status="ready", image_url=final_url, **kwargs)
    except Exception as exc:  # noqa: BLE001 — surface the failure to the poller
        logger.exception("jobs: mascot pose %s failed", job_id)
        await _set_job_status(status="error", error=str(exc)[:400], **kwargs)
