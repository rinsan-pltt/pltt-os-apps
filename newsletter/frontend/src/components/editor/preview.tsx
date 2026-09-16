"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BlockView } from "./block-view";
import { OVERLAY_MIME, type OverlayPayload } from "./component-picker";
import { OverlayLayer } from "./overlay-layer";
import { BrandBand } from "./brand-band";
import { useT } from "../../lib/i18n";
import { getPageSize, PX_PER_MM } from "../../lib/page-sizes";
import { paginate } from "../../lib/paginate";
import { PAGE } from "../../lib/typography";
import type {
  ColorScheme,
  NewsletterBlock,
  Overlay,
  RenderedTemplate,
  TemplateRule,
} from "../../lib/types";

function pickBrand(
  items: RenderedTemplate[],
  pageIndex: number,
  total: number,
): RenderedTemplate | undefined {
  const isFirst = pageIndex === 0;
  const isOdd = (pageIndex + 1) % 2 === 1;
  const order: TemplateRule[] = isFirst
    ? ["first", isOdd ? "odd" : "even", "all"]
    : [isOdd ? "odd" : "even", "subsequent", "all"];
  for (const rule of order) {
    const t = items.find((x) => x.rule === rule);
    if (t) return t;
  }
  return undefined;
}

function substPage(html: string, pageIndex: number, total: number): string {
  return html.replace(/__NUM__/g, String(pageIndex + 1)).replace(/__TOTAL__/g, String(total));
}

const PAD = Math.round(PAGE.paddingMM * PX_PER_MM); // 12mm
const MASTHEAD = 50; // reserved height for the page-1 branded masthead
const FOOTER = Math.round(PAGE.footerMM * PX_PER_MM); // 6mm
const GAP = 6; // vertical gap between blocks
const BASELINE = 8; // modular baseline grid for vertical rhythm

