"""Expense & Receipt Tracker plugin backend entry.

The Palette platform imports this file and mounts the exported `router` at
`/api/v1/plugins/expense-receipt-tracker/*`. For standalone development the
module also builds a plain FastAPI `app`:

    cd backend && .venv/bin/uvicorn api.main:app --reload --port 8000
"""

from __future__ import annotations

import importlib.util as _ilu
import sys
from pathlib import Path

# The hosted runtime keeps modules cached in `sys.modules` across plugins, so
# generic top-level names (`api`, `routes`, `models`) can collide with other
# plugins' packages (see the reference file-convertor plugin, which hit
# exactly this). Load this plugin's backend under the globally unique
# package name `expense_receipt_tracker_backend`, bound to this file's own
# directory by explicit path, so every import below can only ever come from
# this plugin's tree.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_UNIQUE_PKG = "expense_receipt_tracker_backend"

_cached = sys.modules.get(_UNIQUE_PKG)
_cached_file = getattr(_cached, "__file__", None) or ""
if _cached is None or not _cached_file.startswith(str(_BACKEND_DIR)):
    for _name in [n for n in list(sys.modules) if n == _UNIQUE_PKG or n.startswith(_UNIQUE_PKG + ".")]:
        del sys.modules[_name]
    _spec = _ilu.spec_from_file_location(
        _UNIQUE_PKG,
        str(_BACKEND_DIR / "__init__.py"),
        submodule_search_locations=[str(_BACKEND_DIR)],
    )
    _module = _ilu.module_from_spec(_spec)
    sys.modules[_UNIQUE_PKG] = _module
    _spec.loader.exec_module(_module)

from expense_receipt_tracker_backend.api.core.palette import require_permission
from expense_receipt_tracker_backend.api.routes.categories import router as categories_router
from expense_receipt_tracker_backend.api.routes.chat import router as chat_router
from expense_receipt_tracker_backend.api.routes.expenses import router as expenses_router
from expense_receipt_tracker_backend.api.routes.imports import router as imports_router
from expense_receipt_tracker_backend.api.routes.receipts import router as receipts_router
from expense_receipt_tracker_backend.api.routes.reports import router as reports_router
from expense_receipt_tracker_backend.api.routes.settings import router as settings_router

# NOTE: no DB IO at import. On the platform the plugin's schema is created by the
# Alembic migrations under backend/migrations/, and the request AsyncSession is
# provided as ctx.db. Standalone dev/tests create the local SQLite tables on the
# app's startup event (see create_app below).

# Hosted: PluginRouter (palette_sdk is on PYTHONPATH via the CLI/platform).
# Standalone/dev/tests: plain APIRouter — same routes, no platform features.
try:
    from palette_sdk import PluginRouter  # type: ignore

    router = PluginRouter(tags=["expense-receipt-tracker"])
except ImportError:
    from fastapi import APIRouter

    router = APIRouter(tags=["expense-receipt-tracker"])

router.include_router(categories_router)
router.include_router(chat_router)
router.include_router(expenses_router)
router.include_router(imports_router)
router.include_router(receipts_router)
router.include_router(reports_router)
router.include_router(settings_router)


@router.get("/status", dependencies=[require_permission("tasks:read")])
def status() -> dict:
    return {"status": "ok", "plugin": "expense-receipt-tracker"}


def _load_standalone_env() -> None:
    """Load the plugin's root `.env` into `os.environ` for standalone dev.

    On the platform (and under `pltt dev`) secrets like OPENAI_KEY are injected
    by the runtime, so `read_secret` finds them. Plain `uvicorn`/pytest never
    load the `.env` file, which meant `read_secret("OPENAI_KEY")` returned ""
    and the LLM-assisted extraction in ocr.py was silently skipped — vendor,
    date and currency then came only from the weak regex heuristics. Load the
    `.env` here so keys placed in it actually reach the extraction code.

    `override=False` keeps any real environment value authoritative.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:  # python-dotenv not installed — nothing to load
        return
    env_path = _BACKEND_DIR.parent / ".env"
    load_dotenv(env_path, override=False)


def create_app():
    """Standalone FastAPI app for local development, tests and CI."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    _load_standalone_env()

    app = FastAPI(
        title="Expense & Receipt Tracker API",
        version="0.0.1",
        description="Scan receipts, categorize expenses, and export reimbursement reports.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router, prefix="/api")

    # No DB setup here: on the platform the schema is owned by the Alembic
    # migrations, and standalone the local SQLite tables are created lazily on
    # first request (see core/palette.py's fallback get_plugin_context).

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
