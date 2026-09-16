"""Agent configuration.

LLM API keys are plugin secrets (OPENAI_KEY / GOOGLE_AI_API_KEY) resolved
per-request via `backend.api.core.secrets.read_secret` — only the env-tunable
knobs live here.
"""

import os

OPENAI_MODEL = os.getenv("AGENT_OPENAI_MODEL", "gpt-5.5")
GEMINI_MODEL = os.getenv("AGENT_GEMINI_MODEL", "gemini-2.5-pro")

# Defaults used ONLY when the user didn't name a model: chat-driven creations
# and edits both fall back to GPT Image 2.
DEFAULT_GENERATION_MODEL = os.getenv("AGENT_GENERATION_MODEL", "openai/gpt-image-2")
DEFAULT_EDIT_MODEL = os.getenv("AGENT_EDIT_MODEL", "openai/gpt-image-2")

# User-facing image models, in the order the UI lists them. Friendly labels are
# what the agent uses in replies; the keys are the internal model_name values
# it passes to tools. Edit capability is derived at runtime from
# generate_image._EDIT_ALLOWED_MODELS so the two never drift apart.
IMAGE_MODEL_LABELS: dict[str, str] = {
    "nano_banana_pro": "Nano Banana Pro",
    "openai/gpt-image-2": "GPT Image 2",
    "midjourney": "Midjourney",
}

# LangSmith tracing project (used when the LANGSMITH_API_KEY secret is set
# and no LANGSMITH_PROJECT secret/env overrides it).
LANGSMITH_PROJECT_DEFAULT = os.getenv("AGENT_LANGSMITH_PROJECT", "pltt-creative-video-agent")

# How long a tool waits for a generation to finish before returning the
# in-progress status (the result still streams to the UI via SSE).
GENERATION_POLL_TIMEOUT_S = int(os.getenv("AGENT_GENERATION_POLL_TIMEOUT_S", "150"))
GENERATION_POLL_INTERVAL_S = float(os.getenv("AGENT_GENERATION_POLL_INTERVAL_S", "2"))

# How long the CHAT endpoint waits for images before replying "still
# generating" and letting the rest stream in via SSE / the frontend's
# `/generations/{project_id}` poll fallback. Kept short so the HTTP request
# never hangs long enough for a production proxy to kill it (which previously
# made Midjourney chats appear stuck and lose the turn). Fast providers finish
# inside this window and still return their images inline in the reply.
CHAT_SETTLE_TIMEOUT_S = int(os.getenv("AGENT_CHAT_SETTLE_TIMEOUT_S", "25"))
