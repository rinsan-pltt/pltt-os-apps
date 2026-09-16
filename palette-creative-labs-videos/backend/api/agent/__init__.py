"""Chat agent (LangGraph) for the Pltt Creative Video plugin.

Ported from pltt-agg's `backend/agent/`. Differences from the source:
  * Postgres store → org-scoped SQLAlchemy models (AgentThread/AgentMessage/
    AgentThreadImage) instead of a private psycopg pool.
  * Tools call the generation route handlers in-process with the request's
    PluginContext instead of loopback HTTP with a bearer token.
  * LLM keys come from plugin secrets (OPENAI_KEY / GOOGLE_AI_API_KEY) via
    `read_secret`, not module-level env.
"""
