"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import type { BrandTheme } from "../../lib/types";

export function ThemeSelect({
  themes,
  activeThemeId,
  onPick,
}: {
  themes: BrandTheme[];
  activeThemeId: string | null;
  onPick: (themeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  const active = themes.find((theme) => theme.id === activeThemeId) ?? null;
  const filtered = themes.filter((theme) =>
    theme.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

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

  function swatch(theme: BrandTheme) {
    return (
      <span
        className="size-4 shrink-0 rounded"
        style={{ background: theme.palette.bg, border: `2px solid ${theme.palette.accent}` }}
      />
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:border-border-strong"
      >
        {active ? swatch(active) : null}
        <span className="flex-1 truncate text-[13px] text-fg">
          {active?.name ?? t("themeSelect.selectTheme")}
        </span>
        <ChevronDown className={cn("size-3.5 text-fg-subtle transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("themeSelect.searchPlaceholder")}
            className="w-full border-b border-border bg-surface px-2 py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle"
          />
          <ul className="max-h-56 overflow-auto scroll-thin py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-[12px] text-fg-subtle">{t("themeSelect.noThemes")}</li>
            ) : (
              filtered.map((theme) => (
                <li key={theme.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(theme.id);
                      setOpen(false);
                      setQ("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-surface-2",
                      theme.id === activeThemeId && "bg-brand-50 dark:bg-brand-400/10",
                    )}
                  >
                    {swatch(theme)}
                    <span className="flex-1 truncate text-fg">{theme.name}</span>
                    {theme.id === activeThemeId ? (
                      <span className="text-[10px] uppercase text-brand-600 dark:text-brand-300">{t("themeSelect.active")}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
