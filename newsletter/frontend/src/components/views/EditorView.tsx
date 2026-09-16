"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlatform } from "@palettelab/sdk";
import { BlockList } from "../editor/block-list";
import { ActiveEditorProvider } from "../editor/active-editor";
import { ThemeHighlightsProvider } from "../editor/theme-highlights";
import { ComponentPicker, type OverlayPayload } from "../editor/component-picker";
import { EditorTopBar } from "../editor/editor-top-bar";
import { FormattingToolbar } from "../editor/formatting-toolbar";
import { ImageModal } from "../editor/image-modal";
import { LayoutPicker } from "../editor/layout-picker";
import { PoseModal } from "../editor/pose-modal";
import { Preview } from "../editor/preview";
import { Spinner } from "../ui/primitives";
import { useToast } from "../ui/toast";
import {
  downloadExport,
  getNewsletter,
  listBrandThemes,
  renderBrand,
  updateNewsletter,
} from "../../lib/api-client";
import { autoSplitOversize, splitBlock } from "../../lib/auto-split";
import { nextExportStem } from "../../lib/export-filename";
import { printPreviewPdf } from "../../lib/print-export";
import { DEFAULT_HIGHLIGHTS } from "../../lib/highlights";
import { useT } from "../../lib/i18n";
import { DEFAULT_PAGE_SIZE, getPageSize, PX_PER_MM } from "../../lib/page-sizes";
import type {
  BrandTheme,
  Mascot,
  Newsletter,
  NewsletterBlock,
  NewsletterLayout,
  Overlay,
  RenderedTemplate,
} from "../../lib/types";

const AUTO_SPLIT_TARGET_CHARS = 480;

