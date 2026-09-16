"""POST /chat — the in-app assistant.

One request carries the whole conversation. The transcript lives in the
browser (see frontend/hooks/use-chat.ts), not in this plugin's database: chat
history is not a record the app reports on, and keeping it client-side means no
new table, no migration, and no org-scoped message store to get wrong.

    POST /chat
      { messages: [{role, content}], attachments?: [...], confirm?: {...} }
    -> { reply, actions, pending, download, changed }

`pending` is a write the agent proposed that needs the user's approval before it
runs (deletes, bulk status changes, replacing the category set). The UI shows it
and sends it back in `confirm` on the next request.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.agent import PendingAction, run_agent
from ..core.agent_tools import tool_env
from ..core.category_store import category_dicts
from ..core.palette import PluginContext, get_plugin_context, require_permission
from ..core.secrets import read_secret

router = APIRouter(tags=["chat"])

# Guards on what one request may carry. The agent only reads the tail of the
# transcript anyway (core/agent.MAX_HISTORY_MESSAGES), so a larger payload is
# either a runaway client or someone using the endpoint as a prompt pipe.
MAX_MESSAGES = 100
MAX_MESSAGE_CHARS = 8000
MAX_ATTACHMENTS = 10


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)


class ChatAttachment(BaseModel):
    """A receipt the user attached, already scanned and stored by the frontend.

    The file itself never comes through this route: the frontend uploads it to
    durable platform storage and scans it with POST /receipts/scan first, so
    this is only the resulting reference plus the fields the scan read. That
    keeps one extraction path in the app instead of two.
    """

    id: str = Field(max_length=64)
    original_name: Optional[str] = Field(default=None, max_length=255)
    content_type: Optional[str] = Field(default=None, max_length=100)
    object_path: Optional[str] = Field(default=None, max_length=512)
    file_url: Optional[str] = None
    # Whatever /receipts/scan returned, verbatim, so the agent can see what was
    # read off the receipt and what it still has to ask about.
    draft: dict = Field(default_factory=dict)


class ConfirmedAction(BaseModel):
    tool: str = Field(max_length=64)
    args: dict = Field(default_factory=dict)
    description: str = Field(default="", max_length=500)


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    attachments: list[ChatAttachment] = Field(default_factory=list)
    confirm: Optional[ConfirmedAction] = None


class PendingActionOut(BaseModel):
    tool: str
    args: dict
    description: str


class ChatResponse(BaseModel):
    reply: str
    actions: list[str] = Field(default_factory=list)
    pending: Optional[PendingActionOut] = None
    download: Optional[dict] = None
    changed: bool = False


@router.post("/chat", dependencies=[require_permission("resources:write")])
async def chat(
    payload: ChatRequest, ctx: PluginContext = Depends(get_plugin_context)
) -> ChatResponse:
    if not payload.messages:
        raise HTTPException(status_code=422, detail="Send at least one message.")
    if len(payload.messages) > MAX_MESSAGES:
        raise HTTPException(status_code=422, detail="That conversation is too long to send.")
    if len(payload.attachments) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=422, detail=f"Attach at most {MAX_ATTACHMENTS} receipts at a time."
        )
    if payload.messages[-1].role != "user":
        raise HTTPException(status_code=422, detail="The last message must be the user's.")

    # Same secret the receipt scanner and the categoriser use. It is declared
    # optional in palette-plugin.json, so say plainly that chat is the one
    # feature that cannot fall back to heuristics.
    api_key = read_secret(ctx, "OPENAI_KEY")
    if not api_key:
        raise HTTPException(
            status_code=424,
            detail=(
                "Chat needs an AI key. Add OPENAI_KEY to the plugin's secrets "
                "(or its .env locally) and reload — every other page works without it."
            ),
        )

    attachments = [a.model_dump() for a in payload.attachments]
    env = await tool_env(ctx, attachments)
    # Seeds the org's defaults on first use, exactly as the scan route does.
    categories = await category_dicts(ctx)

    confirmed = (
        PendingAction(
            tool=payload.confirm.tool,
            args=payload.confirm.args,
            description=payload.confirm.description,
        )
        if payload.confirm is not None
        else None
    )

    result = await run_agent(
        ctx,
        api_key=api_key,
        env=env,
        categories=categories,
        history=[m.model_dump() for m in payload.messages],
        confirmed=confirmed,
    )

    return ChatResponse(
        reply=result.reply,
        actions=result.actions,
        pending=(
            PendingActionOut(
                tool=result.pending.tool,
                args=result.pending.args,
                description=result.pending.description,
            )
            if result.pending is not None
            else None
        ),
        download=result.download,
        changed=result.changed,
    )
