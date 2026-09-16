from backend.api.routes.assets import router as assets_router
from backend.api.routes.events import router as events_router
from backend.api.routes.favourites import router as favourites_router
from backend.api.routes.general import router as general_router
from backend.api.routes.generate_image import router as generate_image_router
from backend.api.routes.generate_video import router as generate_video_router
from backend.api.routes.generations import router as generations_router
from backend.api.routes.projects import router as projects_router
from backend.api.routes.story_video import router as story_video_router
from backend.api.routes.talk import router as talk_router

# chat imports the agent tools, which import generate_image's handlers —
# keep it after generate_image so the module is already fully loaded.
# Guarded: this package init runs as a side effect of importing ANY submodule,
# so a chat/agent import failure here would otherwise take down every router.
# main.py mirrors this guard and skips the /agent routes when unavailable.
try:
    from backend.api.routes.chat import router as chat_router
except Exception:  # pragma: no cover - hosted-env guard
    chat_router = None  # type: ignore[assignment]

__all__ = [
    "general_router",
    "assets_router",
    "events_router",
    "favourites_router",
    "generate_image_router",
    "generate_video_router",
    "generations_router",
    "projects_router",
    "story_video_router",
    "talk_router",
    "chat_router",
]
