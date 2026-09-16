"use client";

import { useEffect, useState } from "react";
import { usePlatform } from "@palettelab/sdk";
import { Card, Spinner } from "../../ui/primitives";
import { cn } from "../../../lib/cn";
import { listBrandThemes } from "../../../lib/api-client";
import { useT } from "../../../lib/i18n";
import type { BrandTheme } from "../../../lib/types";

export function ThemePicker({
  themes,
  setThemes,
  selectedId,
  onSelect,
}: {
  themes: BrandTheme[];
  setThemes: (t: BrandTheme[]) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const [loading, setLoading] = useState(themes.length === 0);

  useEffect(() => {
    if (themes.length === 0) {
      listBrandThemes(apiFetch).then((ts) => {
        setThemes(ts);
        setLoading(false);
        const def = ts.find((t) => t.isDefault) ?? ts[0];
        if (def && !selectedId) onSelect(def.id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes.length]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-fg">{t("themePicker.title")}</h2>
      <p className="mb-4 text-sm text-fg-muted">
        {t("themePicker.description")}
      </p>
      <div className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
        {themes.map((theme) => {
          const on = theme.id === selectedId;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => onSelect(theme.id)}
              className={cn(
                "block rounded-xl border p-0 text-left shadow-sm shadow-black/[0.03] transition-all",
                on ? "border-brand-500 ring-2 ring-brand-500/20" : "border-border hover:border-border-strong hover:shadow-md",
              )}
            >
              <Card className="space-y-2 border-0 p-3" style={{ background: theme.palette.bg }}>
                <div
                  className="rounded-lg px-3 py-2"
                  style={{ borderBottom: `3px solid ${theme.palette.accent}` }}
                >
                  <span className="text-sm font-semibold" style={{ color: theme.palette.title }}>
                    {theme.name}
                  </span>
                </div>
                <p className="px-3 pb-2 text-xs" style={{ color: theme.palette.body }}>
                  {t("themePicker.sampleBody")}
                </p>
              </Card>
              {theme.isDefault ? (
                <div className="border-t border-border px-3 py-1.5 text-[10px] uppercase tracking-wide text-fg-subtle">
                  {t("themePicker.defaultBadge")}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
