"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { ImageModal } from "../editor/image-modal";
import { Button, Input, Select } from "../ui/primitives";
import { cn } from "../../lib/cn";
import { useLocale } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { Brand, BrandElement, BrandElementType, BrandTemplate, Palette } from "../../lib/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const newId = () => Math.random().toString(36).slice(2, 8);
const COLOR_TOKENS = ["title", "body", "accent", "bg"];
const CORNERS = ["nw", "ne", "sw", "se"] as const;
type Corner = (typeof CORNERS)[number];
const SNAP = 2; // % snap threshold

function resolveColor(c: string | undefined, palette: Palette): string {
  if (c === "title") return palette.title;
  if (c === "body") return palette.body;
  if (c === "accent") return palette.accent;
  if (c === "bg") return palette.bg;
  return c || "#111111";
}
function sampleText(t: string | undefined, brand: Brand, locale: string): string {
  const now = new Date();
  return (t || "")
    .replace(/\{\{\s*brand\.name\s*\}\}/g, brand.name)
    .replace(/\{\{\s*newsletter\.title\s*\}\}/g, "Newsletter title")
    .replace(/\{\{\s*page\.num\s*\}\}/g, "1")
    .replace(/\{\{\s*page\.total\s*\}\}/g, "3")
    .replace(
      /\{\{\s*time\.date\s*\}\}/g,
      now.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }),
    )
    .replace(/\{\{\s*time\.day\s*\}\}/g, now.toLocaleDateString(locale, { weekday: "long" }))
    .replace(/\{\{\s*time\.month\s*\}\}/g, now.toLocaleDateString(locale, { month: "long" }))
    .replace(/\{\{\s*time\.year\s*\}\}/g, String(now.getFullYear()));
}
function defaultEl(type: BrandElementType): BrandElement {
  const base: BrandElement = { id: newId(), type, xPct: 10, yPct: 25, wPct: 30, hPct: 50, rotation: 0 };
  if (type === "logo") return { ...base, xPct: 4, yPct: 18, wPct: 14, hPct: 64 };
  if (type === "divider") return { ...base, xPct: 5, yPct: 48, wPct: 90, hPct: 8, color: "accent", thickness: 2 };
  if (type === "box") return { ...base, xPct: 8, yPct: 20, wPct: 40, hPct: 50, bgColor: "accent", borderColor: "accent", borderWidth: 0, radius: 6 };
  if (type === "image") return { ...base, xPct: 8, yPct: 15, wPct: 30, hPct: 70 };
  return { ...base, text: "Text", fontSize: 14, color: "title", align: "left" };
}

