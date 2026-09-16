"use client";

import { useState } from "react";
import { LayoutThumb } from "./layout-thumb";
import { ThemeSelect } from "./theme-select";
import { Button } from "../ui/primitives";
import { ConfirmModal } from "../ui/confirm-modal";
import { cn } from "../../lib/cn";
import { LAYOUT_OPTIONS } from "../../lib/fixtures";
import { useT } from "../../lib/i18n";
import type { BrandTheme, NewsletterBlock } from "../../lib/types";

export function LayoutPicker({
  activeBlock,
  onSetLayout,
  themes,
  activeThemeId,
  onSetTheme,
  onRegenerate,
}: {
  activeBlock: NewsletterBlock | null;
  onSetLayout: (key: NewsletterBlock["layout"]) => void;
  themes: BrandTheme[];
  activeThemeId: string | null;
  onSetTheme: (id: string) => void;
  onRegenerate: () => void;
}) {
  const [pendingTheme, setPendingTheme] = useState<BrandTheme | null>(null);
  const t = useT();

  return (
    <div className="flex flex-col gap-5 p-4">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">{t("layoutPicker.themeHeading")}</h2>
        <ThemeSelect
          themes={themes}
          activeThemeId={activeThemeId}
          onPick={(id) => {
            if (id !== activeThemeId) {
              const theme = themes.find((x) => x.id === id);
              if (theme) setPendingTheme(theme);
            }
          }}
        />
      </section>

      <section className="border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">{t("layoutPicker.layoutHeading")}</h2>
          {!activeBlock ? (
            <span className="text-xs text-fg-subtle">{t("layoutPicker.selectBlockHint")}</span>
          ) : null}
        </div>
        <div className={cn("grid grid-cols-2 gap-2", !activeBlock && "opacity-40")}>
          {LAYOUT_OPTIONS.map((opt) => {
            const on = activeBlock?.layout === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={!activeBlock}
                onClick={() => onSetLayout(opt.key)}
                title={t(`layoutPicker.layout.${opt.key}.hint`)}
                className={cn(
                  "overflow-hidden rounded-lg border bg-surface text-left transition-colors disabled:cursor-not-allowed",
                  on
                    ? "border-brand-500 ring-2 ring-brand-500/20"
                    : "border-border hover:border-border-strong",
                )}
              >
                <LayoutThumb layout={opt.key} />
                <div className="border-t border-border px-2 py-1">
                  <span className="text-[11px] font-medium text-fg-muted">
                    {t(`layoutPicker.layout.${opt.key}.label`)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!activeBlock}
          onClick={onRegenerate}
        >
          {t("layoutPicker.regenerateCta")}
        </Button>
        <p className="mt-2 text-[11px] text-fg-subtle">
          {t("layoutPicker.regenerateHint")}
        </p>
      </section>

      {pendingTheme ? (
        <ConfirmModal
          title={t("layoutPicker.switchThemeTitle")}
          message={t("layoutPicker.switchThemeMessage", { name: pendingTheme.name })}
          confirmLabel={t("layoutPicker.switchThemeConfirm")}
          onConfirm={() => onSetTheme(pendingTheme.id)}
          onClose={() => setPendingTheme(null)}
        />
      ) : null}
    </div>
  );
}
