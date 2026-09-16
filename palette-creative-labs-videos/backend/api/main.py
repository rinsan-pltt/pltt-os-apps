"""Pltt Creative Video plugin backend entry.

The Palette platform automatically mounts this `router` at
`/api/v1/plugins/pltt-creative-video/*`. No FastAPI app instance, no uvicorn, no
CORS — that's all handled by the host runtime.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Put the plugin root on sys.path so every cross-module import below uses
# the fully-qualified `backend.api.X` name. This avoids two failure modes
# the hosted reviewer hit:
#   * generic top-level names (`routes`, `models`, `db_helpers`) collided
#     with the same names from other plugins cached in `sys.modules`, so
#     `from routes import assets_router` resolved to a stale module without
#     `assets_router` and surfaced as "route permission gate check failed".
#   * importing the same model module under two names (`models` vs
#     `backend.api.models`) would register each OrgScopedTable on the
#     metadata twice and explode with "Table already defined".
_PLUGIN_ROOT = Path(__file__).resolve().parents[2]
# The CLI bundles the backend SDK at `backend/palette_sdk`, so the `backend`
# directory must also be on sys.path for the bare `from palette_sdk import ...`
# below to resolve. The hosted route loader only puts the plugin root on
# sys.path (which is what makes `from backend.api.X` work), so without this the
# import failed with "No module named 'palette_sdk'" and the whole backend
# route load aborted — leaving the platform serving no/stale backend.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
for _path in (str(_BACKEND_DIR), str(_PLUGIN_ROOT)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

# CRITICAL (shared-process isolation): the hosted runtime keeps modules cached
# in `sys.modules` across plugins. Both this app and the sibling image app
# expose the SAME package path `backend.api.*` (e.g. `backend.api.models`), so a
# plain `import backend.api.models` can return the OTHER app's already-cached
# copy — which defines the image app's `pltt_creative__*` tables and makes every
# query hit a relation that doesn't exist in THIS plugin's schema. Evict any
# cached `backend`/`backend.*` (and `palette_sdk`) modules whose file is NOT
# under this plugin's root, so the imports below load THIS plugin's own files
# (its root was just inserted first on sys.path).
_root_str = str(_PLUGIN_ROOT)
# `backend.*` are this plugin's qualified modules; the bare names are the
# aliases models.py/db_helpers register (and that older revisions used) which
# also collide across plugins.
_GENERIC_ALIASES = ("models", "db_helpers", "routes")
for _name in list(sys.modules):
    _top = _name.split(".", 1)[0]
    if _name == "backend" or _name.startswith("backend.") or _top in _GENERIC_ALIASES:
        _mod = sys.modules.get(_name)
        _file = getattr(_mod, "__file__", None) or ""
        # Only evict a copy that belongs to a DIFFERENT plugin directory; never
        # touch this plugin's own already-loaded modules or file-less builtins.
        if _file and not _file.startswith(_root_str):
            del sys.modules[_name]

import logging

from fastapi import Depends

from palette_sdk import (
    LifecycleHooks,
    PluginContext,
    PluginRouter,
    require_permission,
)

from backend.api.core.org_db import get_ctx

# Import every router from its submodule directly — NEVER as an attribute of
# the `backend.api.routes` package. The hosted reviewer process keeps modules
# cached in `sys.modules` across plugin revisions: when a previous revision's
# `backend.api.routes` package is still cached, `from backend.api.routes
# import chat_router` reads the attribute off that STALE package object and
# fails with "cannot import name 'chat_router'" even though the new
# `__init__.py` on disk exports it. A direct submodule import side-steps the
# stale package: a submodule that isn't cached yet is always loaded fresh
# from the files of THIS revision.
#
# Order matters: chat's agent tools touch generate_image's handlers, so
# generate_image is imported first (same ordering routes/__init__.py keeps).
from backend.api.routes.general import router as general_router
from backend.api.routes.assets import router as assets_router
from backend.api.routes.events import router as events_router
from backend.api.routes.favourites import router as favourites_router
from backend.api.routes.generate_image import router as generate_image_router
from backend.api.routes.generate_video import router as generate_video_router
from backend.api.routes.generations import router as generations_router
from backend.api.routes.projects import router as projects_router
from backend.api.routes.talk import router as talk_router

# The chat agent is the only feature with a heavyweight dependency stack
# (langgraph/langchain). Its import must never take down the whole backend —
# if it fails in the hosted environment, log it and ship the app without the
# /agent routes rather than failing the platform's import/route gates.
_chat_import_error: str | None = None
try:
    from backend.api.routes.chat import router as chat_router
except Exception:  # pragma: no cover - hosted-env guard
    import traceback

    chat_router = None
    _chat_import_error = traceback.format_exc()[-4000:]
    logging.getLogger("pltt_creative_video").error(
        "chat router unavailable, /agent routes disabled:\n%s", _chat_import_error
    )

router = PluginRouter(tags=["pltt-creative-video"])

router.include_router(general_router)
router.include_router(assets_router)
router.include_router(events_router)
router.include_router(favourites_router)
# Image generation is no longer surfaced in the video panel (this is a
# video-only platform) — the chat agent's tools are the only remaining
# caller of these handlers (see import-order note).
router.include_router(generate_image_router)
router.include_router(generate_video_router)
router.include_router(generations_router)
router.include_router(projects_router)
router.include_router(talk_router)
if chat_router is not None:
    router.include_router(chat_router)


@router.get(
    "/diagnostics/chat",
    dependencies=[require_permission("resources:read")],
)
async def chat_diagnostics(ctx: PluginContext = Depends(get_ctx)):
    """Reports whether the /agent chat routes mounted in THIS runtime and, if
    not, the import traceback the guard captured. The hosted runtime gives no
    other way to see import-time failures (platform logs drop log records)."""
    import backend.api.routes as _routes_pkg

    info: dict = {
        "chat_router_mounted": chat_router is not None,
        "chat_import_error": _chat_import_error,
        "routes_package_file": getattr(_routes_pkg, "__file__", None),
        "entry_file": __file__,
    }
    if chat_router is not None:
        import backend.api.routes.chat as _chat_mod

        info["chat_module_file"] = getattr(_chat_mod, "__file__", None)
    return info


@router.get(
    "/diagnostics/db",
    dependencies=[require_permission("resources:read")],
)
async def db_diagnostics(ctx: PluginContext = Depends(get_ctx)):
    """Reports the row-level-security context of this request's DB session.

    `org_guc` / `org_guc_after_commit` must both equal `organization_id`. If
    either is null/empty, the org-isolation policy on every plugin table fails:
    reads return nothing and writes raise "new row violates row-level security
    policy". `org_guc_after_commit` is the interesting one — the CRUD helpers
    commit constantly, and a committed session picks up a different pooled
    connection for the next statement (see core/org_db.py)."""
    from sqlalchemy import func, select, text

    from backend.api.core.org_db import ORG_GUC
    from backend.api.models import Project

    info: dict = {
        "organization_id": ctx.organization_id,
        "user_id": ctx.user_id,
    }
    try:
        row = (
            await ctx.db.execute(
                text(
                    f"SELECT current_setting('{ORG_GUC}', true) AS org_guc, "
                    "current_setting('search_path') AS search_path, "
                    "current_user AS db_user"
                )
            )
        ).mappings().first()
        info.update(dict(row or {}))
        await ctx.db.commit()
        info["org_guc_after_commit"] = (
            await ctx.db.execute(text(f"SELECT current_setting('{ORG_GUC}', true)"))
        ).scalar()
        info["visible_projects"] = (
            await ctx.db.execute(select(func.count(Project.id)))
        ).scalar()
        await ctx.db.commit()
    except Exception as e:  # pragma: no cover - diagnostics only
        info["error"] = f"{type(e).__name__}: {e}"
    return info


lifecycle = LifecycleHooks()


@lifecycle.on_install
async def on_install(ctx: PluginContext) -> None:
    """Runs once when an org installs the plugin. Migrations have already
    created the tables; nothing to seed by default."""
    return None
