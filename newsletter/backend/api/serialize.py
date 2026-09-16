"""Serialize ORM objects into the exact camelCase shapes the frontend expects
(unchanged from the source app's fixtures, so the UI is unchanged).

Image/logo URLs are now always the absolute URL storage.save_media returned
(platform storage or the local-GCS fallback) rather than a relative
backend-proxied path — there is no byte-streaming proxy route for mascot
images or the brand logo anymore, since ctx.storage never returns anything
callers could re-serve locally by key (see storage.py)."""

from __future__ import annotations

from newsletter_backend.api.models import Brand, BrandTheme, Document, Mascot, Newsletter, NewsletterBlock


def brand_to_dict(b: Brand) -> dict:
    return {
        "id": b.id,
        "name": b.name,
        "logoUrl": b.logo_url,
    }


def brand_theme_to_dict(t: BrandTheme) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "palette": t.palette or {},
        "typography": t.typography or {},
        "headers": t.headers or [],
        "footers": t.footers or [],
        "isDefault": bool(t.is_default),
        "createdAt": t.created_at.isoformat() if t.created_at else None,
        "updatedAt": t.updated_at.isoformat() if t.updated_at else None,
    }


def mascot_to_dict(m: Mascot) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "imageUrl": m.storage_url,
        "createdAt": m.created_at.isoformat() if m.created_at else None,
    }


def doc_to_dict(d: Document) -> dict:
    return {
        "id": d.id,
        "filename": d.filename,
        "mime": d.mime,
        "sizeBytes": d.size_bytes,
        "status": d.status,
        "error": d.error,
        "summary": d.summary,
        "facts": d.facts or {},
        "pageCount": d.page_count,
        "chunkCount": d.chunk_count,
        "createdAt": d.created_at.isoformat() if d.created_at else None,
        # The original upload, for "open original" in the document viewer. Only
        # emitted when the browser can actually follow it: `pltt dev`'s local
        # storage tier hands back a `file://` URI (see storage.save_media), and
        # a link to that is a dead link, not a feature.
        "fileUrl": d.storage_url if (d.storage_url or "").startswith("http") else None,
    }


def block_to_dict(b: NewsletterBlock) -> dict:
    return {
        "id": b.id,
        "order": b.order_index,
        "layout": b.layout_key,
        "title": b.title,
        "summary": b.summary,
        "content": b.content,
        "imageDesc": b.image_desc,
        "images": b.images or [],
        "citations": b.citations or [],
        "continuationOf": b.continuation_of,
        "forcePageBreak": bool(b.force_page_break),
        "keepNext": bool(b.keep_next),
    }


def nl_to_dict(nl: Newsletter) -> dict:
    return {
        "id": nl.id,
        "title": nl.title,
        "status": nl.status,
        "language": nl.language,
        "focusPrompt": nl.focus_prompt,
        "brandThemeId": nl.brand_theme_id,
        "themeSnapshot": nl.theme_snapshot or {},
        "layout": nl.layout or {},
        "sourceDocumentIds": list(nl.source_document_ids or []),
        "overlays": nl.overlays or [],
        "blocks": [block_to_dict(b) for b in sorted(nl.blocks, key=lambda x: x.order_index)],
        "createdAt": nl.created_at.isoformat() if nl.created_at else None,
        "updatedAt": nl.updated_at.isoformat() if nl.updated_at else None,
    }
