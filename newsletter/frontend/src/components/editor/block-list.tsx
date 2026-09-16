"use client";

import { Plus } from "lucide-react";
import { Button } from "../ui/primitives";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import type { NewsletterBlock } from "../../lib/types";

export function BlockList({
  blocks,
  activeId,
  onSelect,
  onMove,
  onAdd,
  onDelete,
  onToggleForceBreak,
  onSplit,
}: {
  blocks: NewsletterBlock[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onToggleForceBreak: (id: string) => void;
  onSplit: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">
          {t("blockList.title")} <span className="text-fg-subtle">({blocks.length})</span>
        </h2>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto p-2 scroll-thin">
        {blocks.map((b, i) => {
          const active = b.id === activeId;
          const isCont = !!b.continuationOf;
          return (
            <li key={b.id}>
              <div
                onClick={() => onSelect(b.id)}
                className={cn(
                  "group cursor-pointer rounded-lg border p-2 transition-colors",
                  active
                    ? "border-brand-400 bg-brand-50 dark:bg-brand-400/10"
                    : "border-transparent hover:bg-surface-2",
                  b.forcePageBreak && "border-t-2 border-t-brand-300",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-surface-2 text-[11px] font-semibold text-fg-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {b.title || t("blockList.untitledBlock")}
                      {isCont ? (
                        <span className="ml-1 text-[10px] font-normal text-fg-subtle">
                          {t("blockList.continuationSuffix")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-fg-subtle">
                      {t(`layoutPicker.layout.${b.layout}.label`)}
                      {b.forcePageBreak ? ` · ${t("blockList.pageBreakSuffix")}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <MiniBtn
                    label={t("blockList.moveUp")}
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(b.id, -1);
                    }}
                  />
                  <MiniBtn
                    label={t("blockList.moveDown")}
                    disabled={i === blocks.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(b.id, 1);
                    }}
                  />
                  <MiniBtn
                    label={t("blockList.split")}
                    title={t("blockList.splitTitle")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSplit(b.id);
                    }}
                  />
                  <MiniBtn
                    label={b.forcePageBreak ? t("blockList.pageBreakOn") : t("blockList.pageBreakOff")}
                    title={t("blockList.pageBreakToggleTitle")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleForceBreak(b.id);
                    }}
                  />
                  <MiniBtn
                    label={t("blockList.delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(b.id);
                    }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border p-3">
        <Button variant="subtle" size="sm" className="w-full" onClick={onAdd}>
          <Plus className="size-3.5" strokeWidth={2.25} />
          {t("blockList.addBlock")}
        </Button>
      </div>
    </div>
  );
}

function MiniBtn({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-fg-muted transition-colors hover:bg-surface-2 disabled:opacity-30"
    >
      {label}
    </button>
  );
}
