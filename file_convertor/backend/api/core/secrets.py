"""Plugin-secret reader (mirrors the reference plugin's resolution order).

1. ``ctx.config["secrets"][name]`` — injected by the platform on hosted
   installs and by the `pltt dev` simulator (which loads the plugin's .env).
2. ``os.environ[name]`` — hosted deployments inject declared .env values here.
3. ``ctx.secret(name)`` — SDK resolver, last because it raises for declared
   keys that are missing from config instead of falling back to the env.

Always returns a stripped string; "" means "not configured".
"""

from __future__ import annotations

import os
from typing import Any

try:
    from palette_sdk import MissingSecretError  # type: ignore
except ImportError:  # standalone dev/tests
    class MissingSecretError(Exception):
        pass


def read_secret(ctx: Any, name: str, default: str = "") -> str:
    config = getattr(ctx, "config", None)
    if isinstance(config, dict):
        secrets = config.get("secrets")
        if isinstance(secrets, dict):
            value = secrets.get(name)
            if value:
                return str(value).strip()

    env_value = os.environ.get(name)
    if env_value:
        return env_value.strip()

    secret_fn = getattr(ctx, "secret", None)
    if callable(secret_fn):
        try:
            value = secret_fn(name)
            if value:
                return str(value).strip()
        except MissingSecretError:
            pass
        except Exception:  # noqa: BLE001 — any resolver failure means "unset"
            pass

    return default