export function Preview({
  blocks,
  activeId,
  cs,
  onSelect,
  onUpdate,
  overlays,
  activeOverlayId,
  onOverlaySelect,
  onOverlayUpdate,
  onOverlayRemove,
  pageSize,
  onOversizeChange,
  showPageNumbers = true,
  onEditImage,
  onDropOverlay,
  onSetImage,
  zoom = 1,
  brandHeaders = [],
  brandFooters = [],
  activeBrandEl,
  onBrandElSelect,
  onBrandElCommit,
}: {
  blocks: NewsletterBlock[];
  activeId: string | null;
  cs: ColorScheme;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<NewsletterBlock>) => void;
  overlays: Overlay[];
  activeOverlayId: string | null;
  onOverlaySelect: (id: string | null) => void;
  onOverlayUpdate: (id: string, patch: Partial<Overlay>) => void;
  onOverlayRemove: (id: string) => void;
  pageSize: string;
  onOversizeChange?: (ids: string[]) => void;
  showPageNumbers?: boolean;
  onEditImage?: (id: string) => void;
  onDropOverlay?: (payload: OverlayPayload, xPct: number, yPct: number) => void;
  onSetImage?: (blockId: string, slot: number) => void;
  zoom?: number;
  brandHeaders?: RenderedTemplate[];
  brandFooters?: RenderedTemplate[];
  activeBrandEl?: { tplId: string; elId: string; pageIndex: number } | null;
  onBrandElSelect?: (tplId: string, elId: string, pageIndex: number) => void;
  onBrandElCommit?: (tplId: string, elId: string, html: string) => void;
}) {
  const ordered = useMemo(
    () => [...blocks].sort((a, b) => a.order - b.order),
    [blocks],
  );
  const ps = getPageSize(pageSize);
  const pageW = Math.round(ps.wmm * PX_PER_MM);
  const pageH = Math.round(ps.hmm * PX_PER_MM);
  const contentW = pageW - 2 * PAD;

  const measureRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [rawHeights, setRawHeights] = useState<number[]>([]);

  // Measure only when content actually changes, not on every keystroke that
  // only touches selection state. Snap to baseline grid for vertical rhythm.
  const heights = useMemo(() => rawHeights.map(roundToBaseline), [rawHeights]);

  const measureKey = useMemo(
    () =>
      ordered
        .map((b) => `${b.id}:${b.layout}:${b.title}:${b.summary}:${b.content}`)
        .join("|") + `:${pageSize}`,
    [ordered, pageSize],
  );

  useLayoutEffect(() => {
    const hs = ordered.map(
      (_, i) => measureRefs.current[i]?.offsetHeight ?? 0,
    );
    setRawHeights((prev) =>
      prev.length === hs.length && prev.every((v, i) => v === hs[i])
        ? prev
        : hs,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey]);

  const pageCap = pageH - 2 * PAD - FOOTER;
  const { pages, oversizeIds } = useMemo(
    () =>
      paginate({
        blocks: ordered,
        heights,
        pageCap,
        firstPageReserved: MASTHEAD,
        gap: GAP,
      }),
    [ordered, heights, pageCap],
  );

  useLayoutEffect(() => {
    onOversizeChange?.(oversizeIds);
  }, [oversizeIds, onOversizeChange]);

  // Scroll the active block into view when it changes.
  const activeRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!activeId || lastScrolledFor.current === activeId) return;
    lastScrolledFor.current = activeId;
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const t = useT();

  function clearSelection(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onSelect("");
      onOverlaySelect(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(OVERLAY_MIME);
    if (!raw || !onDropOverlay) return;
    let payload: OverlayPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;
    onDropOverlay(payload, Math.max(0, Math.min(96, xPct)), Math.max(0, Math.min(96, yPct)));
  }

  return (
    <div className="h-full overflow-auto bg-surface-2 p-8 scroll-thin">
      {/* hidden measurer — same content width as the real pages */}
      <div
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0"
        style={{ width: contentW }}
      >
        {ordered.map((b, i) => (
          <div
            key={b.id}
            style={{ marginBottom: GAP }}
            ref={(el) => {
              measureRefs.current[i] = el;
            }}
          >
            <BlockView
              block={b}
              active={false}
              cs={cs}
              onSelect={() => {}}
              onUpdate={() => {}}
            />
          </div>
        ))}
      </div>

      {/* Sizing wrapper for the scrollport, kept SEPARATE from the print root so
          the nodes print-export.ts clones keep exactly the classes they had.

          A page wider than this column (A4 at 100% zoom needs ~794px, and the
          column is narrower than that whenever the app sidebar is expanded) was
          centred by `items-center` alone, which overflows in BOTH directions —
          and a scroll container cannot scroll to negative, so the left edge of
          the page became unreachable. `w-fit` grows this box to the widest page
          so the overflow is all on the scrollable side; `min-w-full` floors it
          at the column width so pages still centre when they do fit. */}
      <div className="flex w-fit min-w-full flex-col">
      {/* data-nl-print-* are the hooks print-export.ts clones for PDF export:
          these page nodes are the exact thing the user sees, so cloning them is
          what makes the PDF paginate identically. */}
      <div
        data-nl-print-root
        className="flex flex-col items-center gap-6"
        style={{ zoom } as React.CSSProperties}
      >
        {pages.map((page) => {
          const bh = pickBrand(brandHeaders, page.index, pages.length);
          // scroll-margin-top on a page's first block so scrollIntoView("nearest")
          // never scrolls the brand header above it out of view — best-effort
          // height for the built-in fallback masthead (no BrandTemplate) since
          // that one isn't measured.
          const headerH = bh?.height ?? (page.isFirst ? 56 : 32);
          return (
          <div
            key={page.index}
            data-nl-page
            className="relative shrink-0 overflow-hidden rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.12)] ring-1 ring-black/5 dark:ring-white/10"
            style={{
              width: pageW,
              height: pageH,
              background: cs.bg,
              padding: PAD,
            }}
            onClick={clearSelection}
            onDragOver={page.isFirst ? (e) => e.preventDefault() : undefined}
            onDrop={page.isFirst ? handleDrop : undefined}
          >
            {(() => {
              if (bh) {
                return (
                  <div className="mb-4">
                    <BrandBand
                      tpl={bh}
                      pageIndex={page.index}
                      total={pages.length}
                      activeElId={
                        activeBrandEl?.tplId === bh.id &&
                        activeBrandEl?.pageIndex === page.index
                          ? activeBrandEl.elId
                          : null
                      }
                      onSelectEl={(t, e) => onBrandElSelect?.(t, e, page.index)}
                      onCommitEl={(t, e, html) => onBrandElCommit?.(t, e, html)}
                    />
                  </div>
                );
              }
              return page.isFirst ? (
                <div
                  className="mb-4 flex items-end justify-between border-b pb-2"
                  style={{ borderColor: `${cs.accent}33` }}
                >
                  <span className="text-base font-bold tracking-tight" style={{ color: cs.title }}>
                    {t("preview.newsletterLabel")}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em]" style={{ color: cs.accent }}>
                    {t(`pageSize.${ps.key}`)}
                  </span>
                </div>
              ) : (
                <div
                  className="mb-3 border-b pb-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ borderColor: `${cs.accent}22`, color: cs.accent }}
                >
                  {t("preview.newsletterLabel")}
                </div>
              );
            })()}

            <div style={{ display: "flex", flexDirection: "column", gap: GAP }}>
              {page.blocks.map(({ block: b, oversize }, i) => {
                const isActive = b.id === activeId;
                return (
                  <div
                    key={b.id}
                    ref={isActive ? activeRef : undefined}
                    className="relative"
                    style={i === 0 ? { scrollMarginTop: headerH } : undefined}
                  >
                    {oversize ? (
                      <div
                        data-nl-noprint
                        title={t("preview.oversizeHint")}
                        className="absolute -right-1 -top-1 z-10 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow"
                      >
                        {t("preview.oversizeBadge")}
                      </div>
                    ) : null}
                    <BlockView
                      block={b}
                      active={isActive}
                      cs={cs}
                      onSelect={() => onSelect(b.id)}
                      onUpdate={(patch) => onUpdate(b.id, patch)}
                      onSetImage={(slot) => onSetImage?.(b.id, slot)}
                    />
                  </div>
                );
              })}
            </div>

            {page.isFirst ? (
              <OverlayLayer
                overlays={overlays}
                activeId={activeOverlayId}
                onSelect={onOverlaySelect}
                onUpdate={onOverlayUpdate}
                onRemove={onOverlayRemove}
                onEditImage={onEditImage}
              />
            ) : null}

            {(() => {
              const bf = pickBrand(brandFooters, page.index, pages.length);
              if (bf) {
                return (
                  <div className="absolute bottom-3 left-8 right-8">
                    <BrandBand
                      tpl={bf}
                      pageIndex={page.index}
                      total={pages.length}
                      activeElId={
                        activeBrandEl?.tplId === bf.id &&
                        activeBrandEl?.pageIndex === page.index
                          ? activeBrandEl.elId
                          : null
                      }
                      onSelectEl={(t, e) => onBrandElSelect?.(t, e, page.index)}
                      onCommitEl={(t, e, html) => onBrandElCommit?.(t, e, html)}
                    />
                  </div>
                );
              }
              return (
                <div
                  className="absolute bottom-2 left-8 right-8 flex items-center justify-between text-[10px]"
                  style={{ color: `${cs.body}99` }}
                >
                  <span className="truncate">{""}</span>
                  {showPageNumbers ? (
                    <span className="shrink-0 font-medium" style={{ color: cs.accent }}>
                      {page.index + 1} / {pages.length}
                    </span>
                  ) : null}
                </div>
              );
            })()}
          </div>
          );
        })}
      </div>
      </div>
    </div>
  );

  function roundToBaseline(n: number): number {
    if (n <= 0) return 0;
    return Math.max(BASELINE, Math.ceil(n / BASELINE) * BASELINE);
  }
}
