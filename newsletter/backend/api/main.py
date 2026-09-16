"""Newsletter plugin backend entry — brand/theme management, AI image
generation (overlays + mascot posing), document-driven RAG newsletter
generation, and HTML/PDF export.

The Palette platform mounts this `router` at `/api/v1/plugins/newsletter/*`.
No FastAPI app instance, no uvicorn, no CORS — that's all handled by the host
runtime.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Put this plugin's own `backend/` dir (and its plugin root) on sys.path so
# every import below — the bare `from palette_sdk import ...` (the CLI
# vendors the SDK at `backend/palette_sdk`, a sibling of `backend/api`) and
# our own cross-module imports — resolves regardless of what the hosted
# route loader itself puts on sys.path. `pltt dev`'s local simulator inserts
# `backend/api` onto sys.path itself, which is why this gap never shows up
# locally: every import quietly works there even without this file doing it.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PLUGIN_ROOT = Path(__file__).resolve().parents[2]
for _path in (str(_BACKEND_DIR), str(_PLUGIN_ROOT)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

# CRITICAL (shared-process isolation): if the hosted runtime keeps modules
# cached in `sys.modules` across plugins, a bare top-level name as generic as
# `models`, `config`, `storage`, `jobs`, or `images` can collide with another
# plugin's same-named module already cached there — silently importing the
# OTHER plugin's code (or its ORM tables, exploding with "Table already
# defined") instead of this plugin's own. Evict any cached module under these
# names whose file isn't under THIS plugin's root before importing our own.
_root_str = str(_PLUGIN_ROOT)
_GENERIC_ALIASES = (
    "models",
    "config",
    "storage",
    "jobs",
    "llm_router",
    "chunk",
    "extract",
    "serialize",
    "orgscope",
    "dataroom",
    "newsletter",
    "brand",
    "brand_theme",
    "images",
    "mascot",
    "export",
    "prompts",
    "sanitize",
    "typography",
    "migration_runner",
)
for _name in list(sys.modules):
    _top = _name.split(".", 1)[0]
    if _name == "backend" or _name.startswith("backend.") or _top in _GENERIC_ALIASES:
        _mod = sys.modules.get(_name)
        _file = getattr(_mod, "__file__", None) or ""
        if _file and not _file.startswith(_root_str):
            del sys.modules[_name]

# DEFINITIVE isolation: load this plugin's `backend/` package under the
# globally-unique name `newsletter_backend`, bound to this file's own
# directory by explicit path — so every `newsletter_backend.api.*` submodule
# can only ever come from THIS plugin's own tree, no matter what sys.path
# order or sys.modules state another plugin sharing this process left behind.
import importlib.util as _ilu

_UNIQUE_PKG = "newsletter_backend"
_cached_pkg = sys.modules.get(_UNIQUE_PKG)
_cached_file = getattr(_cached_pkg, "__file__", None) or ""
if _cached_pkg is None or not _cached_file.startswith(_root_str):
    for _name in [n for n in list(sys.modules) if n == _UNIQUE_PKG or n.startswith(_UNIQUE_PKG + ".")]:
        del sys.modules[_name]
    _pkg_spec = _ilu.spec_from_file_location(
        _UNIQUE_PKG,
        str(_BACKEND_DIR / "__init__.py"),
        submodule_search_locations=[str(_BACKEND_DIR)],
    )
    _pkg_module = _ilu.module_from_spec(_pkg_spec)
    sys.modules[_UNIQUE_PKG] = _pkg_module
    _pkg_spec.loader.exec_module(_pkg_module)

from palette_sdk import PluginRouter

from newsletter_backend.api import brand, brand_theme, dataroom, images, mascot, newsletter, talk

# `pltt dev`'s local simulator (.palette/dev/backend_runner.py) separately
# bare-imports "models" by name (to populate PluginBase.metadata before
# create_all) after loading this file. Without this, that becomes a SECOND,
# distinct `models` module object re-executing the same class bodies —
# `extend_existing` on each table papers over the resulting Table conflict,
# but SQLAlchemy's declarative class registry still ends up with two
# same-named classes (e.g. two `DocumentChunk`s), which breaks any
# string-based `relationship(...)` lookup ("Multiple classes found for path").
# Pre-registering the qualified module under the bare name makes any later
# `import <name>` (local or otherwise) a sys.modules cache hit instead of a
# fresh re-execution, so there is only ever one object per module.
for _name in _GENERIC_ALIASES:
    _qualified = sys.modules.get(f"{_UNIQUE_PKG}.api.{_name}")
    if _qualified is not None:
        sys.modules.setdefault(_name, _qualified)

router = PluginRouter(tags=["newsletter"])
router.include_router(brand_theme.router, prefix="/brand/themes")
router.include_router(brand.router, prefix="/brand")
router.include_router(images.router, prefix="/images")
router.include_router(mascot.router, prefix="/mascots")
router.include_router(dataroom.router)
router.include_router(newsletter.router)
router.include_router(talk.router, prefix="/talk")
