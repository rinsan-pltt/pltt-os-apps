"use client";

import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { RichText } from "./rich-text";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import type { Overlay } from "../../lib/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const CORNERS = ["nw", "ne", "sw", "se"] as const;
type Corner = (typeof CORNERS)[number];

export function OverlayLayer({
  overlays,
  activeId,
  onSelect,
  onUpdate,
  onRemove,
  onEditImage,
}: {
  overlays: Overlay[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Overlay>) => void;
  onRemove: (id: string) => void;
  onEditImage?: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {overlays.map((ov) => (
        <OverlayItem
          key={ov.id}
          ov={ov}
          active={ov.id === activeId}
          onSelect={() => onSelect(ov.id)}
          onUpdate={(patch) => onUpdate(ov.id, patch)}
          onRemove={() => onRemove(ov.id)}
          onEditImage={onEditImage ? () => onEditImage(ov.id) : undefined}
        />
      ))}
    </div>
  );
}

function OverlayItem({
  ov,
  active,
  onSelect,
  onUpdate,
  onRemove,
  onEditImage,
}: {
  ov: Overlay;
  active: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<Overlay>) => void;
  onRemove: () => void;
  onEditImage?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  function parentRect(): DOMRect | null {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    return parent?.getBoundingClientRect() ?? null;
  }

  function curHeightPct(r: DOMRect): number {
    if (ov.hPct != null) return ov.hPct;
    const h = ref.current?.offsetHeight ?? 0;
    return (h / r.height) * 100;
  }

  function startDrag(e: React.PointerEvent) {
    if (ov.type === "text" && active) return; // let text editing receive clicks
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const r = parentRect();
    if (!r) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = ov.xPct;
    const oy = ov.yPct;
    function move(ev: PointerEvent) {
      onUpdate({
        xPct: clamp(ox + ((ev.clientX - sx) / r!.width) * 100, 0, 98),
        yPct: clamp(oy + ((ev.clientY - sy) / r!.height) * 100, 0, 99),
      });
    }
    listen(move);
  }

  function startResize(e: React.PointerEvent, corner: Corner) {
    e.preventDefault();
    e.stopPropagation();
    const r = parentRect();
    if (!r) return;
    const x = ov.xPct;
    const y = ov.yPct;
    const w = ov.wPct;
    const h = curHeightPct(r);
    const right = x + w;
    const bottom = y + h;
    function move(ev: PointerEvent) {
      const px = clamp(((ev.clientX - r!.left) / r!.width) * 100, 0, 100);
      const py = clamp(((ev.clientY - r!.top) / r!.height) * 100, 0, 100);
      const patch: Partial<Overlay> = {};
      if (corner === "se") {
        patch.wPct = clamp(px - x, 4, 100);
        patch.hPct = clamp(py - y, 3, 100);
      } else if (corner === "sw") {
        patch.xPct = clamp(px, 0, right - 4);
        patch.wPct = right - clamp(px, 0, right - 4);
        patch.hPct = clamp(py - y, 3, 100);
      } else if (corner === "ne") {
        patch.wPct = clamp(px - x, 4, 100);
        patch.yPct = clamp(py, 0, bottom - 3);
        patch.hPct = bottom - clamp(py, 0, bottom - 3);
      } else {
        patch.xPct = clamp(px, 0, right - 4);
        patch.wPct = right - clamp(px, 0, right - 4);
        patch.yPct = clamp(py, 0, bottom - 3);
        patch.hPct = bottom - clamp(py, 0, bottom - 3);
      }
      onUpdate(patch);
    }
    listen(move);
  }

  function startLineResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = parentRect();
    if (!r) return;
    const sx = e.clientX;
    const ow = ov.wPct;
    function move(ev: PointerEvent) {
      onUpdate({ wPct: clamp(ow + ((ev.clientX - sx) / r!.width) * 100, 4, 100) });
    }
    listen(move);
  }

  function startRotate(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    function move(ev: PointerEvent) {
      const deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      onUpdate({ rotation: Math.round(deg) });
    }
    listen(move);
  }

  const wrapStyle: React.CSSProperties = {
    left: `${ov.xPct}%`,
    top: `${ov.yPct}%`,
    width: `${ov.wPct}%`,
    height: ov.hPct != null ? `${ov.hPct}%` : undefined,
    transform: `rotate(${ov.rotation}deg)`,
  };

  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-auto absolute",
        ov.type === "line" ? "cursor-move" : "cursor-move",
      )}
      style={wrapStyle}
      onPointerDown={startDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        if ((ov.type === "mascot" || ov.type === "image") && onEditImage) {
          e.stopPropagation();
          onEditImage();
        }
      }}
    >
      {ov.type === "mascot" || ov.type === "image" ? (
        ov.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ov.imageUrl}
            alt=""
            draggable={false}
            className={cn("h-full w-full select-none rounded object-contain", active && "ring-2 ring-brand-400")}
          />
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEditImage?.();
            }}
            className="flex h-full min-h-16 w-full items-center justify-center gap-1 rounded border-2 border-dashed border-border-strong bg-surface/70 text-[11px] font-medium text-fg-muted"
          >
            <ImagePlus className="size-3.5" strokeWidth={2} />
            {t("overlay.addImage")}
          </button>
        )
      ) : ov.type === "text" ? (
        <div
          className={cn("h-full w-full rounded px-2 py-1 text-sm", active && "ring-2 ring-brand-400")}
          style={{ background: ov.bgColor ?? "transparent", color: ov.color ?? "#0f172a" }}
        >
          {active ? (
            <RichText
              value={ov.content ?? ""}
              multiline
              onCommit={(v) => onUpdate({ content: v })}
              placeholder={t("overlay.textPlaceholder")}
            />
          ) : (
            <div className="richtext" dangerouslySetInnerHTML={{ __html: ov.content ?? "" }} />
          )}
        </div>
      ) : (
        // line
        <div className="flex h-full w-full items-center">
          <div
            className="w-full"
            style={{ height: ov.strokeWidth ?? 2, background: ov.color ?? "#0f172a" }}
          />
        </div>
      )}

      {active ? (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -right-2 -top-2 z-10 grid size-5 place-items-center rounded-full bg-rose-600 text-white shadow-sm transition-transform hover:scale-110"
          >
            <X className="size-3" strokeWidth={2.5} />
          </button>
          <span
            onPointerDown={startRotate}
            title={t("overlay.rotateTooltip")}
            className="absolute -top-5 left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border border-white bg-brand-500 shadow"
          />
          {ov.type === "line" ? (
            <span
              onPointerDown={startLineResize}
              className="absolute -right-1 top-1/2 size-3 -translate-y-1/2 cursor-ew-resize rounded-sm border border-white bg-brand-500 shadow"
            />
          ) : (
            CORNERS.map((c) => (
              <span
                key={c}
                onPointerDown={(e) => startResize(e, c)}
                className={cn(
                  "absolute size-3 rounded-sm border border-white bg-brand-500 shadow",
                  c === "nw" && "-left-1 -top-1 cursor-nwse-resize",
                  c === "ne" && "-right-1 -top-1 cursor-nesw-resize",
                  c === "sw" && "-bottom-1 -left-1 cursor-nesw-resize",
                  c === "se" && "-bottom-1 -right-1 cursor-nwse-resize",
                )}
              />
            ))
          )}
        </>
      ) : null}
    </div>
  );
}

function listen(move: (ev: PointerEvent) => void) {
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
