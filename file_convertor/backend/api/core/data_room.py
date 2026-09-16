"""Data Room integration: where this app's inputs and outputs live.

## Why this is backend-only

The frontend SDK exposes a `dataRooms` client, but `createPaletteClient(ctx)`
constructs it as `new DataRoomClient()` — with **no context**, unlike
`StorageClient(ctx)` beside it. It therefore always calls the SDK's own
`apiFetch`, whose base URL defaults to `http://localhost:8000` and can only be
changed by a build-time `NEXT_PUBLIC_API_URL`. A plugin bundle is built by
`pltt`, not by the OS, so from inside the sandboxed iframe that address does not
resolve. The browser cannot reach the Data Room API.

`ctx.data_rooms` is the supported path: the platform injects the service into
`PluginContext` (`palette_sdk/plugin_context.py`), and it carries
`read_file_bytes(file_id)` — which is what lets a tool run on a Data Room file
without the browser downloading and re-uploading it.

## Availability

The service is injected only on the platform (and in `pltt dev --sandbox`).
Under plain `pltt dev` it is `None` and every call raises `RuntimeError`. So
everything here reports availability rather than throwing, and the route turns
that into one clear message instead of a 500.

## Structure

    <room: the org's "Documents" room>
      Document Toolbox/
        Uploads/            every file handed to a tool
        Results/
          Merge PDF/        what each tool produced, one folder per tool
          Compress PDF/
          ...

Results are grouped by the tool that produced them. A flat Results folder was
fine with a handful of files and unusable once a few dozen conversions had run
through it — "which of these came out of the compressor" is the question you
actually arrive with, and a filename does not answer it.

The app owns exactly one folder inside a shared room and never writes outside
it, so a room used by several apps stays legible.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# The room the app writes into. `ensure_room` is idempotent, so the first run
# creates it and every later run finds it.
ROOM_NAME = "Documents"
ROOM_DESCRIPTION = "Shared documents for this organization."

# One folder per app, then one per direction. Names chosen to be readable by
# someone who opens the room without knowing this app exists.
APP_FOLDER = "Document Toolbox"
UPLOADS_FOLDER = "Uploads"
RESULTS_FOLDER = "Results"

# Tool titles become folder names. Only one of the 31 needs help — "PDF to
# PDF/A" — but a slash inside a path segment is ambiguous at best, so every
# title is passed through this rather than special-casing the one.
_UNSAFE_IN_NAME = str.maketrans({c: "-" for c in '/\\:*?"<>|'})


def folder_name_for_tool(title: str) -> str:
    """The Results sub-folder a tool's output belongs in."""
    return (title or "").translate(_UNSAFE_IN_NAME).strip() or "Other"


UNAVAILABLE_DETAIL = (
    "The Data Room isn't available in this runtime. It is provided by Palette OS, "
    "so it works on the platform (and in `pltt dev --sandbox`) but not in the "
    "plain local simulator."
)


class DataRoomUnavailable(RuntimeError):
    """The platform did not inject the service — not a bug, just this runtime."""


def _client(ctx: Any) -> Any:
    client = getattr(ctx, "data_rooms", None)
    if client is None:
        raise DataRoomUnavailable(UNAVAILABLE_DETAIL)
    return client


def available(ctx: Any) -> bool:
    """Whether this runtime can reach the Data Room at all.

    `DataRoomsClient` is always present on the context; what may be missing is
    the *service* inside it, which it only reveals by raising. Probing the
    private attribute is deliberate: the alternative is issuing a network call
    just to find out whether the feature exists, on every page load.
    """
    client = getattr(ctx, "data_rooms", None)
    if client is None:
        return False
    return getattr(client, "_service", None) is not None


async def folders(ctx: Any) -> dict[str, Any]:
    """The app's `Uploads` and `Results` folder ids, creating them if needed.

    Idempotent: `ensure_room` and `resolve_folder_path(create=True)` both return
    the existing entry when there is one, so this is safe to call per request.
    """
    client = _client(ctx)
    room = await client.ensure_room(ROOM_NAME, ROOM_DESCRIPTION)
    room_id = int(room["id"])
    uploads = await client.resolve_folder_path(room_id, [APP_FOLDER, UPLOADS_FOLDER], create=True)
    results = await client.resolve_folder_path(room_id, [APP_FOLDER, RESULTS_FOLDER], create=True)
    if uploads is None or results is None:
        # `create=True` should make this impossible; if the platform ever
        # returns None anyway, say so rather than writing to the room root.
        raise DataRoomUnavailable("Could not create the app's Data Room folders.")
    return {
        "room": room,
        "room_id": room_id,
        "uploads_folder_id": int(uploads["id"]),
        "results_folder_id": int(results["id"]),
    }


