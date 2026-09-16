"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, ImagePlus, Plus, Star, Trash2, Upload, X } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { BrandDesigner } from "../brand/designer";
import { Button, Card, Field, Input, Select, Spinner } from "../ui/primitives";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import {
  createBrandTheme,
  deleteBrandTheme,
  deleteMascot,
  getBrand,
  listBrandThemes,
  listMascots,
  updateBrand,
  updateBrandTheme,
  uploadLogo,
  uploadMascot,
} from "../../lib/api-client";
import { DEFAULT_HIGHLIGHTS } from "../../lib/highlights";
import type { Brand, BrandTemplate, BrandTheme, Mascot, TemplateRule } from "../../lib/types";

const RULES: TemplateRule[] = ["first", "subsequent", "odd", "even", "all"];
const FONTS = [
  { label: "Sans", value: "sans" },
  { label: "Serif", value: "serif" },
  { label: "Mono", value: "mono" },
];
const PALETTE_KEYS = ["bg", "title", "body", "accent"] as const;
const newId = () => Math.random().toString(36).slice(2, 10);

export function BrandView() {
  const { apiFetch } = usePlatform();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [themes, setThemes] = useState<BrandTheme[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [mascots, setMascots] = useState<Mascot[]>([]);
  const [mascotBusy, setMascotBusy] = useState(false);
  const mascotRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBrand(apiFetch).then(setBrand);
    listMascots(apiFetch).then(setMascots);
    listBrandThemes(apiFetch).then((ts) => {
      setThemes(ts);
      setSelectedId(ts.find((th) => th.isDefault)?.id ?? ts[0]?.id ?? null);
    });
  }, [apiFetch]);

  const t = useT();

  const selected = themes.find((theme) => theme.id === selectedId) ?? null;

  function updateSelected(patch: Partial<BrandTheme>) {
    if (!selected) return;
    setThemes((ts) => ts.map((theme) => (theme.id === selected.id ? { ...theme, ...patch } : theme)));
    setDirty(true);
  }

  async function handleLogo(file: File) {
    const b = await uploadLogo(apiFetch, file);
    setBrand((prev) => (prev ? { ...prev, logoUrl: b.logoUrl } : b));
  }

  async function handleMascotFiles(files: FileList | null) {
    if (!files) return;
    setMascotBusy(true);
    for (const f of Array.from(files)) {
      const m = await uploadMascot(apiFetch, f);
      setMascots((prev) => [m, ...prev]);
    }
    setMascotBusy(false);
  }

  async function removeMascot(id: string) {
    await deleteMascot(apiFetch, id);
    setMascots((prev) => prev.filter((m) => m.id !== id));
  }

  async function addTheme() {
    const created = await createBrandTheme(apiFetch, {
      name: "New theme",
      palette: { bg: "#ffffff", title: "#0f172a", body: "#334155", accent: "#4f46e5", highlights: [...DEFAULT_HIGHLIGHTS] },
      typography: { fontFamily: "sans", scale: 1 },
    });
    setThemes((ts) => [...ts, created]);
    setSelectedId(created.id);
  }

  async function duplicateTheme(theme: BrandTheme) {
    const copy = await createBrandTheme(apiFetch, {
      name: `${theme.name} copy`,
      palette: theme.palette,
      typography: theme.typography,
      headers: theme.headers,
      footers: theme.footers,
    });
    setThemes((ts) => [...ts, copy]);
    setSelectedId(copy.id);
  }

  async function removeTheme(theme: BrandTheme) {
    setError(null);
    try {
      await deleteBrandTheme(apiFetch, theme.id);
      setThemes((ts) => ts.filter((x) => x.id !== theme.id));
      if (selectedId === theme.id) {
        setSelectedId(themes.find((x) => x.id !== theme.id)?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("brand.deleteThemeError"));
    }
  }

  async function setDefault(theme: BrandTheme) {
    const updated = await updateBrandTheme(apiFetch, theme.id, { isDefault: true });
    setThemes((ts) => ts.map((x) => (x.id === theme.id ? updated : { ...x, isDefault: false })));
  }

  async function save() {
    if (!brand || !selected) return;
    setSaving(true);
    await Promise.all([
      updateBrand(apiFetch, { name: brand.name }),
      updateBrandTheme(apiFetch, selected.id, {
        name: selected.name,
        palette: selected.palette,
        typography: selected.typography,
        headers: selected.headers,
        footers: selected.footers,
      }),
    ]);
    setDirty(false);
    setSaving(false);
  }

  if (!brand || !selected) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  const newTpl = (kind: "headers" | "footers"): BrandTemplate => ({
    id: newId(),
    name: kind === "headers" ? "Header" : "Footer",
    rule: "all",
    height: kind === "headers" ? 70 : 40,
    elements: [],
  });

  const fontLabel = (value: string) =>
    value === "sans" ? t("brand.fontSans") : value === "serif" ? t("brand.fontSerif") : t("brand.fontMono");

  const ruleLabel = (r: TemplateRule) =>
    r === "first"
      ? t("brand.ruleFirst")
      : r === "subsequent"
        ? t("brand.ruleSubsequent")
        : r === "odd"
          ? t("brand.ruleOdd")
          : r === "even"
            ? t("brand.ruleEven")
            : t("brand.ruleAll");

  return (
    <div className="@container px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{t("brand.title")}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t("brand.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-subtle">{saving ? t("brand.saving") : dirty ? t("brand.unsaved") : t("brand.saved")}</span>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner /> : t("brand.save")}
          </Button>
        </div>
      </div>

      <Card className="mt-6 flex items-center gap-5 p-5">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${brand.logoUrl}?v=${Date.now()}`} alt={t("brand.logoAlt")} className="size-full object-contain" />
          ) : (
            <span className="text-[11px] text-fg-subtle">{t("brand.noLogo")}</span>
          )}
        </div>
        <div className="flex-1">
          <Field label={t("brand.brandNameLabel")}>
            <Input
              value={brand.name}
              onChange={(e) => {
                setBrand((b) => (b ? { ...b, name: e.target.value } : b));
                setDirty(true);
              }}
            />
          </Field>
        </div>
        <div>
          <Button variant="outline" onClick={() => logoRef.current?.click()}>
            <Upload className="size-4" strokeWidth={2} />
            {t("brand.uploadLogo")}
          </Button>
          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleLogo(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">{t("brand.mascotsTitle")}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">{t("brand.mascotsSubtitle")}</p>
          </div>
          <Button variant="outline" onClick={() => mascotRef.current?.click()} disabled={mascotBusy}>
            {mascotBusy ? <Spinner /> : <ImagePlus className="size-4" strokeWidth={2} />}
            {t("brand.uploadMascot")}
          </Button>
          <input
            ref={mascotRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleMascotFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {mascots.length === 0 ? (
          <p className="text-xs text-fg-subtle">{t("brand.noMascots")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {mascots.map((m) => (
              <div key={m.id} className="relative w-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.imageUrl}
                  alt={m.name}
                  className="size-20 rounded-lg border border-border bg-surface-2 object-contain"
                />
                <button
                  onClick={() => removeMascot(m.id)}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-rose-600 text-white shadow-sm transition-transform hover:scale-110"
                  title={t("brand.deleteMascotTitle")}
                >
                  <X className="size-3" strokeWidth={2.5} />
                </button>
                <p className="mt-1 truncate text-center text-[11px] text-fg-muted">{m.name}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-8 grid gap-6 @2xl:grid-cols-[240px_1fr]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">{t("brand.themesTitle")}</h2>
            <Button variant="subtle" size="sm" onClick={addTheme}>
              <Plus className="size-3.5" strokeWidth={2.25} />
              {t("brand.addTheme")}
            </Button>
          </div>
          {error ? <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
          <div className="space-y-1">
            {themes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => setSelectedId(theme.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border p-2 text-left text-sm text-fg transition-colors",
                  theme.id === selectedId
                    ? "border-brand-400 bg-brand-50 dark:bg-brand-400/10"
                    : "border-border hover:bg-surface-2",
                )}
              >
                <span className="flex gap-0.5">
                  {PALETTE_KEYS.map((k) => (
                    <span key={k} className="size-3 rounded-full border border-black/10" style={{ background: theme.palette[k] }} />
                  ))}
                </span>
                <span className="flex-1 truncate">{theme.name}</span>
                {theme.isDefault ? (
                  <span className="rounded bg-surface-2 px-1 text-[9px] uppercase text-fg-subtle">{t("brand.defaultBadge")}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={selected.name} onChange={(e) => updateSelected({ name: e.target.value })} className="h-8 min-w-32 flex-1" />
              {!selected.isDefault ? (
                <Button variant="outline" size="sm" onClick={() => setDefault(selected)}>
                  <Star className="size-3.5" strokeWidth={2} />
                  {t("brand.setDefault")}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => duplicateTheme(selected)}>
                <Copy className="size-3.5" strokeWidth={2} />
                {t("brand.duplicate")}
              </Button>
              <button
                onClick={() => removeTheme(selected)}
                className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline dark:text-rose-400"
              >
                <Trash2 className="size-3.5" strokeWidth={2} />
                {t("brand.delete")}
              </button>
            </div>
            <div className="flex gap-3">
              {PALETTE_KEYS.map((k) => (
                <label key={k} className="flex flex-col items-center gap-1 text-[10px] text-fg-muted">
                  <input
                    type="color"
                    value={selected.palette[k]}
                    onChange={(e) => updateSelected({ palette: { ...selected.palette, [k]: e.target.value } })}
                    className="size-7 cursor-pointer rounded border border-border"
                  />
                  {k}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wide text-fg-muted">{t("brand.highlightsLabel")}</span>
              <div className="flex gap-2">
                {[0, 1, 2, 3].map((i) => {
                  const hs = selected.palette.highlights ?? DEFAULT_HIGHLIGHTS;
                  return (
                    <input
                      key={i}
                      type="color"
                      value={hs[i] ?? DEFAULT_HIGHLIGHTS[i]}
                      onChange={(e) => {
                        const next = [...(selected.palette.highlights ?? DEFAULT_HIGHLIGHTS)];
                        next[i] = e.target.value;
                        updateSelected({ palette: { ...selected.palette, highlights: next } });
                      }}
                      className="size-7 cursor-pointer rounded border border-border"
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={selected.typography.fontFamily}
                onChange={(e) => updateSelected({ typography: { ...selected.typography, fontFamily: e.target.value } })}
                className="h-8 w-auto px-2 text-xs"
              >
                {FONTS.map((f) => <option key={f.value} value={f.value}>{fontLabel(f.value)}</option>)}
              </Select>
              <label className="flex flex-1 items-center gap-2 text-xs text-fg-muted">
                {t("brand.scaleLabel", { value: selected.typography.scale.toFixed(2) })}
                <input
                  type="range"
                  min={0.8}
                  max={1.4}
                  step={0.05}
                  value={selected.typography.scale}
                  onChange={(e) => updateSelected({ typography: { ...selected.typography, scale: Number(e.target.value) } })}
                  className="flex-1 accent-brand-600"
                />
              </label>
            </div>
          </Card>

          {(["headers", "footers"] as const).map((kind) => (
            <section key={kind}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold capitalize text-fg">
                  {kind === "headers" ? t("brand.headersLabel") : t("brand.footersLabel")}
                </h2>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => updateSelected({ [kind]: [...selected[kind], newTpl(kind)] } as Partial<BrandTheme>)}
                >
                  <Plus className="size-3.5" strokeWidth={2.25} />
                  {kind === "headers" ? t("brand.addHeader") : t("brand.addFooter")}
                </Button>
              </div>
              <div className="space-y-4">
                {selected[kind].map((tpl, i) => (
                  <Card key={tpl.id} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={tpl.name}
                        onChange={(e) =>
                          updateSelected({
                            [kind]: selected[kind].map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          } as Partial<BrandTheme>)
                        }
                        className="h-8 w-48"
                      />
                      <Select
                        value={tpl.rule}
                        onChange={(e) =>
                          updateSelected({
                            [kind]: selected[kind].map((x, j) => (j === i ? { ...x, rule: e.target.value as TemplateRule } : x)),
                          } as Partial<BrandTheme>)
                        }
                        className="h-8 w-auto px-2 text-xs"
                        title={t("brand.placementRuleTitle")}
                      >
                        {RULES.map((r) => <option key={r} value={r}>{ruleLabel(r)}</option>)}
                      </Select>
                      <button
                        onClick={() =>
                          updateSelected({ [kind]: selected[kind].filter((_, j) => j !== i) } as Partial<BrandTheme>)
                        }
                        className="ml-auto inline-flex items-center gap-1 text-xs text-rose-600 hover:underline dark:text-rose-400"
                      >
                        <Trash2 className="size-3.5" strokeWidth={2} />
                        {t("brand.remove")}
                      </button>
                    </div>
                    <BrandDesigner
                      template={tpl}
                      brand={brand}
                      palette={selected.palette}
                      onChange={(nt) =>
                        updateSelected({
                          [kind]: selected[kind].map((x, j) => (j === i ? nt : x)),
                        } as Partial<BrandTheme>)
                      }
                    />
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
