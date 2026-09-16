"""File Convertor plugin backend entry.

The Palette platform imports this file and mounts the exported `router` at
`/api/v1/plugins/file-convertor/*`. For standalone development the module also
builds a plain FastAPI `app`:

    cd backend && .venv/bin/uvicorn api.main:app --reload --port 8000
"""

from __future__ import annotations

import importlib.util as _ilu
import sys
from pathlib import Path

# The hosted runtime keeps modules cached in `sys.modules` across plugins, so
# generic top-level names (`api`, `routes`, `models`) can collide with other
# plugins' packages (see the reference pltt-creative plugin, which hit exactly
# this). Load this plugin's backend under the globally unique package name
# `file_convertor_backend`, bound to this file's own directory by explicit
# path, so every import below can only ever come from this plugin's tree.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_UNIQUE_PKG = "file_convertor_backend"

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

from file_convertor_backend.api.core.palette import require_permission
from file_convertor_backend.api.routes.ai import router as ai_router
from file_convertor_backend.api.routes.compare import router as compare_router
from file_convertor_backend.api.routes.data_room import router as data_room_router
from file_convertor_backend.api.routes.edit import router as edit_router
from file_convertor_backend.api.routes.organize import router as organize_router
from file_convertor_backend.api.routes.talk import router as talk_router
from file_convertor_backend.api.routes.tools import router as tools_router
from file_convertor_backend.api.routes.webpage import router as webpage_router

# Hosted: PluginRouter (palette_sdk is on PYTHONPATH via the CLI/platform).
# Standalone/dev/tests: plain APIRouter — same routes, no platform features.
try:
    from palette_sdk import PluginRouter  # type: ignore

    router = PluginRouter(tags=["file-convertor"])
except ImportError:
    from fastapi import APIRouter

    router = APIRouter(tags=["file-convertor"])

# webpage_router declares a literal /tools/html-to-pdf path; it must be
# registered BEFORE tools_router's dynamic /tools/{slug} catch-all, or the
# catch-all matches first and reports "Unknown tool 'html-to-pdf'" (404).
router.include_router(webpage_router)
router.include_router(tools_router)
router.include_router(ai_router)
router.include_router(edit_router)
router.include_router(organize_router)
router.include_router(compare_router)
router.include_router(data_room_router)
router.include_router(talk_router)


@router.get("/status", dependencies=[require_permission("tasks:read")])
def status() -> dict:
    return {"status": "ok", "plugin": "file-convertor"}


def create_app():
    """Standalone FastAPI app for local development, tests and CI."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(
        title="File Convertor API",
        version="0.0.1",
        description="Convert, compress and organize documents — PDF, Word, Excel, PowerPoint, images and more.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router, prefix="/api")

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
