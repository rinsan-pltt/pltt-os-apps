"use client";

import { useEffect, useState } from "react";
import { Check, Search, UploadCloud } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { UploadZone } from "../../dataroom/upload-zone";
import { Badge, Button, Card, Input, Spinner } from "../../ui/primitives";
import { listDocuments, searchDocuments } from "../../../lib/api-client";
import { fileKind } from "../../../lib/format";
import { cn } from "../../../lib/cn";
import { useT } from "../../../lib/i18n";
import type { SourceDocument } from "../../../lib/types";

export function SourcePicker({
  docs,
  setDocs,
  selected,
  toggle,
}: {
  docs: SourceDocument[];
  setDocs: (updater: (prev: SourceDocument[]) => SourceDocument[]) => void;
  selected: Set<string>;
  toggle: (id: string, on?: boolean) => void;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const [loading, setLoading] = useState(docs.length === 0);
  const [query, setQuery] = useState("");
  const [resultIds, setResultIds] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (docs.length === 0) {
      listDocuments(apiFetch).then((d) => {
        setDocs(() => d);
        setLoading(false);
      });
    }
  }, [docs.length, setDocs, apiFetch]);

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

  const ready = docs.filter((d) => d.status === "ready");
  const visible =
    resultIds === null
      ? ready
      : (resultIds
          .map((id) => ready.find((d) => d.id === id))
          .filter(Boolean) as SourceDocument[]);

  return (
    <div className="grid gap-6 @2xl:grid-cols-[1fr_320px]">
      {/* Reuse from dataroom */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">{t("sourcePicker.reuseTitle")}</h2>
          <span className="text-xs text-fg-subtle">
            {t("sourcePicker.readyCount", { count: ready.length })}
          </span>
        </div>

        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" strokeWidth={2} />
            <Input
              placeholder={t("sourcePicker.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={runSearch} disabled={searching}>
            {searching ? <Spinner /> : t("sourcePicker.findCta")}
          </Button>
          {resultIds !== null ? (
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setResultIds(null);
              }}
            >
              {t("sourcePicker.clearCta")}
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((doc) => {
              const on = selected.has(doc.id);
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => toggle(doc.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      on
                        ? "border-brand-400 bg-brand-50 dark:bg-brand-400/10"
                        : "border-border bg-surface hover:bg-surface-2",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded border",
                        on
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-border-strong bg-surface text-transparent",
                      )}
                    >
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
                          {fileKind(doc.mime)}
                        </span>
                        <span className="truncate text-sm font-medium text-fg">
                          {doc.filename}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs text-fg-muted">
                        {doc.summary}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-subtle">
                {t("sourcePicker.noResults")}
              </p>
            ) : null}
          </ul>
        )}
      </div>

      {/* Upload new */}
      <aside className="@2xl:sticky @2xl:top-6 @2xl:self-start">
        <Card className="p-4">
          <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
            <UploadCloud className="size-4" strokeWidth={2} />
            {t("sourcePicker.uploadTitle")}
          </h2>
          <p className="mb-3 text-xs text-fg-subtle">
            {t("sourcePicker.uploadHint")}
          </p>
          <UploadZone
            onAnalyzed={(doc) => {
              setDocs((prev) => [doc, ...prev]);
              toggle(doc.id, true);
            }}
          />
        </Card>
        <div className="mt-3 px-1">
          <Badge tone="indigo">{t("sourcePicker.selectedCount", { count: selected.size })}</Badge>
        </div>
      </aside>
    </div>
  );
}
