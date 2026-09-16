"""Palette SDK bridge.

Hosted (and under `pltt dev`/`pltt test`) `palette_sdk` is on PYTHONPATH:
`require_permission` gates each route and `get_plugin_context` yields the real
`PluginContext` (with `ctx.db`, the org-scoped request AsyncSession).

Standalone (plain uvicorn, pytest) the SDK is absent — we provide drop-in
fallbacks so the exact same async route code runs: `require_permission` becomes
a no-op dependency and `get_plugin_context` yields a lightweight context backed
by the local SQLite async session (see core/db.py).
"""

from __future__ import annotations

import os
from typing import Any, AsyncIterator

from fastapi import Depends

try:  # ---------- hosted / pltt ----------
    from palette_sdk import (  # type: ignore
        PluginContext,
        get_plugin_context,
        require_permission,
    )

    HAS_SDK = True

except ImportError:  # ---------- standalone dev / pytest ----------
    HAS_SDK = False

    def require_permission(_permission: str):  # type: ignore[misc]
        """No-op gate off-platform (no permission model to enforce)."""
        return Depends(lambda: None)

    class PluginContext:  # type: ignore[no-redef]
        """Minimal stand-in exposing the surface our routes use: `db`,
        `organization_id`, `user_id`, `config` and `secret()`."""

        def __init__(self, db: Any) -> None:
            self.db = db
            self.user_id = "local-user"
            self.organization_id = 0
            self.config: Any = None

        def secret(self, key: str, default: str | None = None) -> str | None:
            return os.environ.get(key, default)

    _local_ready = False

    async def get_plugin_context() -> AsyncIterator["PluginContext"]:  # type: ignore[misc]
        global _local_ready
        from .db import local_create_all, local_sessionmaker

        # Create the local SQLite tables once, lazily — covers `TestClient(app)`
        # instantiated outside a lifespan context (no startup event fires there).
        if not _local_ready:
            await local_create_all()
            _local_ready = True

        async with local_sessionmaker()() as session:
            yield PluginContext(session)


# Back-compat: some routes annotate `ctx: Any = ctx_dependency`. Resolves to the
# real PluginContext on-platform and to the local fallback context otherwise.
ctx_dependency: Any = Depends(get_plugin_context)


__all__ = ["require_permission", "get_plugin_context", "ctx_dependency", "PluginContext", "HAS_SDK"]
