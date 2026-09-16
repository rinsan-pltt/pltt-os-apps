"""Palette SDK bridge.

Hosted (and under `pltt dev`/`pltt test`) `palette_sdk` is on PYTHONPATH and
`require_permission` gates each route against the platform's permission model.
Standalone (plain uvicorn, pytest) the SDK is absent — fall back to a no-op
dependency so the same route definitions work everywhere.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends

try:
    from palette_sdk import require_permission  # type: ignore
except ImportError:  # standalone dev/test — no platform, no gating

    def require_permission(_permission: str):  # type: ignore[misc]
        return Depends(lambda: None)


try:
    from palette_sdk import get_plugin_context  # type: ignore

    ctx_dependency: Any = Depends(get_plugin_context)
except ImportError:  # standalone dev/tests — there is no platform context
    ctx_dependency = None


__all__ = ["require_permission", "ctx_dependency"]
