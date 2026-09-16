"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, X } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { Badge, Button, Spinner } from "../ui/primitives";
import { DocumentPageSheet } from "./document-page";
import { getDocumentChunks, getDocumentPreview } from "../../lib/api-client";
import { bytes, fileKind, shortDate, statusTone } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import type { DocumentChunk, DocumentPreview, SourceDocument } from "../../lib/types";

/**
 * Opens a document from the dataroom.
 *
 * Two views, because they answer different questions.
 *
 * PAGES is the default and is the document itself — each page rendered
 * server-side by PyMuPDF at its true size, so text, images, vectors and
 * columns sit exactly where they do in the original. Formats PyMuPDF cannot
 * open (DOCX, PPTX, Markdown, plain text) have no pages to show, and for those
 * the viewer opens on Text instead.
 *
 * TEXT is what the dataroom actually indexed and what generation will draw on
 * — worth being able to check, and not the same thing as what the page looks
 * like. The chunks are listed separately rather than joined, because
 * consecutive chunks overlap by design (chunk.py); stitching them would repeat
 * a slice of text at every seam.
 *
 * "Open original" links out to the uploaded file when storage gave us a URL a
 * browser can follow.
 */
export function DocumentViewer({
  doc,
  onClose,
}: {
  doc: SourceDocument;
  onClose: () => void;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  // Null until the preview answers: which tab to open on depends on whether
  // this document HAS pages, and guessing would flip the view under the reader.
  const [tab, setTab] = useState<"pages" | "text" | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    getDocumentPreview(apiFetch, doc.id)
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setTab(p.kind === "pages" && p.pages.length > 0 ? "pages" : "text");
      })
      .catch(() => {
        // No preview is not an error the reader needs to see — the text view is
        // still there, so fall back to it.
        if (!live) return;
        setPreview({ kind: "text", pages: [] });
        setTab("text");
      });
    return () => {
      live = false;
    };
  }, [apiFetch, doc.id]);

  useEffect(() => {
    let live = true;
    getDocumentChunks(apiFetch, doc.id)
      .then((c) => live && setChunks(c))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [apiFetch, doc.id]);

  const hasPages = preview?.kind === "pages" && preview.pages.length > 0;

  // Modal keyboard contract, the same one the nav drawer uses: Escape closes,
  // Tab stays inside, focus returns to whatever opened it.
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button,a")?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      restoreTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={doc.filename}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border p-5">
          <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11px] font-semibold tracking-wide text-fg-muted">
            <FileText className="size-3.5" strokeWidth={2.25} />
            {t(`fileKind.${fileKind(doc.mime)}`)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-fg" title={doc.filename}>
              {doc.filename}
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">
              {doc.pageCount > 0
                ? t("docViewer.meta", {
                    chunks: doc.chunkCount,
                    pages: doc.pageCount,
                    size: bytes(doc.sizeBytes),
                    date: shortDate(doc.createdAt),
                  })
                : t("docViewer.metaNoPages", {
                    chunks: doc.chunkCount,
                    size: bytes(doc.sizeBytes),
                    date: shortDate(doc.createdAt),
                  })}
            </p>
          </div>
          {/* Only offered when there is a choice — a DOCX has no pages to
              switch to, and a dead tab is worse than no tab. */}
          {hasPages ? (
            <div className="flex shrink-0 items-center rounded-lg bg-surface-2 p-0.5">
              {(["pages", "text"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  aria-pressed={tab === k}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                    tab === k
                      ? "bg-surface text-fg shadow-sm"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  {t(k === "pages" ? "docViewer.tabPages" : "docViewer.tabText")}
                </button>
              ))}
            </div>
          ) : null}
          <Badge tone={statusTone(doc.status)}>{t(`docCard.status.${doc.status}`)}</Badge>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("docViewer.close")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-surface-2 p-5">
          {tab === null ? (
            <div className="flex min-h-60 items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : tab === "pages" ? (
            /* The document itself. One sheet per page, at the page's real
               aspect ratio, centred in a column narrow enough to keep a portrait
               page fully visible without scrolling sideways. */
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
              {preview!.pages.map((pg) => (
                <DocumentPageSheet key={pg.index} docId={doc.id} page={pg} scrollRoot={bodyRef} />
              ))}
            </div>
          ) : (
            <TextView doc={doc} chunks={chunks} failed={failed} hasPages={hasPages} />
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-4">
          {doc.fileUrl ? (
            <a
              href={doc.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-fg transition-all duration-150 hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              <ExternalLink className="size-4" strokeWidth={2} />
              {t("docViewer.openOriginal")}
            </a>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("docViewer.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The extracted-text view: the summary, then the stored chunks. Split out of
 *  the modal so the pages view and this one stay readable side by side. */
function TextView({
  doc,
  chunks,
  failed,
  hasPages,
}: {
  doc: SourceDocument;
  chunks: DocumentChunk[] | null;
  failed: boolean;
  hasPages: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
        {doc.summary ? (
          <div className="mb-5">
            <h3 className="mb-1.5 text-sm font-semibold text-fg">{t("docViewer.summary")}</h3>
            <p className="text-sm leading-relaxed text-fg-muted">{doc.summary}</p>
          </div>
        ) : null}

        {doc.status === "error" ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {doc.error || t("docCard.status.error")}
          </p>
        ) : (
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-fg">{t("docViewer.extracted")}</h3>
            <p className="mb-3 text-xs text-fg-subtle">{t("docViewer.extractedHint")}</p>

            {chunks === null && !failed ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner className="size-5" />
              </div>
            ) : failed ? (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {t("docViewer.loadFailed")}
              </p>
            ) : chunks!.length === 0 ? (
              <p className="text-sm text-fg-subtle">
                {doc.status === "ready" ? t("docViewer.noText") : t("docViewer.stillProcessing")}
              </p>
            ) : (
              <ol className="space-y-3">
                {chunks!.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-xl border border-border bg-surface-2 p-3"
                  >
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                      {t("docViewer.chunkLabel", {
                        index: c.index + 1,
                        total: chunks!.length,
                        tokens: c.tokenCount,
                      })}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
                      {c.content}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      {!hasPages && doc.status !== "error" ? (
        <p className="mt-5 border-t border-border pt-4 text-xs text-fg-subtle">
          {t("docViewer.noPagesForFormat")}
        </p>
      ) : null}
    </div>
  );
}