export function BrandDesigner({
  template,
  brand,
  palette,
  onChange,
}: {
  template: BrandTemplate;
  brand: Brand;
  palette: Palette;
  onChange: (t: BrandTemplate) => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const [imageModalFor, setImageModalFor] = useState<"new" | string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const els = template.elements ?? [];
  const sel = els.find((e) => e.id === selId) ?? null;

  function setEls(next: BrandElement[]) {
    onChange({ ...template, elements: next });
  }
  function updateEl(id: string, patch: Partial<BrandElement>) {
    setEls(els.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  function add(type: BrandElementType, extra?: Partial<BrandElement>) {
    const e = { ...defaultEl(type), ...extra };
    setEls([...els, e]);
    setSelId(e.id);
  }
  function remove(id: string) {
    setEls(els.filter((e) => e.id !== id));
    setSelId(null);
  }
  function reorder(id: string, dir: -1 | 1) {
    const i = els.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= els.length) return;
    const next = [...els];
    [next[i], next[j]] = [next[j], next[i]];
    setEls(next);
  }
  function select(id: string) {
    setSelId(id);
    canvasRef.current?.focus();
  }

  function rect() {
    return canvasRef.current?.getBoundingClientRect() ?? null;
  }

  function startDrag(e: React.PointerEvent, el: BrandElement) {
    e.preventDefault();
    e.stopPropagation();
    select(el.id);
    const r = rect();
    if (!r) return;
    const sx = e.clientX, sy = e.clientY, ox = el.xPct, oy = el.yPct;
    const move = (ev: PointerEvent) => {
      let nx = clamp(ox + ((ev.clientX - sx) / r.width) * 100, 0, 100 - el.wPct);
      let ny = clamp(oy + ((ev.clientY - sy) / r.height) * 100, 0, 100 - el.hPct);
      let gv: number | null = null;
      let gh: number | null = null;
      const cx = nx + el.wPct / 2;
      if (Math.abs(cx - 50) < SNAP) { nx = 50 - el.wPct / 2; gv = 50; }
      else if (Math.abs(nx) < SNAP) { nx = 0; gv = 0; }
      else if (Math.abs(nx + el.wPct - 100) < SNAP) { nx = 100 - el.wPct; gv = 100; }
      const cy = ny + el.hPct / 2;
      if (Math.abs(cy - 50) < SNAP * 1.5) { ny = 50 - el.hPct / 2; gh = 50; }
      else if (Math.abs(ny) < SNAP * 1.5) { ny = 0; gh = 0; }
      else if (Math.abs(ny + el.hPct - 100) < SNAP * 1.5) { ny = 100 - el.hPct; gh = 100; }
      setGuides({ v: gv, h: gh });
      updateEl(el.id, { xPct: nx, yPct: ny });
    };
    listen(move, () => setGuides({ v: null, h: null }));
  }

  function startResize(e: React.PointerEvent, el: BrandElement, corner: Corner) {
    e.preventDefault();
    e.stopPropagation();
    const r = rect();
    if (!r) return;
    const x = el.xPct, y = el.yPct, w = el.wPct, h = el.hPct;
    const right = x + w, bottom = y + h;
    const move = (ev: PointerEvent) => {
      const px = clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100);
      const py = clamp(((ev.clientY - r.top) / r.height) * 100, 0, 100);
      const p: Partial<BrandElement> = {};
      if (corner === "se") { p.wPct = clamp(px - x, 4, 100); p.hPct = clamp(py - y, 4, 100); }
      else if (corner === "sw") { p.xPct = clamp(px, 0, right - 4); p.wPct = right - clamp(px, 0, right - 4); p.hPct = clamp(py - y, 4, 100); }
      else if (corner === "ne") { p.wPct = clamp(px - x, 4, 100); p.yPct = clamp(py, 0, bottom - 4); p.hPct = bottom - clamp(py, 0, bottom - 4); }
      else { p.xPct = clamp(px, 0, right - 4); p.wPct = right - clamp(px, 0, right - 4); p.yPct = clamp(py, 0, bottom - 4); p.hPct = bottom - clamp(py, 0, bottom - 4); }
      updateEl(el.id, p);
    };
    listen(move);
  }

  function startRotate(e: React.PointerEvent, el: BrandElement) {
    e.preventDefault();
    e.stopPropagation();
    const node = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!node) return;
    const cx = node.left + node.width / 2, cy = node.top + node.height / 2;
    const move = (ev: PointerEvent) => {
      const deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      updateEl(el.id, { rotation: Math.round(deg) });
    };
    listen(move);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!sel) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(sel.id); return; }
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      updateEl(sel.id, { xPct: clamp(sel.xPct + m[0], 0, 100 - sel.wPct), yPct: clamp(sel.yPct + m[1], 0, 100 - sel.hPct) });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-fg-muted">{t("designer.addLabel")}</span>
        <Button variant="outline" size="sm" onClick={() => add("logo")}>{t("designer.addLogo")}</Button>
        <Button variant="outline" size="sm" onClick={() => add("text")}>{t("designer.addText")}</Button>
        <Button variant="outline" size="sm" onClick={() => add("text", { text: "{{ page.num }} / {{ page.total }}", align: "right", color: "body" })}>{t("designer.addPageNumber")}</Button>
        <Button variant="outline" size="sm" onClick={() => add("box")}>{t("designer.addBox")}</Button>
        <Button variant="outline" size="sm" onClick={() => add("divider")}>{t("designer.addDivider")}</Button>
        <Button variant="outline" size="sm" onClick={() => setImageModalFor("new")}>{t("designer.addImage")}</Button>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-fg-muted">
          {t("designer.bandHeight")}
          <Input type="number" value={template.height} onChange={(e) => onChange({ ...template, height: Number(e.target.value) || 40 })} className="h-7 w-16" />
        </label>
      </div>

      <div
        ref={canvasRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative w-full overflow-hidden rounded-lg border border-border-strong outline-none focus:ring-2 focus:ring-brand-200"
        style={{ height: template.height, background: palette.bg }}
        onClick={() => setSelId(null)}
      >
        {/* snap guides */}
        {guides.v != null ? <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand-400" style={{ left: `${guides.v}%` }} /> : null}
        {guides.h != null ? <div className="pointer-events-none absolute left-0 right-0 h-px bg-brand-400" style={{ top: `${guides.h}%` }} /> : null}

        {els.map((el) => {
          const isSel = sel?.id === el.id;
          return (
            <div
              key={el.id}
              onPointerDown={(e) => startDrag(e, el)}
              onClick={(e) => { e.stopPropagation(); select(el.id); }}
              className={cn("absolute cursor-move", isSel && "outline outline-2 outline-brand-400")}
              style={{ left: `${el.xPct}%`, top: `${el.yPct}%`, width: `${el.wPct}%`, height: `${el.hPct}%`, transform: `rotate(${el.rotation ?? 0}deg)` }}
            >
              <ElementBody el={el} brand={brand} palette={palette} />
              {isSel ? (
                <>
                  <span onPointerDown={(e) => startRotate(e, el)} className="absolute -top-5 left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border border-white bg-brand-500" title={t("designer.rotateHandle")} />
                  {CORNERS.map((c) => (
                    <span
                      key={c}
                      onPointerDown={(e) => startResize(e, el, c)}
                      className={cn(
                        "absolute size-2.5 rounded-sm border border-white bg-brand-500",
                        c === "nw" && "-left-1 -top-1 cursor-nwse-resize",
                        c === "ne" && "-right-1 -top-1 cursor-nesw-resize",
                        c === "sw" && "-bottom-1 -left-1 cursor-nesw-resize",
                        c === "se" && "-bottom-1 -right-1 cursor-nwse-resize",
                      )}
                    />
                  ))}
                </>
              ) : null}
            </div>
          );
        })}
        {els.length === 0 ? (
          <div className="grid h-full w-full place-items-center text-[11px] text-fg-subtle">{t("designer.emptyCanvas")}</div>
        ) : null}
      </div>

      {sel ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-2 text-xs">
          {sel.type === "text" ? (
            <>
              <Input value={sel.text ?? ""} onChange={(e) => updateEl(sel.id, { text: e.target.value })} className="h-7 min-w-[150px] flex-1" placeholder={t("designer.textPlaceholder")} />
              {[
                { key: "brand", label: t("designer.insertBrand"), tpl: "{{ brand.name }}" },
                { key: "title", label: t("designer.insertTitle"), tpl: "{{ newsletter.title }}" },
                { key: "page", label: t("designer.insertPage"), tpl: "{{ page.num }} / {{ page.total }}" },
                { key: "date", label: t("designer.insertDate"), tpl: "{{ time.date }}" },
                { key: "day", label: t("designer.insertDay"), tpl: "{{ time.day }}" },
                { key: "month", label: t("designer.insertMonth"), tpl: "{{ time.month }}" },
                { key: "year", label: t("designer.insertYear"), tpl: "{{ time.year }}" },
              ].map(({ key, label, tpl }) => (
                <button key={key} type="button" onClick={() => updateEl(sel.id, { text: `${sel.text ?? ""}${tpl}` })} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-border hover:text-fg">+{label}</button>
              ))}
              <Input type="number" value={sel.fontSize ?? 14} onChange={(e) => updateEl(sel.id, { fontSize: Number(e.target.value) || 14 })} className="h-7 w-14" title={t("designer.fontSizeLabel")} />
              <button type="button" onClick={() => updateEl(sel.id, { bold: !sel.bold })} className={cn("h-7 rounded px-2 font-bold", sel.bold ? "bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300" : "bg-surface text-fg-muted")}>B</button>
              {(["left", "center", "right"] as const).map((a) => (
                <button key={a} type="button" onClick={() => updateEl(sel.id, { align: a })} className={cn("h-7 rounded px-2", sel.align === a ? "bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300" : "bg-surface text-fg-muted")}>{a[0].toUpperCase()}</button>
              ))}
              <ColorPicker label={t("designer.colorLabelColor")} value={sel.color} onChange={(c) => updateEl(sel.id, { color: c })} />
            </>
          ) : sel.type === "divider" ? (
            <>
              <span className="text-fg-muted">{t("designer.thicknessLabel")}</span>
              <Input type="number" value={sel.thickness ?? 2} onChange={(e) => updateEl(sel.id, { thickness: Number(e.target.value) || 1 })} className="h-7 w-14" />
              <ColorPicker label={t("designer.colorLabelColor")} value={sel.color} onChange={(c) => updateEl(sel.id, { color: c })} />
            </>
          ) : sel.type === "box" ? (
            <>
              <ColorPicker label={t("designer.colorLabelFill")} value={sel.bgColor} onChange={(c) => updateEl(sel.id, { bgColor: c })} />
              <ColorPicker label={t("designer.colorLabelBorder")} value={sel.borderColor} onChange={(c) => updateEl(sel.id, { borderColor: c })} />
              <span className="text-fg-muted">{t("designer.borderWidthAbbr")}</span>
              <Input type="number" value={sel.borderWidth ?? 0} onChange={(e) => updateEl(sel.id, { borderWidth: Number(e.target.value) || 0 })} className="h-7 w-12" title={t("designer.borderWidthTooltip")} />
              <span className="text-fg-muted">{t("designer.radiusLabel")}</span>
              <Input type="number" value={sel.radius ?? 0} onChange={(e) => updateEl(sel.id, { radius: Number(e.target.value) || 0 })} className="h-7 w-12" />
            </>
          ) : sel.type === "image" ? (
            <>
              {sel.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sel.imageUrl} alt="" className="size-7 rounded border border-border object-contain" />
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setImageModalFor(sel.id)}>
                {sel.imageUrl ? t("designer.replaceImage") : t("designer.chooseImage")}
              </Button>
            </>
          ) : (
            <span className="text-fg-muted">{t("designer.logoHint")}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => reorder(sel.id, -1)} className="rounded bg-surface px-2 py-1.5 text-fg-muted hover:bg-border hover:text-fg" title={t("designer.sendBackward")}>
              <ArrowDown className="size-3.5" strokeWidth={2} />
            </button>
            <button type="button" onClick={() => reorder(sel.id, 1)} className="rounded bg-surface px-2 py-1.5 text-fg-muted hover:bg-border hover:text-fg" title={t("designer.bringForward")}>
              <ArrowUp className="size-3.5" strokeWidth={2} />
            </button>
            <button type="button" onClick={() => remove(sel.id)} className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-rose-600 hover:bg-rose-100 dark:bg-rose-400/10 dark:text-rose-400 dark:hover:bg-rose-400/20">
              <Trash2 className="size-3.5" strokeWidth={2} />
              {t("designer.deleteElement")}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-fg-subtle">{t("designer.selectHint")}</p>
      )}

      {imageModalFor ? (
        <ImageModal
          initialUrl={
            imageModalFor === "new"
              ? undefined
              : els.find((e) => e.id === imageModalFor)?.imageUrl || undefined
          }
          onClose={() => setImageModalFor(null)}
          onDone={(url) => {
            if (imageModalFor === "new") add("image", { imageUrl: url });
            else updateEl(imageModalFor, { imageUrl: url });
            setImageModalFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ElementBody({ el, brand, palette }: { el: BrandElement; brand: Brand; palette: Palette }) {
  const t = useT();
  const locale = useLocale();
  if (el.type === "logo") {
    return brand.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`${brand.logoUrl}?v=1`} alt="" className="h-full w-full select-none object-contain" draggable={false} />
    ) : (
      <div className="grid h-full w-full place-items-center rounded border border-dashed border-border-strong text-[9px] text-fg-subtle">{t("designer.logoPlaceholder")}</div>
    );
  }
  if (el.type === "image") {
    return el.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={el.imageUrl} alt="" className="h-full w-full select-none object-contain" draggable={false} />
    ) : (
      <div className="grid h-full w-full place-items-center rounded border border-dashed border-border-strong text-[9px] text-fg-subtle">{t("designer.imagePlaceholder")}</div>
    );
  }
  if (el.type === "divider") {
    return (
      <div className="flex h-full w-full items-center">
        <div style={{ width: "100%", borderTop: `${el.thickness ?? 2}px solid ${resolveColor(el.color, palette)}` }} />
      </div>
    );
  }
  if (el.type === "box") {
    return (
      <div
        className="h-full w-full"
        style={{
          background: el.bgColor ? resolveColor(el.bgColor, palette) : "transparent",
          border: `${el.borderWidth ?? 0}px solid ${resolveColor(el.borderColor, palette)}`,
          borderRadius: el.radius ?? 0,
        }}
      />
    );
  }
  return (
    <div
      className="flex h-full w-full items-center overflow-hidden"
      style={{
        justifyContent: el.align === "center" ? "center" : el.align === "right" ? "flex-end" : "flex-start",
        fontSize: el.fontSize ?? 14,
        fontWeight: el.bold ? 700 : 400,
        color: resolveColor(el.color, palette),
        textAlign: el.align ?? "left",
        lineHeight: 1.15,
      }}
    >
      {sampleText(el.text, brand, locale)}
    </div>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value?: string; onChange: (c: string) => void }) {
  const t = useT();
  const isToken = value && COLOR_TOKENS.includes(value);
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-fg-muted">{label}</span>
      <Select value={isToken ? value : "custom"} onChange={(e) => onChange(e.target.value === "custom" ? "#111111" : e.target.value)} className="h-7 w-auto px-1 text-[11px]">
        {COLOR_TOKENS.map((token) => <option key={token} value={token}>{t(`designer.colorToken.${token}`)}</option>)}
        <option value="custom">{t("designer.customColor")}</option>
      </Select>
      {!isToken ? <input type="color" value={value || "#111111"} onChange={(e) => onChange(e.target.value)} className="size-7 rounded border border-border" /> : null}
    </div>
  );
}

function listen(move: (ev: PointerEvent) => void, onUp?: () => void) {
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onUp?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
