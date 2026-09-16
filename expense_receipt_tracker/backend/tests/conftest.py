"""Point the test run at an isolated, throwaway SQLite DB + receipt storage
dir instead of the standalone-dev defaults under backend/data/ — must run
before `api.main` (and therefore `api.core.db`) is imported anywhere."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_tmp_dir = Path(tempfile.mkdtemp(prefix="expense-receipt-tracker-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_dir / 'test.db'}"
os.environ["STORAGE_DIR"] = str(_tmp_dir / "receipts")

# Keep the suite deterministic and offline: the standalone app loads the
# project's `.env` on startup (main._load_standalone_env), so a developer with
# a real OPENAI_KEY in `.env` would otherwise make the "no key -> heuristics
# only" test hit the live API. Force the key empty here — set (not unset), so
# the override=False .env load can't repopulate it — before api.main imports.
os.environ["OPENAI_KEY"] = ""
