"""Resolve the organization_id that this schema's RLS policy will actually accept.

`palette_sdk`'s `OrgRepository.create()` stamps every new row with
`ctx.organization_id`, which `get_plugin_context` reads from
`request.state.user.organization_id`. The org-isolation policy that
`ensure_org_rls` installs in 001_init.py, however, checks the row against a
Postgres session variable:

    USING      (organization_id = current_setting('app.current_org_id', true)::bigint)
    WITH CHECK (organization_id = current_setting('app.current_org_id', true)::bigint)

On the hosted server those two numbers are not the same. `ctx.organization_id`
is the *organisation* id (e.g. 2), while the platform sets the GUC to the value
its own tenancy layer scopes rows by — visible in the storage object path the
same request produced (`.../palette_2/t4294967304/...`). The mismatch makes
every INSERT through `ctx.repo(...)` fail with

    asyncpg.exceptions.InsufficientPrivilegeError:
    new row violates row-level security policy for table "newsletter__document"

and makes every SELECT filtered on `ctx.organization_id` silently match nothing
(RLS filters reads rather than erroring), so the failure reads as "uploads are
broken" while the rest of the app merely looks empty.

`pltt dev` never reproduces this. The local simulator builds its tables with
`PluginBase.metadata.create_all` straight from models.py (see
.palette/dev/backend_runner.py), which never runs `ensure_org_rls` — so locally
there is no policy to violate. The migration that installs it only ever runs on
the server. That asymmetry is the whole reason this class of bug survives local
testing.

Reading the GUC back from the same session is what keeps writes and reads
consistent with the platform: this app never interprets `organization_id`
itself, it is purely the tenancy discriminator RLS matches on, so the correct
value is by definition whatever the policy compares against.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

logger = logging.getLogger(__name__)

# Cache key on AsyncSession.info — the GUC is fixed for a session's lifetime,
# so this costs one tiny query per request rather than one per write.
_CACHE_KEY = "newsletter_rls_org_id"


def _coerce(raw: Any) -> int | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


async def rls_org_id(ctx: Any) -> int:
    """The org id to stamp on new rows so they satisfy the org-isolation policy.

    Falls back to `ctx.organization_id` when the GUC is unset or unreadable —
    which is the correct behaviour under `pltt dev` (no RLS at all) and under
    SQLite. If the GUC is genuinely unset on a Postgres server the policy will
    reject *any* value, so that case is logged loudly: it means the platform did
    not apply plugin DB context to this request, which app code cannot fix.
    """
    fallback = getattr(ctx, "organization_id", None)
    db = getattr(ctx, "db", None)
    if db is None:
        return fallback

    info = getattr(db, "info", None)
    if isinstance(info, dict) and _CACHE_KEY in info:
        return info[_CACHE_KEY]

    resolved = fallback
    try:
        raw = (await db.execute(text("SELECT current_setting('app.current_org_id', true)"))).scalar()
    except Exception:  # noqa: BLE001 — never fail a write over the lookup itself
        logger.warning("orgscope: could not read app.current_org_id; using ctx.organization_id", exc_info=True)
    else:
        current = _coerce(raw)
        if current is None:
            # Only alarming on Postgres; SQLite/pltt dev legitimately has no GUC.
            logger.warning(
                "orgscope: app.current_org_id is not set on this session — if this is the hosted "
                "server, the org-isolation policy will reject every INSERT no matter what "
                "organization_id is written. Falling back to ctx.organization_id=%s.",
                fallback,
            )
        else:
            resolved = current
            if current != fallback:
                logger.info(
                    "orgscope: stamping rows with the RLS session org id %s rather than "
                    "ctx.organization_id=%s (they differ on this runtime).",
                    current,
                    fallback,
                )

    if isinstance(info, dict):
        info[_CACHE_KEY] = resolved
    return resolved


async def org_repo(ctx: Any, model: type[Any]):
    """`ctx.repo(model)` but scoped to the RLS-effective org id.

    Use this instead of `ctx.repo(model)` for any table created with
    `ensure_org_rls` — i.e. every table in this plugin.
    """
    from palette_sdk.repository import OrgRepository

    return OrgRepository(ctx.db, model, await rls_org_id(ctx))
