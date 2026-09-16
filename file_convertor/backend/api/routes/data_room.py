"""GET /data-room — what this app has put in the org's Data Room.

`Document Toolbox/Uploads` and `Document Toolbox/Results`, listed together so
the page can show inputs and outputs side by side. Results carries one
sub-folder per tool that has produced something. See
core/data_room.py for why this is proxied through the plugin backend instead of
being called from the browser.

`available: false` is a first-class response, not an error: the Data Room is a
platform service, so the plain local simulator legitimately has none, and the
page needs to say that rather than show a broken list.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..core import data_room
from ..core.palette import ctx_dependency, require_permission

router = APIRouter(tags=["data-room"])


@router.get("/data-room", dependencies=[require_permission("data_rooms:read")])
async def get_data_room(ctx: Any = ctx_dependency) -> dict:
    if not data_room.available(ctx):
        return {
            "available": False,
            "detail": data_room.UNAVAILABLE_DETAIL,
            "app_folder": data_room.APP_FOLDER,
            "uploads": {"name": data_room.UPLOADS_FOLDER, "files": []},
            "results": {"name": data_room.RESULTS_FOLDER, "files": [], "folders": []},
        }
    try:
        listing = await data_room.contents(ctx)
    except data_room.DataRoomUnavailable as exc:
        return {
            "available": False,
            "detail": str(exc),
            "app_folder": data_room.APP_FOLDER,
            "uploads": {"name": data_room.UPLOADS_FOLDER, "files": []},
            "results": {"name": data_room.RESULTS_FOLDER, "files": [], "folders": []},
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not read the Data Room: {exc}")
    return {"available": True, **listing}
