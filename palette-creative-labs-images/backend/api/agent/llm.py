"""LLM construction: OpenAI primary, Gemini fallback.

Both are built as separate tool-calling chat models so the agent can be
rebuilt on either; the fallback is applied at the agent level (try primary →
on error try Gemini) because LangGraph's ``create_react_agent`` needs a model
that exposes ``bind_tools`` and a ``RunnableWithFallbacks`` does not.

Keys are passed in (plugin secrets resolved per-request), not read from env.
"""

import logging
from typing import Optional

from .config import GEMINI_MODEL, OPENAI_MODEL

logger = logging.getLogger("pltt_creative.agent.llm")


def build_primary_model(api_key: Optional[str]):
    """OpenAI chat model (key from the OPENAI_KEY plugin secret)."""
    if not api_key:
        return None
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(model=OPENAI_MODEL, api_key=api_key, temperature=0.3)


def build_fallback_model(api_key: Optional[str]):
    """Gemini chat model (key from the GOOGLE_AI_API_KEY plugin secret)."""
    if not api_key:
        return None
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=GEMINI_MODEL, google_api_key=api_key, temperature=0.3
    )
