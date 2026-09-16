"""Pytest bootstrap for the newsletter plugin backend.

`palette_sdk` is shipped on PYTHONPATH at runtime by the Palette CLI rather than
installed as a pip dependency, so for standalone `pytest` runs we locate the
backend SDK (`@palettelab/cli/backend-sdk`) from any plugin's node_modules and
inject it onto sys.path.

Production code imports its own modules as `newsletter_backend.api.X` (see
main.py) rather than bare names — the hosted platform loader doesn't put
`backend/api` on sys.path the way `pltt dev`'s local simulator does, and bare
names like `models`/`storage`/`config` are generic enough to collide with
another plugin's same-named module cached in a shared hosted process. Tests
import the same qualified names, so `newsletter_backend` needs to resolve
here exactly like it does for main.py: bound to this plugin's own `backend/`
dir by explicit path, independent of sys.path search order.
"""

from __future__ import annotations

import importlib.util as _ilu
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_UNIQUE_PKG = "newsletter_backend"
if _UNIQUE_PKG not in sys.modules:
    _pkg_spec = _ilu.spec_from_file_location(
        _UNIQUE_PKG,
        str(_BACKEND_DIR / "__init__.py"),
        submodule_search_locations=[str(_BACKEND_DIR)],
    )
    _pkg_module = _ilu.module_from_spec(_pkg_spec)
    sys.modules[_UNIQUE_PKG] = _pkg_module
    _pkg_spec.loader.exec_module(_pkg_module)


def _locate_backend_sdk() -> Path | None:
    """Find a `@palettelab/cli/backend-sdk` dir containing the palette_sdk package.

    Search order: this plugin's node_modules, then sibling plugins under the
    shared paletteOS workspace (the CLI vendors an identical backend SDK in each).
    """
    here = Path(__file__).resolve()
    plugin_root = here.parents[2]  # .../paletteOS/newsletter
    candidates: list[Path] = [plugin_root / "node_modules" / "@palettelab" / "cli" / "backend-sdk"]

    workspace = plugin_root.parent  # .../paletteOS
    if workspace.is_dir():
        for sibling in sorted(workspace.iterdir()):
            sdk = sibling / "node_modules" / "@palettelab" / "cli" / "backend-sdk"
            if sdk != candidates[0]:
                candidates.append(sdk)

    for sdk in candidates:
        if (sdk / "palette_sdk" / "__init__.py").exists():
            return sdk
    return None


_sdk = _locate_backend_sdk()
if _sdk is not None and str(_sdk) not in sys.path:
    sys.path.insert(0, str(_sdk))

try:  # pragma: no cover - import guard for a clear failure message
    import palette_sdk  # noqa: F401
except ModuleNotFoundError as exc:  # pragma: no cover
    raise ModuleNotFoundError(
        "palette_sdk not found. Install the Palette CLI in a plugin's node_modules "
        "(@palettelab/cli ships backend-sdk), or run tests via `pltt test`."
    ) from exc
