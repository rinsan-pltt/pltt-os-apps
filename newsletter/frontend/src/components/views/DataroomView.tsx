"use client";

import { useEffect, useState } from "react";
import { FileStack, Layers, Plus, Search, Sparkles, Wand2, X } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { DocumentCard } from "../dataroom/document-card";
import { DocumentViewer } from "../dataroom/document-viewer";
import { UploadZone } from "../dataroom/upload-zone";
import { Button, buttonClasses, Card, Input, Spinner } from "../ui/primitives";
import { listDocuments, searchDocuments } from "../../lib/api-client";
import { useT } from "../../lib/i18n";
import type { SourceDocument } from "../../lib/types";

export function DataroomView({
  onCreateNewsletter,
}: {
  /** `sourceIds` pre-selects those documents in the create wizard. Called with
   *  nothing from the plain header button, which opens an empty wizard. */
  onCreateNewsletter: (sourceIds?: string[]) => void;
}) {
  const { apiFetch } = usePlatform();
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [resultIds, setResultIds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<SourceDocument | null>(null);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    listDocuments(apiFetch).then((d) => {
      setDocs(d);
      setLoading(false);
    });
  }, [apiFetch]);

  const t = useT();

  async function runSearch() {
    if (!query.trim()) {
      setResultIds(null);
      return;
    }
    setSearching(true);
    const res = await searchDocuments(apiFetch, query);
    setResultIds(res.map((r) => r.id));
    setSearching(false);
  }

  function clearSearch() {
    setQuery("");
    setResultIds(null);
  }

  const visible =
    resultIds === null
      ? docs
      : (resultIds
          .map((id) => docs.find((d) => d.id === id))
          .filter(Boolean) as SourceDocument[]);

  const readyCount = docs.filter((d) => d.status === "ready").length;

  return (
    // Full-height layout, in two elements for two different reasons.
    //
    // The outer one is the container query context AND carries `h-full` — a
    // DEFINITE height, taken from `main` in the app shell, which is the
    // scroller. `min-h-full` alone is not enough: a column flex box sized only
    // by `min-height` still grows to its content, so `flex-1` on the row below
    // had nothing fixed to divide and the panels ran past the bottom of the
    // window as soon as there were enough documents.
    //
    // The inner one does the layout. `@3xl:h-full` pins it to that definite
    // height once the columns sit side by side; below the breakpoint they stack
    // and `min-h-full` lets the content run longer than the window and scroll
    // normally. (`@3xl:` has to live here rather than on the element above —
    // an element cannot query its own container.)
    <div className="@container h-full">
    <div className="flex min-h-full flex-col px-6 py-8 @3xl:h-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {t("dataroom.title")}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t("dataroom.subtitle")}
          </p>
        </div>
        {/* Wrapped, not passed directly: `onClick={onCreateNewsletter}` hands
            React's click event to the handler, and its first parameter is now
            `sourceIds` — the event arrived where an array of ids was expected
            and `new Set(event)` threw on the wizard's first render. This button
            deliberately opens an EMPTY wizard; the selection bar is what
            carries a selection through. */}
        <button onClick={() => onCreateNewsletter()} className={buttonClasses("primary")}>
          <Plus className="size-4" strokeWidth={2.25} />
          {t("dataroom.createNewsletter")}
        </button>
      </div>

      {/* `@3xl:` variants work on this element because it is a DESCENDANT of the
          `@container` root — an element cannot query its own container. Below
          the breakpoint the two columns are a plain stacked grid that grows
          with its content; at and above it they become a fixed-height row whose
          panels scroll internally. */}
      <div className="mt-8 grid gap-6 @3xl:min-h-0 @3xl:flex-1 @3xl:grid-cols-[320px_1fr]">
        {/* ------------------------------------------- left rectangle ------ */}
        {/* One panel holding both sections, stacked from the top: "At a glance"
            sits directly under the drop zone rather than being pushed to the
            base of the panel, so the two read as one block you can take in
            together. The panel still runs the full height of the column; the
            space simply falls below them. */}
        <Card className="flex flex-col @3xl:min-h-0">
          <div className="min-h-0 @3xl:overflow-y-auto @3xl:scroll-thin">
          <div className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg">{t("dataroom.addContent")}</h2>
            <UploadZone onAnalyzed={(doc) => setDocs((prev) => [doc, ...prev])} />
          </div>

          <div className="border-t border-border p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg">{t("dataroom.atAGlance")}</h2>
            <div className="divide-y divide-border text-sm">
              <div className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="inline-flex items-center gap-2 text-fg-muted">
                  <FileStack className="size-4" strokeWidth={2} />
                  {t("dataroom.documentsLabel")}
                </span>
                <span className="font-semibold text-fg">{docs.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="inline-flex items-center gap-2 text-fg-muted">
                  <Sparkles className="size-4" strokeWidth={2} />
                  {t("dataroom.readyForRag")}
                </span>
                <span className="font-semibold text-fg">{readyCount}</span>
              </div>
              <div className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="inline-flex items-center gap-2 text-fg-muted">
                  <Layers className="size-4" strokeWidth={2} />
                  {t("dataroom.totalChunks")}
                </span>
                <span className="font-semibold text-fg">
                  {docs.reduce((sum, d) => sum + d.chunkCount, 0)}
                </span>
              </div>
            </div>
          </div>
          </div>
        </Card>

        {/* --------------------------------------------- documents (right) - */}
        {/* `@container` on this panel, because the card grid inside sizes its
            columns from the panel's own width — which changes with the app
            sidebar, not just the viewport. */}
        <Card className="@container flex flex-col @3xl:min-h-0">
          <div className="shrink-0 p-4 pb-3">
            <h2 className="mb-3 text-sm font-semibold text-fg">{t("dataroom.documentsTitle")}</h2>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" strokeWidth={2} />
                <Input
                  placeholder={t("dataroom.searchPlaceholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  className="pl-9"
                />
              </div>
              <Button onClick={runSearch} disabled={searching}>
                {searching ? <Spinner /> : t("dataroom.search")}
              </Button>
              {resultIds !== null ? (
                <Button variant="ghost" onClick={clearSearch}>
                  <X className="size-4" strokeWidth={2} />
                  {t("dataroom.clear")}
                </Button>
              ) : null}
            </div>

            {resultIds !== null ? (
              <p className="mt-3 text-sm text-fg-muted">
                {t("dataroom.resultsFor", { count: visible.length })}
                <span className="font-medium text-fg"> &ldquo;{query}&rdquo;</span>
              </p>
            ) : null}

            {/* Selection bar. Appears only once something is ticked, so the
                panel stays quiet until there is a decision to act on — and it
                sits with the tiles rather than in the page header, because it
                acts on what is selected below it. */}
            {selected.size > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-400/25 dark:bg-brand-400/10">
                <span className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  {t("dataroom.selectedCount", { count: selected.size })}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    {t("dataroom.clearSelection")}
                  </Button>
                  <Button size="sm" onClick={() => onCreateNewsletter(Array.from(selected))}>
                    <Wand2 className="size-4" strokeWidth={2} />
                    {t("dataroom.createFromSelection")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Only the results scroll — the heading and the search box stay put,
              so you can refine a query without scrolling back up to it. */}
          <div className="min-h-0 flex-1 px-4 pb-4 @3xl:overflow-y-auto @3xl:scroll-thin">
            {loading ? (
              <div className="flex h-full min-h-56 items-center justify-center">
                <Spinner className="size-6" />
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full min-h-56 flex-col items-center justify-center gap-2 text-center">
                <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-fg-subtle">
                  <FileStack className="size-5" strokeWidth={1.75} />
                </div>
                <p className="text-sm text-fg-subtle">
                  {resultIds !== null ? t("dataroom.noDocumentsMatch") : t("dataroom.noDocumentsYet")}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4">
                {visible.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    onDeleted={(id) => {
                      setDocs((prev) => prev.filter((d) => d.id !== id));
                      // Drop it from the selection too — otherwise the wizard
                      // is handed the id of a document that no longer exists.
                      setSelected((prev) => {
                        if (!prev.has(id)) return prev;
                        const next = new Set(prev);
                        next.delete(id);
                        return next;
                      });
                    }}
                    onOpen={setViewing}
                    selected={selected.has(doc.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {viewing ? (
        <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />
      ) : null}
    </div>
    </div>
  );
}