export function EditorView({ id, onBack }: { id: string; onBack: () => void }) {
  const { apiFetch } = usePlatform();
  const toast = useToast();

  const [nl, setNl] = useState<Newsletter | null>(null);
  const [missing, setMissing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeOverlayId, setActiveOverlayId] = useState<string | null>(null);
  const [poseTarget, setPoseTarget] = useState<{
    mascot: Mascot;
    coords?: { xPct: number; yPct: number };
  } | null>(null);
  const [imageOverlayId, setImageOverlayId] = useState<string | null>(null);
  const [imageBlockTarget, setImageBlockTarget] = useState<{
    blockId: string;
    slot: number;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [brandHeaders, setBrandHeaders] = useState<RenderedTemplate[]>([]);
  const [brandFooters, setBrandFooters] = useState<RenderedTemplate[]>([]);
  const [activeBrandEl, setActiveBrandEl] = useState<{
    tplId: string;
    elId: string;
    pageIndex: number;
  } | null>(null);
  const [themes, setThemes] = useState<BrandTheme[]>([]);
  const [exporting, setExporting] = useState<"pdf" | "html" | null>(null);

  const t = useT();

  useEffect(() => {
    listBrandThemes(apiFetch).then(setThemes).catch(() => {});
  }, [apiFetch]);

  // render the newsletter's own theme snapshot's header/footer templates
  useEffect(() => {
    if (!nl) return;
    let cancelled = false;
    const snap = nl.themeSnapshot;
    renderBrand(apiFetch, nl.title, snap.palette, snap.headers, snap.footers, nl.createdAt)
      .then((r) => {
        if (!cancelled) {
          setBrandHeaders(r.headers);
          setBrandFooters(r.footers);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nl?.title, nl?.themeSnapshot]);

  useEffect(() => {
    getNewsletter(apiFetch, id)
      .then((d) => {
        setNl(d);
        setActiveId(d.blocks[0]?.id ?? null);
      })
      .catch(() => setMissing(true));
  }, [apiFetch, id]);

  const patchNl = useCallback((patch: Partial<Newsletter>) => {
    setNl((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const updateBlock = useCallback(
    (blockId: string, patch: Partial<NewsletterBlock>) => {
      setNl((prev) =>
        prev
          ? {
              ...prev,
              blocks: prev.blocks.map((b) =>
                b.id === blockId ? { ...b, ...patch } : b,
              ),
            }
          : prev,
      );
      setDirty(true);
    },
    [],
  );

  const moveBlock = useCallback((blockId: string, dir: -1 | 1) => {
    setNl((prev) => {
      if (!prev) return prev;
      const ordered = [...prev.blocks].sort((a, b) => a.order - b.order);
      const i = ordered.findIndex((b) => b.id === blockId);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= ordered.length) return prev;
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      const reindexed = ordered.map((b, idx) => ({ ...b, order: idx }));
      return { ...prev, blocks: reindexed };
    });
    setDirty(true);
  }, []);

  const addBlock = useCallback(() => {
    setNl((prev) => {
      if (!prev) return prev;
      const newBlock: NewsletterBlock = {
        id: `blk-new-${Math.random().toString(36).slice(2, 7)}`,
        order: prev.blocks.length,
        layout: "single_column",
        title: t("edit.seedBlockTitle"),
        summary: t("edit.seedBlockSummary"),
        content: t("edit.seedBlockContent"),
        citations: [],
      };
      setActiveId(newBlock.id);
      return { ...prev, blocks: [...prev.blocks, newBlock] };
    });
    setDirty(true);
  }, [t]);

  const deleteBlock = useCallback(
    (blockId: string) => {
      setNl((prev) =>
        prev
          ? {
              ...prev,
              blocks: prev.blocks
                .filter((b) => b.id !== blockId)
                .map((b, idx) => ({ ...b, order: idx })),
            }
          : prev,
      );
      setActiveId((cur) => (cur === blockId ? null : cur));
      setDirty(true);
    },
    [],
  );

  const setLayout = useCallback(
    (key: NewsletterBlock["layout"]) => {
      if (activeId) updateBlock(activeId, { layout: key });
    },
    [activeId, updateBlock],
  );

  const toggleForceBreak = useCallback(
    (blockId: string) => {
      setNl((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          blocks: prev.blocks.map((b) =>
            b.id === blockId
              ? { ...b, forcePageBreak: !b.forcePageBreak }
              : b,
          ),
        };
      });
      setDirty(true);
    },
    [],
  );

  const manualSplit = useCallback((blockId: string) => {
    setNl((prev) => {
      if (!prev) return prev;
      const ordered = [...prev.blocks].sort((a, b) => a.order - b.order);
      const idx = ordered.findIndex((b) => b.id === blockId);
      if (idx === -1) return prev;
      const target = ordered[idx];
      const split = splitBlock(target, AUTO_SPLIT_TARGET_CHARS, makeBlockId);
      if (!split) return prev;
      ordered.splice(idx, 1, split.head, split.tail);
      const reindexed = ordered.map((b, i) => ({ ...b, order: i }));
      setActiveId(split.tail.id);
      return { ...prev, blocks: reindexed };
    });
    setDirty(true);
  }, []);

  // Track oversize blocks reported by Preview, and react by auto-splitting.
  const oversizeRef = useRef<string[]>([]);
  const onOversizeChange = useCallback((ids: string[]) => {
    oversizeRef.current = ids;
  }, []);

  // Debounced auto-split: when oversize ids stabilize, attempt to split once.
  useEffect(() => {
    if (oversizeRef.current.length === 0) return;
    const handle = window.setTimeout(() => {
      setNl((prev) => {
        if (!prev) return prev;
        const ordered = [...prev.blocks].sort((a, b) => a.order - b.order);
        const next = autoSplitOversize(
          ordered,
          oversizeRef.current,
          AUTO_SPLIT_TARGET_CHARS,
          makeBlockId,
        );
        if (!next) return prev;
        setDirty(true);
        return { ...prev, blocks: next };
      });
    }, 350);
    return () => window.clearTimeout(handle);
    // Re-check whenever blocks change.
  }, [nl?.blocks]);

  const setTheme = useCallback(
    (themeId: string) => {
      const t = themes.find((x) => x.id === themeId);
      if (!t) return;
      patchNl({
        brandThemeId: t.id,
        themeSnapshot: {
          themeId: t.id,
          themeName: t.name,
          palette: t.palette,
          typography: t.typography,
          headers: t.headers,
          footers: t.footers,
        },
      });
    },
    [themes, patchNl],
  );

  const patchLayout = useCallback((patch: Partial<NewsletterLayout>) => {
    setNl((prev) =>
      prev ? { ...prev, layout: { ...prev.layout, ...patch } } : prev,
    );
    setDirty(true);
  }, []);

  const setPageSize = useCallback(
    (key: string) => patchLayout({ pageSize: key }),
    [patchLayout],
  );

  const updateThemeElement = useCallback(
    (tplId: string, elId: string, html: string) => {
      setNl((prev) => {
        if (!prev) return prev;
        const patchBand = (bands: typeof prev.themeSnapshot.headers) =>
          bands.map((b) =>
            b.id === tplId
              ? {
                  ...b,
                  elements: b.elements.map((e) =>
                    e.id === elId ? { ...e, text: html, literal: true } : e,
                  ),
                }
              : b,
          );
        return {
          ...prev,
          themeSnapshot: {
            ...prev.themeSnapshot,
            headers: patchBand(prev.themeSnapshot.headers),
            footers: patchBand(prev.themeSnapshot.footers),
          },
        };
      });
      setDirty(true);
    },
    [],
  );

  const regenerate = useCallback(() => {
    if (!activeId) return;
    setNl((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.map((b) => {
          if (b.id !== activeId) return b;
          const cite = b.citations[0];
          return {
            ...b,
            summary: `<mark>${t("edit.regenPrefix")}</mark> ${stripMarks(b.summary)}`.slice(0, 120),
            content: cite
              ? `${cite.snippet} ${t("edit.regenWithCitation")}`
              : `${b.content} ${t("edit.regenFallbackSuffix")}`,
          };
        }),
      };
    });
    setDirty(true);
  }, [activeId, t]);

  const createOverlay = useCallback(
    (payload: OverlayPayload, pos?: { xPct: number; yPct: number }) => {
      const newId = `ov-${Math.random().toString(36).slice(2, 8)}`;
      setNl((prev) => {
        if (!prev) return prev;
        const accent = prev.themeSnapshot?.palette?.accent ?? "#0f172a";
        const base = {
          id: newId,
          rotation: 0,
          xPct: pos?.xPct ?? 45,
          yPct: pos?.yPct ?? 14,
        };
        let ov: Overlay;
        if (payload.type === "text") {
          ov = { ...base, type: "text", content: `<p>${t("edit.seedOverlayText")}</p>`, wPct: 30, hPct: 9, color: "#0f172a", bgColor: "transparent" };
        } else if (payload.type === "line") {
          ov = { ...base, type: "line", wPct: 40, strokeWidth: 2, color: accent };
        } else if (payload.type === "image") {
          ov = { ...base, type: "image", imageUrl: payload.imageUrl, wPct: 24, hPct: 18 };
        } else {
          ov = { ...base, type: "mascot", imageUrl: payload.imageUrl, wPct: 20 };
        }
        return { ...prev, overlays: [...prev.overlays, ov] };
      });
      setActiveOverlayId(newId);
      setDirty(true);
      if (payload.type === "image" && !payload.imageUrl) setImageOverlayId(newId);
    },
    [t],
  );

  const updateOverlay = useCallback((id: string, patch: Partial<Overlay>) => {
    setNl((prev) =>
      prev
        ? {
            ...prev,
            overlays: prev.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          }
        : prev,
    );
    setDirty(true);
  }, []);

  const removeOverlay = useCallback((id: string) => {
    setNl((prev) =>
      prev ? { ...prev, overlays: prev.overlays.filter((o) => o.id !== id) } : prev,
    );
    setActiveOverlayId((cur) => (cur === id ? null : cur));
    setDirty(true);
  }, []);

  const onDropOverlay = useCallback(
    (payload: OverlayPayload, xPct: number, yPct: number) => {
      // dropping a mascot opens the pose modal; the posed image is placed at
      // the drop spot once generation completes.
      if (payload.type === "mascot" && payload.mascotId) {
        setPoseTarget({
          mascot: { id: payload.mascotId, name: "", imageUrl: payload.imageUrl ?? "", createdAt: "" },
          coords: { xPct, yPct },
        });
        return;
      }
      createOverlay(payload, { xPct, yPct });
    },
    [createOverlay],
  );

  async function save() {
    if (!nl) return;
    setSaving(true);
    const updated = await updateNewsletter(apiFetch, nl.id, {
      title: nl.title,
      blocks: nl.blocks,
      brandThemeId: nl.brandThemeId,
      themeSnapshot: nl.themeSnapshot,
      overlays: nl.overlays,
      layout: nl.layout,
      status: "ready",
    });
    setNl(updated);
    setDirty(false);
    setSaving(false);
  }

  async function handleExport(format: "pdf" | "html") {
    if (!nl) return;
    if (dirty) await save();
    // PDF rendering runs server-side and can take a few seconds; hold a busy
    // state so the menu disables instead of looking like nothing happened.
    setExporting(format);
    try {
      if (format === "html") {
        await downloadExport(apiFetch, nl.id, "html", nl.title);
      } else {
        // PDF goes through the browser's print pipeline so the output matches
        // this preview exactly — same engine, same CSS. If the host sandbox
        // blocks printing, fall back to the server-rendered PDF, which is
        // laid out by a different engine and so won't paginate identically.
        try {
          const ps = getPageSize(nl.layout?.pageSize);
          await printPreviewPdf({
            widthPx: Math.round(ps.wmm * PX_PER_MM),
            heightPx: Math.round(ps.hmm * PX_PER_MM),
            // Chrome seeds the Save-as-PDF filename from the printed document's
            // title, so give it the same numbered stem the direct downloads use.
            title: nextExportStem(nl.id, nl.title),
          });
        } catch {
          await downloadExport(apiFetch, nl.id, "pdf", nl.title);
          toast.info(t("edit.exportPrintFallback"));
        }
      }
    } catch (err) {
      toast.error(t("edit.exportFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExporting(null);
    }
  }

  const activeBlock = useMemo(
    () => nl?.blocks.find((b) => b.id === activeId) ?? null,
    [nl, activeId],
  );

  if (missing) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="text-sm text-fg-muted">{t("edit.notFound")}</p>
      </div>
    );
  }

  if (!nl) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  const highlights = nl.themeSnapshot.palette?.highlights ?? DEFAULT_HIGHLIGHTS;

  return (
    <ActiveEditorProvider>
    <ThemeHighlightsProvider value={highlights}>
    <div
      className="flex h-full flex-col"
      style={{ "--hl-default": highlights[0] } as React.CSSProperties}
    >
      <EditorTopBar
        title={nl.title}
        onTitleChange={(v) => patchNl({ title: v })}
        status={nl.status}
        dirty={dirty}
        saving={saving}
        pageSize={nl.layout?.pageSize ?? DEFAULT_PAGE_SIZE}
        onPageSize={setPageSize}
        zoom={zoom}
        onZoom={setZoom}
        onSave={save}
        onExport={handleExport}
        exporting={exporting}
        onBack={onBack}
      />
      <div className="grid flex-1 grid-cols-[16rem_18rem_1fr] overflow-hidden">
        <div className="border-r border-border bg-surface">
          <BlockList
            blocks={[...nl.blocks].sort((a, b) => a.order - b.order)}
            activeId={activeId}
            onSelect={(bid) => setActiveId(bid || null)}
            onMove={moveBlock}
            onAdd={addBlock}
            onDelete={deleteBlock}
            onToggleForceBreak={toggleForceBreak}
            onSplit={manualSplit}
          />
        </div>
        <div className="overflow-y-auto border-r border-border bg-surface scroll-thin">
          <LayoutPicker
            activeBlock={activeBlock}
            onSetLayout={setLayout}
            themes={themes}
            activeThemeId={nl.brandThemeId}
            onSetTheme={setTheme}
            onRegenerate={regenerate}
          />
          <ComponentPicker onPlace={createOverlay} onPose={(m) => setPoseTarget({ mascot: m })} />
        </div>
        <div className="flex min-w-0 flex-col overflow-hidden">
          <FormattingToolbar />
          <div className="min-h-0 flex-1">
        <Preview
          blocks={nl.blocks}
          activeId={activeId}
          cs={{ name: nl.themeSnapshot.themeName, ...nl.themeSnapshot.palette }}
          onSelect={(bid) => {
            setActiveId(bid || null);
            setActiveBrandEl(null);
          }}
          onUpdate={updateBlock}
          overlays={nl.overlays}
          activeOverlayId={activeOverlayId}
          onOverlaySelect={setActiveOverlayId}
          onOverlayUpdate={updateOverlay}
          onOverlayRemove={removeOverlay}
          onEditImage={setImageOverlayId}
          onDropOverlay={onDropOverlay}
          onSetImage={(blockId, slot) => setImageBlockTarget({ blockId, slot })}
          pageSize={nl.layout?.pageSize ?? DEFAULT_PAGE_SIZE}
          onOversizeChange={onOversizeChange}
          showPageNumbers={nl.layout?.showPageNumbers ?? true}
          zoom={zoom}
          brandHeaders={brandHeaders}
          brandFooters={brandFooters}
          activeBrandEl={activeBrandEl}
          onBrandElSelect={(tplId, elId, pageIndex) => {
            setActiveId(null);
            setActiveOverlayId(null);
            setActiveBrandEl({ tplId, elId, pageIndex });
          }}
          onBrandElCommit={updateThemeElement}
        />
          </div>
        </div>
      </div>

      {poseTarget ? (
        <PoseModal
          mascot={poseTarget.mascot}
          onClose={() => setPoseTarget(null)}
          onDone={(url) => {
            createOverlay({ type: "mascot", imageUrl: url }, poseTarget.coords);
            setPoseTarget(null);
          }}
        />
      ) : null}

      {imageOverlayId ? (
        <ImageModal
          initialUrl={nl.overlays.find((o) => o.id === imageOverlayId)?.imageUrl || undefined}
          onClose={() => setImageOverlayId(null)}
          onDone={(url) => {
            updateOverlay(imageOverlayId, { imageUrl: url });
            setImageOverlayId(null);
          }}
        />
      ) : null}

      {imageBlockTarget ? (
        <ImageModal
          initialUrl={
            nl.blocks.find((b) => b.id === imageBlockTarget.blockId)?.images?.[
              imageBlockTarget.slot
            ] || undefined
          }
          onClose={() => setImageBlockTarget(null)}
          onDone={(url) => {
            const { blockId, slot } = imageBlockTarget;
            const block = nl.blocks.find((b) => b.id === blockId);
            const images = setSlot(block?.images, slot, url);
            updateBlock(blockId, { images });
            setImageBlockTarget(null);
          }}
        />
      ) : null}
    </div>
    </ThemeHighlightsProvider>
    </ActiveEditorProvider>
  );
}

function stripMarks(s: string): string {
  return s.replace(/<\/?(mark|strong|em)>/g, "");
}

function makeBlockId(): string {
  return `blk-${Math.random().toString(36).slice(2, 8)}`;
}

function setSlot(arr: string[] | undefined, slot: number, url: string): string[] {
  const next = [...(arr ?? [])];
  while (next.length <= slot) next.push("");
  next[slot] = url;
  return next;
}
