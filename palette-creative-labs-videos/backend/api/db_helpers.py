"""Database helper functions for the Pltt Creative Video plugin.

Replaces pltt-agg's MongoDB `core/database.py` with org-scoped SQLAlchemy
queries that go through `ctx.db`. Each helper takes the PluginContext so
Palette can enforce RLS and org isolation.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from sqlalchemy import and_, delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from palette_sdk import PluginContext

from backend.api.models import (
    Asset,
    Item,
    KeyFrame,
    KeyFrameAsset,
    Project,
    Scene,
)

logger = logging.getLogger("pltt_creative_video.db")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


def _item_to_dict(item: Item) -> dict:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "project_id": item.project_id,
        "key_frame_id": item.key_frame_id,
        "scene_id": item.scene_id,
        "generation_id": item.generation_id,
        "type": item.type,
        "model_name": item.model_name,
        "prompt": item.prompt,
        "status": item.status,
        "url": item.url,
        "thumbnail_url": item.thumbnail_url,
        "all_generated_urls": item.all_generated_urls,
        "image_references": item.image_references,
        "gen_params": item.gen_params,
        "aspect_ratio": item.aspect_ratio,
        "resolution": item.resolution,
        "duration": item.duration,
        "error_message": item.error_message,
        "group": item.group,
        "is_favourite": item.is_favourite,
        "is_sample": item.is_sample,
        "midjourney_job_id": item.midjourney_job_id,
        "midjourney_action": item.midjourney_action,
        "source_doc_id": item.source_doc_id,
        "is_upscaled": item.is_upscaled,
        "upscaled_doc_id": item.upscaled_doc_id,
        "is_upscale_image": item.is_upscale_image,
        "url_before_upscale": item.url_before_upscale,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _project_to_dict(p: Project) -> dict:
    return {
        "id": p.id,
        "user_id": p.user_id,
        "type": p.type,
        "name": p.name,
        "client": p.client,
        "thumbnail": p.thumbnail,
        "status": p.status,
        "model_name": p.model_name,
        "prompt": p.prompt,
        "aspect_ratio": p.aspect_ratio,
        "resolution": p.resolution,
        "duration": p.duration,
        "video_refs": p.video_refs,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


def _key_frame_to_dict(kf: KeyFrame) -> dict:
    return {
        "id": kf.id,
        "project_id": kf.project_id,
        "key_frame_name": kf.key_frame_name,
        "key_frame_number": kf.key_frame_number,
        "prompt": kf.prompt,
        "video_refs": kf.video_refs,
        "created_at": kf.created_at,
        "updated_at": kf.updated_at,
    }


# ---------------------------------------------------------------------------
# Items (generated images/videos)
# ---------------------------------------------------------------------------

async def create_initial_item(
    db: AsyncSession,
    *,
    organization_id: int,
    user_id: str,
    type: str,
    model_name: str,
    prompt: str,
    params: dict,
    project_id: Optional[str] = None,
    key_frame_id: Optional[str] = None,
    scene_id: Optional[str] = None,
    generation_id: Optional[str] = None,
) -> dict:
    item = Item(
        id=_new_id(),
        organization_id=organization_id,
        user_id=user_id,
        project_id=project_id,
        key_frame_id=key_frame_id,
        scene_id=scene_id,
        generation_id=generation_id or _new_id(),
        type=type,
        model_name=model_name,
        prompt=prompt,
        status="in_progress",
        aspect_ratio=params.get("aspect_ratio"),
        resolution=params.get("resolution"),
        duration=params.get("duration"),
        image_references=params.get("image_references") or [],
        gen_params=dict(params) if params else {},
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _item_to_dict(item)


async def update_item_success(
    db: AsyncSession,
    item_id: str,
    *,
    url: str,
    all_generated_urls: Optional[list] = None,
) -> Optional[dict]:
    res = await db.execute(select(Item).where(Item.id == item_id))
    item = res.scalar_one_or_none()
    if not item:
        return None
    item.status = "completed"
    item.url = url
    item.all_generated_urls = all_generated_urls or [{"provider": item.model_name, "url": url}]
    item.updated_at = _now()
    await db.commit()
    await db.refresh(item)
    return _item_to_dict(item)


async def update_item_failed(db: AsyncSession, item_id: str, error: str) -> Optional[dict]:
    res = await db.execute(select(Item).where(Item.id == item_id))
    item = res.scalar_one_or_none()
    if not item:
        return None
    item.status = "failed"
    item.error_message = str(error)
    item.updated_at = _now()
    await db.commit()
    await db.refresh(item)
    return _item_to_dict(item)


async def set_item_fields(db: AsyncSession, item_id: str, fields: dict) -> Optional[dict]:
    res = await db.execute(select(Item).where(Item.id == item_id))
    item = res.scalar_one_or_none()
    if not item:
        return None
    for k, v in fields.items():
        if hasattr(item, k):
            setattr(item, k, v)
    item.updated_at = _now()
    await db.commit()
    await db.refresh(item)
    return _item_to_dict(item)


async def locate_item(db: AsyncSession, user_id: str, item_id: str) -> Optional[dict]:
    res = await db.execute(
        select(Item).where(and_(Item.id == item_id, Item.user_id == user_id))
    )
    item = res.scalar_one_or_none()
    return _item_to_dict(item) if item else None


async def get_items_by_project_id(db: AsyncSession, user_id: str, project_id: str) -> list[dict]:
    res = await db.execute(
        select(Item)
        .where(and_(Item.user_id == user_id, Item.project_id == project_id))
        .order_by(Item.created_at)
    )
    return [_item_to_dict(i) for i in res.scalars().all()]


async def delete_item(db: AsyncSession, user_id: str, item_id: str) -> bool:
    res = await db.execute(
        select(Item).where(and_(Item.id == item_id, Item.user_id == user_id))
    )
    item = res.scalar_one_or_none()
    if not item:
        return False
    project_id = item.project_id
    await db.delete(item)
    await db.commit()
    if project_id:
        await recompute_project_thumbnail(db, user_id, project_id)
    return True


async def find_existing_action_item(
    db: AsyncSession, user_id: str, source_doc_id: str, action: str
) -> Optional[dict]:
    res = await db.execute(
        select(Item).where(
            and_(
                Item.user_id == user_id,
                Item.source_doc_id == source_doc_id,
                Item.midjourney_action == action,
                Item.status == "completed",
            )
        )
    )
    item = res.scalar_one_or_none()
    return _item_to_dict(item) if item else None


# ---------------------------------------------------------------------------
# Projects + key frames
# ---------------------------------------------------------------------------

async def create_project(
    db: AsyncSession,
    organization_id: int,
    user_id: str,
    name: str,
    type: str,
    client: Optional[str] = None,
) -> Optional[dict]:
    if type != "video":
        return None
    p = Project(
        id=_new_id(),
        organization_id=organization_id,
        user_id=user_id,
        type=type,
        name=name,
        client=client,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _project_to_dict(p)


async def get_project(db: AsyncSession, user_id: str, project_id: str) -> Optional[dict]:
    res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    p = res.scalar_one_or_none()
    if not p:
        return None
    out = _project_to_dict(p)
    out["key_frames"] = await list_key_frames(db, project_id)
    return out


async def list_projects(db: AsyncSession, user_id: str) -> list[dict]:
    res = await db.execute(
        select(Project).where(Project.user_id == user_id).order_by(desc(Project.created_at))
    )
    projects = res.scalars().all()
    out: list[dict] = []
    for p in projects:
        d = _project_to_dict(p)
        d["key_frames"] = await list_key_frames(db, p.id)
        out.append(d)
    return out


async def delete_project(db: AsyncSession, user_id: str, project_id: str) -> bool:
    res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    p = res.scalar_one_or_none()
    if not p:
        return False
    # cascade deletes key_frames and key_frame_assets via FK; delete items by project_id
    await db.execute(delete(Item).where(and_(Item.project_id == project_id, Item.user_id == user_id)))
    await db.delete(p)
    await db.commit()
    return True


async def rename_project(
    db: AsyncSession, user_id: str, project_id: str, name: str
) -> Optional[dict]:
    res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    p = res.scalar_one_or_none()
    if not p:
        return None
    p.name = name
    p.updated_at = _now()
    await db.commit()
    await db.refresh(p)
    out = _project_to_dict(p)
    out["key_frames"] = await list_key_frames(db, project_id)
    return out


async def touch_project(db: AsyncSession, user_id: str, project_id: str) -> None:
    res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    p = res.scalar_one_or_none()
    if p:
        p.updated_at = _now()
        await db.commit()


async def update_project_thumbnail(
    db: AsyncSession, user_id: str, project_id: str, thumbnail_url: str
) -> None:
    if not thumbnail_url:
        return
    res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    p = res.scalar_one_or_none()
    if p:
        p.thumbnail = thumbnail_url
        p.updated_at = _now()
        await db.commit()


async def recompute_project_thumbnail(db: AsyncSession, user_id: str, project_id: str) -> None:
    res = await db.execute(
        select(Item)
        .where(
            and_(
                Item.user_id == user_id,
                Item.project_id == project_id,
                Item.status == "completed",
                Item.url.is_not(None),
            )
        )
        .order_by(desc(Item.updated_at))
        .limit(1)
    )
    latest = res.scalar_one_or_none()
    await update_project_thumbnail(db, user_id, project_id, latest.url if latest else None)


# ---------------------------------------------------------------------------
# Key frames
# ---------------------------------------------------------------------------

async def list_key_frames(db: AsyncSession, project_id: str) -> list[dict]:
    res = await db.execute(
        select(KeyFrame)
        .where(KeyFrame.project_id == project_id)
        .order_by(KeyFrame.key_frame_number)
    )
    out: list[dict] = []
    for kf in res.scalars().all():
        d = _key_frame_to_dict(kf)
        d["assets"] = await list_key_frame_assets(db, kf.id)
        d["scenes"] = await list_scenes(db, kf.id)
        items_res = await db.execute(
            select(Item).where(Item.key_frame_id == kf.id).order_by(Item.created_at)
        )
        d["items"] = [_item_to_dict(i) for i in items_res.scalars().all()]
        out.append(d)
    return out


async def create_key_frame(
    db: AsyncSession, organization_id: int, user_id: str, project_id: str
) -> Optional[dict]:
    proj_res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    if not proj_res.scalar_one_or_none():
        return None
    count_res = await db.execute(
        select(func.count(KeyFrame.id)).where(KeyFrame.project_id == project_id)
    )
    n = (count_res.scalar() or 0) + 1
    kf = KeyFrame(
        id=_new_id(),
        organization_id=organization_id,
        project_id=project_id,
        key_frame_name=f"key frame {n:02d}",
        key_frame_number=n,
    )
    db.add(kf)
    await db.commit()
    await db.refresh(kf)
    return _key_frame_to_dict(kf)


async def get_key_frame(
    db: AsyncSession, user_id: str, project_id: str, key_frame_id: str
) -> Optional[dict]:
    res = await db.execute(
        select(KeyFrame).where(
            and_(KeyFrame.id == key_frame_id, KeyFrame.project_id == project_id)
        )
    )
    kf = res.scalar_one_or_none()
    if not kf:
        return None
    proj_res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    if not proj_res.scalar_one_or_none():
        return None
    d = _key_frame_to_dict(kf)
    d["assets"] = await list_key_frame_assets(db, kf.id)
    return d


async def set_key_frame_prompt(
    db: AsyncSession, user_id: str, project_id: str, key_frame_id: str, prompt: str
) -> Optional[dict]:
    res = await db.execute(
        select(KeyFrame).where(
            and_(KeyFrame.id == key_frame_id, KeyFrame.project_id == project_id)
        )
    )
    kf = res.scalar_one_or_none()
    if not kf:
        return None
    kf.prompt = prompt
    kf.updated_at = _now()
    await db.commit()
    await db.refresh(kf)
    return _key_frame_to_dict(kf)


async def set_project_video_refs(
    db: AsyncSession, user_id: str, project_id: str, video_refs: Optional[dict]
) -> Optional[dict]:
    res = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == user_id))
    )
    p = res.scalar_one_or_none()
    if not p:
        return None
    p.video_refs = video_refs
    p.updated_at = _now()
    await db.commit()
    await db.refresh(p)
    return _project_to_dict(p)


async def set_key_frame_video_refs(
    db: AsyncSession, user_id: str, project_id: str, key_frame_id: str, video_refs: Optional[dict]
) -> Optional[dict]:
    res = await db.execute(
        select(KeyFrame).where(
            and_(KeyFrame.id == key_frame_id, KeyFrame.project_id == project_id)
        )
    )
    kf = res.scalar_one_or_none()
    if not kf:
        return None
    kf.video_refs = video_refs
    kf.updated_at = _now()
    await db.commit()
    await db.refresh(kf)
    return _key_frame_to_dict(kf)


async def rename_key_frame(
    db: AsyncSession, user_id: str, project_id: str, key_frame_id: str, name: str
) -> Optional[dict]:
    res = await db.execute(
        select(KeyFrame).where(
            and_(KeyFrame.id == key_frame_id, KeyFrame.project_id == project_id)
        )
    )
    kf = res.scalar_one_or_none()
    if not kf:
        return None
    kf.key_frame_name = name
    kf.updated_at = _now()
    await db.commit()
    await db.refresh(kf)
    return _key_frame_to_dict(kf)


async def delete_key_frame(
    db: AsyncSession, user_id: str, project_id: str, key_frame_id: str
) -> bool:
    res = await db.execute(
        select(KeyFrame).where(
            and_(KeyFrame.id == key_frame_id, KeyFrame.project_id == project_id)
        )
    )
    kf = res.scalar_one_or_none()
    if not kf:
        return False
    await db.delete(kf)
    await db.commit()
    await recompute_project_thumbnail(db, user_id, project_id)
    return True


async def reorder_key_frames(
    db: AsyncSession,
    user_id: str,
    project_id: str,
    key_frame_id: str,
    new_key_frame_number: int,
) -> Optional[list[dict]]:
    res = await db.execute(
        select(KeyFrame).where(KeyFrame.project_id == project_id).order_by(KeyFrame.key_frame_number)
    )
    kfs = list(res.scalars().all())
    target = next((k for k in kfs if k.id == key_frame_id), None)
    if not target or new_key_frame_number < 1 or new_key_frame_number > len(kfs):
        return None
    current = target.key_frame_number
    if current == new_key_frame_number:
        return [{"id": k.id, "key_frame_name": k.key_frame_name, "key_frame_number": k.key_frame_number} for k in kfs]
    for k in kfs:
        if k.id == key_frame_id:
            continue
        n = k.key_frame_number
        if new_key_frame_number < current and new_key_frame_number <= n < current:
            k.key_frame_number = n + 1
        elif new_key_frame_number > current and current < n <= new_key_frame_number:
            k.key_frame_number = n - 1
    target.key_frame_number = new_key_frame_number
    await db.commit()
    kfs.sort(key=lambda x: x.key_frame_number)
    return [
        {"id": k.id, "key_frame_name": k.key_frame_name, "key_frame_number": k.key_frame_number}
        for k in kfs
    ]


# ---------------------------------------------------------------------------
# Scenes (video-generation groups inside a key frame)
# ---------------------------------------------------------------------------

def _scene_to_dict(s: Scene) -> dict:
    return {
        "id": s.id,
        "key_frame_id": s.key_frame_id,
        "scene_name": s.scene_name,
        "scene_number": s.scene_number,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


async def list_scenes(db: AsyncSession, key_frame_id: str) -> list[dict]:
    res = await db.execute(
        select(Scene)
        .where(Scene.key_frame_id == key_frame_id)
        .order_by(Scene.scene_number)
    )
    return [_scene_to_dict(s) for s in res.scalars().all()]


async def create_scene(
    db: AsyncSession,
    organization_id: int,
    user_id: str,
    project_id: str,
    key_frame_id: str,
) -> Optional[dict]:
    if not await get_key_frame(db, user_id, project_id, key_frame_id):
        return None
    count_res = await db.execute(
        select(func.count(Scene.id)).where(Scene.key_frame_id == key_frame_id)
    )
    n = (count_res.scalar() or 0) + 1
    scene = Scene(
        id=_new_id(),
        organization_id=organization_id,
        key_frame_id=key_frame_id,
        scene_name=f"Scene {n}",
        scene_number=n,
    )
    db.add(scene)
    await db.commit()
    await db.refresh(scene)
    return _scene_to_dict(scene)


async def delete_scene(
    db: AsyncSession,
    user_id: str,
    project_id: str,
    key_frame_id: str,
    scene_id: str,
) -> bool:
    if not await get_key_frame(db, user_id, project_id, key_frame_id):
        return False
    res = await db.execute(
        select(Scene).where(
            and_(Scene.id == scene_id, Scene.key_frame_id == key_frame_id)
        )
    )
    scene = res.scalar_one_or_none()
    if not scene:
        return False
    await db.delete(scene)
    await db.commit()
    return True


async def rename_scene(
    db: AsyncSession,
    user_id: str,
    project_id: str,
    key_frame_id: str,
    scene_id: str,
    name: str,
) -> Optional[dict]:
    if not await get_key_frame(db, user_id, project_id, key_frame_id):
        return None
    res = await db.execute(
        select(Scene).where(
            and_(Scene.id == scene_id, Scene.key_frame_id == key_frame_id)
        )
    )
    scene = res.scalar_one_or_none()
    if not scene:
        return None
    scene.scene_name = name
    scene.updated_at = _now()
    await db.commit()
    await db.refresh(scene)
    return _scene_to_dict(scene)


# ---------------------------------------------------------------------------
# Key-frame assets
# ---------------------------------------------------------------------------

async def list_key_frame_assets(db: AsyncSession, key_frame_id: str) -> list[dict]:
    res = await db.execute(
        select(KeyFrameAsset)
        .where(KeyFrameAsset.key_frame_id == key_frame_id)
        .order_by(KeyFrameAsset.created_at)
    )
    return [
        {"id": a.id, "url": a.url, "created_at": a.created_at}
        for a in res.scalars().all()
    ]


async def add_assets_to_key_frame(
    db: AsyncSession, organization_id: int, key_frame_id: str, urls: list[str]
) -> list[dict]:
    if not urls:
        return await list_key_frame_assets(db, key_frame_id)
    existing = {a["url"] for a in await list_key_frame_assets(db, key_frame_id)}
    for u in urls:
        if u and u not in existing:
            db.add(
                KeyFrameAsset(
                    id=_new_id(),
                    organization_id=organization_id,
                    key_frame_id=key_frame_id,
                    url=u,
                )
            )
    await db.commit()
    return await list_key_frame_assets(db, key_frame_id)


async def remove_asset_from_key_frame(db: AsyncSession, key_frame_id: str, asset_id: str) -> bool:
    res = await db.execute(
        select(KeyFrameAsset).where(
            and_(
                KeyFrameAsset.key_frame_id == key_frame_id,
                (KeyFrameAsset.id == asset_id) | (KeyFrameAsset.url == asset_id),
            )
        )
    )
    a = res.scalar_one_or_none()
    if not a:
        return False
    await db.delete(a)
    await db.commit()
    return True


# ---------------------------------------------------------------------------
# Reference assets
# ---------------------------------------------------------------------------

async def find_asset_by_hash(
    db: AsyncSession, user_id: str, content_hash: str
) -> Optional[dict]:
    if not content_hash:
        return None
    res = await db.execute(
        select(Asset).where(and_(Asset.user_id == user_id, Asset.content_hash == content_hash))
    )
    a = res.scalar_one_or_none()
    if not a:
        return None
    return {"id": a.id, "url": a.url, "content_hash": a.content_hash}


async def upsert_reference_asset(
    db: AsyncSession,
    organization_id: int,
    user_id: str,
    url: str,
    content_hash: str,
) -> dict:
    existing = await find_asset_by_hash(db, user_id, content_hash)
    if existing:
        return existing
    a = Asset(
        id=_new_id(),
        organization_id=organization_id,
        user_id=user_id,
        url=url,
        content_hash=content_hash,
        type="reference_image",
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return {"id": a.id, "url": a.url, "content_hash": a.content_hash}


async def save_assets(
    db: AsyncSession, organization_id: int, user_id: str, urls: list[str]
) -> None:
    if not urls:
        return
    existing_res = await db.execute(
        select(Asset.url).where(and_(Asset.user_id == user_id, Asset.url.in_(urls)))
    )
    existing = {row[0] for row in existing_res.all()}
    for u in urls:
        if u and u not in existing:
            db.add(
                Asset(
                    id=_new_id(),
                    organization_id=organization_id,
                    user_id=user_id,
                    url=u,
                    type="reference_image",
                )
            )
    await db.commit()


async def get_user_assets(db: AsyncSession, user_id: str) -> list[dict]:
    res = await db.execute(
        select(Asset).where(Asset.user_id == user_id).order_by(desc(Asset.created_at))
    )
    return [
        {
            "id": a.id,
            "user_id": a.user_id,
            "url": a.url,
            "type": a.type,
            "created_at": a.created_at,
            "updated_at": a.updated_at,
        }
        for a in res.scalars().all()
    ]


async def delete_asset(db: AsyncSession, user_id: str, asset_id: str) -> bool:
    res = await db.execute(
        select(Asset).where(and_(Asset.id == asset_id, Asset.user_id == user_id))
    )
    a = res.scalar_one_or_none()
    if not a:
        return False
    await db.delete(a)
    await db.commit()
    return True


# ---------------------------------------------------------------------------
# Favourites (flags on items)
# ---------------------------------------------------------------------------

async def get_user_favourites(
    db: AsyncSession,
    user_id: str,
    group: Optional[str] = None,
    group_is_null: bool = False,
    model_name: Optional[str] = None,
) -> list[dict]:
    stmt = select(Item).where(
        and_(Item.user_id == user_id, Item.is_favourite.is_(True), Item.type == "video")
    )
    if group_is_null:
        stmt = stmt.where(Item.group.is_(None))
    elif group is not None:
        stmt = stmt.where(Item.group == group)
    if model_name is not None:
        stmt = stmt.where(Item.model_name == model_name)
    stmt = stmt.order_by(desc(Item.updated_at))
    res = await db.execute(stmt)
    out: list[dict] = []
    for item in res.scalars().all():
        d = _item_to_dict(item)
        if item.project_id:
            proj_res = await db.execute(select(Project.name).where(Project.id == item.project_id))
            d["name"] = proj_res.scalar()
        else:
            d["name"] = None
        if item.key_frame_id:
            kf_res = await db.execute(
                select(KeyFrame.key_frame_name).where(KeyFrame.id == item.key_frame_id)
            )
            d["key_frame_name"] = kf_res.scalar()
        else:
            d["key_frame_name"] = None
        out.append(d)
    return out