async def contents(ctx: Any) -> dict[str, Any]:
    """Both folders and their files, for the Data Room page.

    `results.folders` is one entry per tool that has produced something.
    `results.files` is anything sitting loose in Results — results written
    before this app grouped them, which would otherwise become invisible.
    """
    ids = await folders(ctx)
    client = _client(ctx)
    uploads = await client.contents(ids["room_id"], ids["uploads_folder_id"])
    results = await client.contents(ids["room_id"], ids["results_folder_id"])

    tool_folders = []
    for entry in results.get("folders") or []:
        listing = await client.contents(ids["room_id"], int(entry["id"]))
        tool_folders.append(
            {
                "id": int(entry["id"]),
                "name": entry.get("name") or "",
                "files": listing.get("files") or [],
            }
        )
    tool_folders.sort(key=lambda f: f["name"].lower())

    return {
        "room": {"id": ids["room_id"], "name": ids["room"].get("name", ROOM_NAME)},
        "app_folder": APP_FOLDER,
        "uploads": {"name": UPLOADS_FOLDER, "files": uploads.get("files") or []},
        "results": {
            "name": RESULTS_FOLDER,
            "files": results.get("files") or [],
            "folders": tool_folders,
        },
    }


async def _save(ctx: Any, folder_key: str, filename: str, content: bytes, content_type: str | None) -> Any:
    ids = await folders(ctx)
    return await _client(ctx).upload_file(
        ids["room_id"],
        filename,
        content,
        folder_id=ids[folder_key],
        content_type=content_type,
    )


async def save_upload(ctx: Any, filename: str, content: bytes, content_type: str | None = None) -> Any:
    return await _save(ctx, "uploads_folder_id", filename, content, content_type)


async def save_result(
    ctx: Any,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    tool: str | None = None,
) -> Any:
    """Store an output under `Results/<tool>/`.

    `tool` is the tool's display title, because the folder is read by a person
    browsing the room, not by this code. Without one the file lands directly in
    Results — the caller does not know which tool made it, and losing the file
    would be worse than filing it loosely.
    """
    if tool is None:
        return await _save(ctx, "results_folder_id", filename, content, content_type)
    client = _client(ctx)
    ids = await folders(ctx)
    folder = await client.resolve_folder_path(
        ids["room_id"], [APP_FOLDER, RESULTS_FOLDER, folder_name_for_tool(tool)], create=True
    )
    if folder is None:
        return await _save(ctx, "results_folder_id", filename, content, content_type)
    return await client.upload_file(
        ids["room_id"], filename, content, folder_id=int(folder["id"]), content_type=content_type
    )


async def read_file(ctx: Any, file_id: int) -> tuple[str, bytes]:
    """A Data Room file's name and bytes, so a tool can run on it directly.

    The filename matters as much as the bytes: every tool validates by
    extension (`core/files.save_upload`), so a file fetched without its name
    would be rejected by the very tool the user picked it for.
    """
    client = _client(ctx)
    listing = await contents(ctx)
    # Every pool the app owns: Uploads, anything loose in Results, and each
    # per-tool Results folder. Walking `contents()` rather than re-querying the
    # two top folders is what keeps a generated file usable as an input — it
    # now lives one level deeper, and the old two-folder scan could not see it.
    pools: list[list[dict[str, Any]]] = [
        listing["uploads"]["files"],
        listing["results"]["files"],
        *(f["files"] for f in listing["results"]["folders"]),
    ]
    name: str | None = None
    for files in pools:
        for entry in files:
            if int(entry.get("id", -1)) == int(file_id):
                name = entry.get("original_filename")
                break
        if name:
            break
    if name is None:
        # Deliberately scoped to this app's own two folders: a file id from
        # elsewhere in a shared room is not something this app should read on
        # the user's behalf without them choosing it here.
        raise LookupError(f"No file {file_id} in {APP_FOLDER}.")
    return name, await client.read_file_bytes(int(file_id))


async def try_save_upload(ctx: Any, filename: str, content: bytes, content_type: str | None = None) -> None:
    """Save an input, but never fail the conversion because of it.

    Archiving is a side effect of a job the user asked for. If the Data Room is
    unavailable or rejects the write, the conversion they are waiting on still
    has to complete — so this logs and moves on.
    """
    try:
        if available(ctx):
            await save_upload(ctx, filename, content, content_type)
    except Exception:  # noqa: BLE001 — see the docstring
        logger.warning("Data Room: could not archive input %s", filename, exc_info=True)


async def try_save_result(
    ctx: Any,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    tool: str | None = None,
) -> None:
    try:
        if available(ctx):
            await save_result(ctx, filename, content, content_type, tool=tool)
    except Exception:  # noqa: BLE001
        logger.warning("Data Room: could not archive result %s", filename, exc_info=True)
