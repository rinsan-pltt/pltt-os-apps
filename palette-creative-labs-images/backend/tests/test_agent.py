"""Smoke checks for the chat agent: imports, tool registry, route registration."""

import importlib.util
from pathlib import Path


def _load_entry():
    entry = Path(__file__).resolve().parents[1] / "api" / "main.py"
    spec = importlib.util.spec_from_file_location("plugin_backend_entry_agent", entry)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_agent_tools_and_routes_registered():
    module = _load_entry()

    from pltt_image_backend.api.agent.tools import get_tools

    names = sorted(t.name for t in get_tools())
    assert names == [
        "create_image",
        "edit_image",
        "list_thread_images",
        "regenerate_image",
    ]

    agent_paths = {r.path for r in module.router.routes if r.path.startswith("/agent")}
    assert {"/agent/threads", "/agent/threads/{thread_id}", "/agent/chat"} <= agent_paths


def test_agent_models_registered():
    _load_entry()

    from pltt_image_backend.api.models import AgentMessage, AgentThread, AgentThreadImage

    assert AgentThread.__tablename__ == "pltt_creative__agent_threads"
    assert AgentMessage.__tablename__ == "pltt_creative__agent_messages"
    assert AgentThreadImage.__tablename__ == "pltt_creative__agent_thread_images"
