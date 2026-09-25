"use client";

import { useState } from "react";
import { Check, Eye, FileText, Trash2 } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { Badge } from "../ui/primitives";
import { ConfirmModal } from "../ui/confirm-modal";
import { deleteDocument } from "../../lib/api-client";
import { cn } from "../../lib/cn";
import { bytes, fileKind, shortDate, statusTone, useLocale } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { SourceDocument } from "../../lib/types";

export function DocumentCard({
  doc,
  onDeleted,
  onOpen,
  selected,
  onToggleSelect,
}: {
  doc: SourceDocument;
  onDeleted: (id: string) => void;
  /** Open the document viewer. */
  onOpen: (doc: SourceDocument) => void;
  /** Selection state for "create a newsletter from these files". Only offered
   *  for documents that finished processing — an unembedded document has
   *  nothing for retrieval to draw on, so letting it be picked would promise
   *  something generation cannot deliver. */
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const locale = useLocale();
  const busy = doc.status === "parsing" || doc.status === "embedding";
  const selectable = !!onToggleSelect && doc.status === "ready";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(false);
    try {
      await deleteDocument(apiFetch, doc.id);
      onDeleted(doc.id);
    } catch {
      setDeleting(false);
      setDeleteError(true);
    }
  }

  return (
    // Not the `Card` primitive: these tiles now sit INSIDE the Documents panel,
    // which is itself a Card, and a card's `bg-surface` + `shadow-sm` repeated
    // one level down gives a tile the same fill as its container plus a shadow
    // it has nothing to lift off. Recessed fill and a border do the separating
    // instead, and hover firms the border rather than adding elevation.
    //
    // Spelled out rather than passed to `<Card>` as overrides because `cn` is a
    // plain class join with no tailwind-merge, so `bg-surface-2` would not
    // reliably beat the primitive's own `bg-surface` (same reason the export
    // menu in editor-top-bar.tsx hand-rolls its trigger). Radius, border and
    // padding are kept identical to the primitive.
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface-2 p-4 transition-colors duration-150",
        selected
          ? "border-brand-500 ring-1 ring-brand-500"
          : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {selectable ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={!!selected}
              onClick={() => onToggleSelect?.(doc.id)}
              title={selected ? t("docCard.deselect") : t("docCard.select")}
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                selected
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-border-strong bg-surface hover:border-brand-500",
              )}
            >
              {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
              <span className="sr-only">
                {selected ? t("docCard.deselect") : t("docCard.select")}
              </span>
            </button>
          ) : null}
          {/* `bg-surface`, not `bg-surface-2`: the tile itself is the recessed
              surface, so the chip has to go the other way to stay visible. */}
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-[11px] font-semibold tracking-wide text-fg-muted">
            <FileText className="size-3.5" strokeWidth={2.25} />
            {t(`fileKind.${fileKind(doc.mime)}`)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone={statusTone(doc.status)}>
            {busy ? `${t(`docCard.status.${doc.status}`)}…` : t(`docCard.status.${doc.status}`)}
          </Badge>
          <button
            type="button"
            onClick={() => onOpen(doc)}
            title={t("docCard.view")}
            className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <Eye className="size-3.5" strokeWidth={2} />
            <span className="sr-only">{t("docCard.view")}</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting}
            title={t("docCard.delete")}
            className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-rose-100 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 dark:hover:bg-rose-400/15 dark:hover:text-rose-400"
          >
            <Trash2 className="size-3.5" strokeWidth={2} />
            <span className="sr-only">{t("docCard.delete")}</span>
          </button>
        </div>
      </div>

      <div>
        {/* The filename is the thing people click to open a file, so it is the
            button — not the whole tile. A tile-wide click target would swallow
            the checkbox and the two icon buttons sitting inside it. */}
        <h3 className="truncate text-sm font-semibold">
          <button
            type="button"
            onClick={() => onOpen(doc)}
            title={doc.filename}
            className="block max-w-full truncate rounded text-left text-fg transition-colors hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:hover:text-brand-300"
          >
            {doc.filename}
          </button>
        </h3>
        {doc.status === "error" ? (
          <p
            className="mt-1 line-clamp-3 text-sm text-rose-600 dark:text-rose-400"
            title={doc.error || undefined}
          >
            {doc.error || t("docCard.status.error")}
          </p>
        ) : (
          <p className="mt-1 line-clamp-3 text-sm text-fg-muted">{doc.summary}</p>
        )}
      </div>

      {doc.facts?.topic ? (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="indigo">{doc.facts.topic}</Badge>
          {doc.facts.orgs?.slice(0, 2).map((o) => (
            <Badge key={o}>{o}</Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-xs text-fg-subtle">
        <span>
          {doc.status === "ready"
            ? t("docCard.chunksAndPages", { chunks: doc.chunkCount, pages: doc.pageCount })
            : t("docCard.pagesOnly", { pages: doc.pageCount })}
        </span>
        <span>
          {bytes(doc.sizeBytes)} · {shortDate(doc.createdAt, locale)}
        </span>
      </div>

      {deleteError ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">{t("docCard.deleteFailed")}</p>
      ) : null}

      {confirmOpen ? (
        <ConfirmModal
          title={t("docCard.deleteTitle")}
          message={t("docCard.deleteMessage", { name: doc.filename })}
          confirmLabel={t("docCard.deleteConfirm")}
          onConfirm={handleDelete}
          onClose={() => setConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}
