"""Initial newsletter plugin schema.

Collapses the source app's 6 incremental migrations (initial schema -> mascots
and overlays -> block pagination fields -> block images -> brand settings ->
brand themes + backfill) into one schema, since this plugin has no existing
installs to migrate forward — the intermediate/superseded shapes (a
pre-BrandTheme `brand.themes` JSONB blob, later replaced by a real
`brand_theme` table; a `document_chunk.embedding` pgvector column, replaced by
the managed ctx.vector service since plugin schemas can't add Postgres
extensions) would only add dead schema history with nothing to backfill from.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from palette_sdk.db import ensure_org_rls

revision = "001_init"
down_revision = None

JSONType = sa.JSON().with_variant(JSONB(), "postgresql")


def _org_col():
    return sa.Column("organization_id", sa.BigInteger(), nullable=False)


def _org_table(table_name: str, *columns: sa.Column) -> None:
    # ensure_org_rls (palette_sdk.db) is the app-owned helper for RLS: it
    # enables + forces RLS and installs the org-isolation policy scoped to
    # this plugin's own schema — no hand-rolled policy SQL here.
    op.create_table(table_name, sa.Column("id", sa.String(), primary_key=True), _org_col(), *columns)
    op.create_index(f"ix_{table_name}_org", table_name, ["organization_id"])
    ensure_org_rls(op, table_name)


def upgrade() -> None:
    _org_table(
        "newsletter__brand",
        sa.Column("name", sa.String(), server_default="Brand", nullable=False),
        sa.Column("logo_url", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    _org_table(
        "newsletter__brand_theme",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("palette", JSONType, nullable=True),
        sa.Column("typography", JSONType, nullable=True),
        sa.Column("headers", JSONType, nullable=True),
        sa.Column("footers", JSONType, nullable=True),
        sa.Column("is_default", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    _org_table(
        "newsletter__mascot",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("storage_url", sa.String(), nullable=False),
        sa.Column("mime", sa.String(), server_default="image/png", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    _org_table(
        "newsletter__media_job",
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    _org_table(
        "newsletter__document",
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("mime", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("storage_url", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="uploaded", nullable=False),
        sa.Column("summary", sa.Text(), server_default="", nullable=False),
        sa.Column("facts", JSONType, nullable=True),
        sa.Column("page_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("chunk_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    _org_table(
        "newsletter__document_chunk",
        sa.Column(
            "document_id", sa.String(), sa.ForeignKey("newsletter__document.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("embedded", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index(
        "ix_newsletter__document_chunk_document", "newsletter__document_chunk", ["document_id"]
    )

    _org_table(
        "newsletter__newsletter",
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="draft", nullable=False),
        sa.Column("language", sa.String(), server_default="en", nullable=False),
        sa.Column("focus_prompt", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "brand_theme_id",
            sa.String(),
            sa.ForeignKey("newsletter__brand_theme.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("theme_snapshot", JSONType, nullable=True),
        sa.Column("layout", JSONType, nullable=True),
        sa.Column("source_document_ids", ARRAY(sa.String()), nullable=True),
        sa.Column("overlays", JSONType, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    _org_table(
        "newsletter__newsletter_block",
        sa.Column(
            "newsletter_id",
            sa.String(),
            sa.ForeignKey("newsletter__newsletter.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("order_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("layout_key", sa.String(), server_default="single_column", nullable=False),
        sa.Column("title", sa.String(), server_default="", nullable=False),
        sa.Column("summary", sa.Text(), server_default="", nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("image_desc", sa.Text(), server_default="", nullable=False),
        sa.Column("images", JSONType, nullable=True),
        sa.Column("citations", JSONType, nullable=True),
        sa.Column("continuation_of", sa.String(), nullable=True),
        sa.Column("force_page_break", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("keep_next", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index("ix_newsletter__newsletter_block_newsletter", "newsletter__newsletter_block", ["newsletter_id"])
    op.create_index(
        "ix_newsletter__newsletter_block_continuation_of", "newsletter__newsletter_block", ["continuation_of"]
    )


def downgrade() -> None:
    # Initial migration is intentionally non-destructive.
    pass
