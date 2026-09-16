"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Download, FileCode, FileText, ZoomIn } from "lucide-react";
import { Badge, Button, Select, Spinner } from "../ui/primitives";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import { PAGE_SIZES } from "../../lib/page-sizes";
import type { NewsletterStatus } from "../../lib/types";

/** "Export as" menu — one entry point, format chosen inside. Follows the same
 * outside-click/Escape dismissal pattern as ThemeSelect. */
function ExportMenu({
  onExport,
  exporting,
}: {
  onExport: (format: "pdf" | "html") => void;
  exporting: "pdf" | "html" | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(format: "pdf" | "html") {
    setOpen(false);
    onExport(format);
  }

  const items: { format: "pdf" | "html"; label: string; Icon: typeof FileText }[] = [
    { format: "pdf", label: t("topbar.exportAsPdf"), Icon: FileText },
    { format: "html", label: t("topbar.exportAsHtml"), Icon: FileCode },
  ];

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Styled explicitly rather than via <Button>: `cn` is a plain class join
          with no tailwind-merge, so a className override of the primitive's own
          `gap-2`/`px-3` would not reliably win. This needs a roomier box than
          the default sm button — three children (icon, label, chevron) at px-3
          leaves the label touching the edges. Values otherwise mirror
          primary/sm in primitives.tsx. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={exporting !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium",
          "bg-brand-600 text-white shadow-sm shadow-brand-600/20",
          "transition-all duration-150 hover:bg-brand-700 hover:shadow-md hover:shadow-brand-600/25",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
          open && "bg-brand-700 shadow-md shadow-brand-600/25",
        )}
      >
        {exporting ? (
          <Spinner />
        ) : (
          <Download className="size-4 shrink-0" strokeWidth={2} />
        )}
        <span>{t("topbar.exportAs")}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 opacity-80 transition-transform duration-150",
            open && "rotate-180",
          )}
          strokeWidth={2.25}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 min-w-[11rem] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-lg ring-1 ring-black/5"
        >
          {items.map(({ format, label, Icon }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              onClick={() => pick(format)}
              className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
            >
              <Icon className="size-4 shrink-0 text-fg-subtle" strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EditorTopBar({
  title,
  onTitleChange,
  status,
  dirty,
  saving,
  pageSize,
  onPageSize,
  zoom,
  onZoom,
  onSave,
  onExport,
  exporting = null,
  onBack,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  status: NewsletterStatus;
  dirty: boolean;
  saving: boolean;
  pageSize: string;
  onPageSize: (key: string) => void;
  zoom: number;
  onZoom: (z: number) => void;
  onSave: () => void;
  onExport: (format: "pdf" | "html") => void;
  exporting?: "pdf" | "html" | null;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-fg-subtle transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        {t("topbar.backToNewsletters")}
      </button>
      <span className="h-5 w-px bg-border" />
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="min-w-0 flex-1 rounded-md px-2 py-1 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
      />
      <Select
        value={pageSize}
        onChange={(e) => onPageSize(e.target.value)}
        title={t("topbar.paperSize")}
        className="h-8 w-auto px-2 text-xs"
      >
        {PAGE_SIZES.map((p) => (
          <option key={p.key} value={p.key}>
            {t(`pageSize.${p.key}`)}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-1.5" title={t("topbar.zoom")}>
        <ZoomIn className="size-4 text-fg-subtle" strokeWidth={2} />
        <input
          type="range"
          min={50}
          max={150}
          step={10}
          value={Math.round(zoom * 100)}
          onChange={(e) => onZoom(Number(e.target.value) / 100)}
          className="w-20 accent-brand-600"
        />
        <button
          type="button"
          onClick={() => onZoom(1)}
          className="w-10 text-xs font-medium text-fg-muted hover:text-fg"
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>
      <Badge tone={status === "ready" ? "green" : "amber"}>
        {status === "ready" ? t("topbar.statusReady") : t("topbar.statusDraft")}
      </Badge>
      <span className="shrink-0 whitespace-nowrap text-xs text-fg-subtle">
        {saving ? t("topbar.saving") : dirty ? t("topbar.unsaved") : t("topbar.saved")}
      </span>
      <Button variant="outline" size="sm" onClick={onSave} disabled={saving || !dirty} className="shrink-0">
        {saving ? <Spinner /> : t("topbar.save")}
      </Button>
      <ExportMenu onExport={onExport} exporting={exporting} />
    </div>
  );
}
