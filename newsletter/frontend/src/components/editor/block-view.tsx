"use client";

import { RichText } from "./rich-text";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import { typoFor } from "../../lib/typography";
import type { ColorScheme, NewsletterBlock } from "../../lib/types";

function tokenStyle(token: {
  size: number;
  weight: number;
  leading: number;
  tracking?: number;
}): React.CSSProperties {
  return {
    fontSize: token.size,
    fontWeight: token.weight,
    lineHeight: token.leading,
    letterSpacing: token.tracking ? `${token.tracking}em` : undefined,
  };
}

function BlockImage({
  slot,
  url,
  desc,
  accent,
  className,
  onSet,
}: {
  slot: number;
  url?: string;
  desc?: string;
  accent: string;
  className?: string;
  onSet?: (slot: number) => void;
}) {
  const t = useT();
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={desc ?? ""}
        onClick={(e) => {
          e.stopPropagation();
          onSet?.(slot);
        }}
        className={cn("w-full cursor-pointer rounded-lg object-cover", className)}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSet?.(slot);
      }}
      className={cn(
        "flex w-full items-center justify-center rounded-lg border border-dashed p-3 text-center transition-colors hover:brightness-95",
        className,
      )}
      style={{ borderColor: `${accent}66`, background: `${accent}0f` }}
    >
      <span className="text-[11px] font-medium italic" style={{ color: accent }}>
        {desc ? `+ ${desc}` : t("blockView.addImagePlaceholder")}
      </span>
    </button>
  );
}

function ReadOnly({
  html,
  className,
  style,
}: {
  html: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("richtext", className)}
      style={style}
      dangerouslySetInnerHTML={{ __html: html || "" }}
    />
  );
}

export function BlockView({
  block,
  active,
  cs,
  onSelect,
  onUpdate,
  onSetImage,
}: {
  block: NewsletterBlock;
  active: boolean;
  cs: ColorScheme;
  onSelect: () => void;
  onUpdate: (patch: Partial<NewsletterBlock>) => void;
  onSetImage?: (slot: number) => void;
}) {
  const t = useT();
  const imgs = block.images ?? [];
  const isContinuation = !!block.continuationOf;
  const typo = typoFor(block.layout);
  const contSuffix = isContinuation ? (
    <span className="ml-1 text-[11px] font-normal opacity-50">{t("blockView.continuation")}</span>
  ) : null;

  const titleEl = active ? (
    <RichText
      value={block.title}
      onCommit={(v) => onUpdate({ title: v })}
      style={{ color: cs.title, ...tokenStyle(typo.title) }}
      placeholder={t("blockView.titlePlaceholder")}
    />
  ) : (
    <div style={{ color: cs.title, ...tokenStyle(typo.title) }}>
      <span className="richtext" dangerouslySetInnerHTML={{ __html: block.title || "" }} />
      {contSuffix}
    </div>
  );

  const summaryEl = active ? (
    <RichText
      value={block.summary}
      onCommit={(v) => onUpdate({ summary: v })}
      style={{ color: cs.body, ...tokenStyle(typo.summary) }}
      placeholder={t("blockView.summaryPlaceholder")}
    />
  ) : (
    <ReadOnly html={block.summary} style={{ color: cs.body, ...tokenStyle(typo.summary) }} />
  );

  const contentEl = active ? (
    <RichText
      value={block.content}
      multiline
      onCommit={(v) => onUpdate({ content: v })}
      style={{ color: cs.body, ...tokenStyle(typo.content) }}
      placeholder={t("blockView.contentPlaceholder")}
    />
  ) : (
    <ReadOnly html={block.content} style={{ color: cs.body, ...tokenStyle(typo.content) }} />
  );

  const img = (slot: number, className: string, desc?: string) => (
    <BlockImage
      slot={slot}
      url={imgs[slot]}
      desc={desc ?? block.imageDesc}
      accent={cs.accent}
      className={className}
      onSet={onSetImage}
    />
  );

  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative cursor-text rounded-lg px-3 py-4 transition-shadow",
        active
          ? "ring-2 ring-brand-400"
          : "ring-1 ring-transparent hover:ring-border-strong",
      )}
    >
      {block.forcePageBreak ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-2 left-0 right-0 h-0.5"
          style={{ background: `${cs.accent}55` }}
        />
      ) : null}
      {block.layout === "title_only" ? (
        <div className="space-y-2 py-2 text-center">
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          <div
            className="mx-auto mt-2 h-0.5 w-16 rounded-full"
            style={{ background: cs.accent }}
          />
        </div>
      ) : block.layout === "hero_image" ? (
        <div className="space-y-3">
          {img(0, "h-32")}
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          {contentEl}
        </div>
      ) : block.layout === "two_column" ? (
        <div className="grid grid-cols-[3fr_2fr] gap-5">
          <div className="space-y-2">
            <div style={tokenStyle(typo.title)}>{titleEl}</div>
            {contentEl}
          </div>
          <div className="space-y-2 rounded-lg p-3" style={{ background: `${cs.accent}12` }}>
            <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
            {img(0, "h-20")}
          </div>
        </div>
      ) : block.layout === "feature_split" ? (
        <div
          className="space-y-2 rounded-lg border-l-4 py-3 pl-4 pr-3"
          style={{ borderColor: cs.accent, background: `${cs.accent}0d` }}
        >
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          {contentEl}
        </div>
      ) : block.layout === "sidebar" ? (
        <div className="grid grid-cols-[2fr_1fr] gap-5">
          <div className="space-y-2">
            <div style={tokenStyle(typo.title)}>{titleEl}</div>
            {contentEl}
          </div>
          <div
            className="self-start rounded-lg p-3"
            style={{ background: cs.accent, color: cs.bg, ...tokenStyle(typo.summary) }}
          >
            <ReadOnly html={block.summary} />
          </div>
        </div>
      ) : block.layout === "gallery" ? (
        <div className="space-y-3">
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((n) => (
              <div key={n}>{img(n, "h-16", t("blockView.imageSlot", { n: n + 1 }))}</div>
            ))}
          </div>
        </div>
      ) : block.layout === "text_only" ? (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1" style={tokenStyle(typo.title)}>{titleEl}</div>
            <div
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px]"
              style={{ background: `${cs.accent}14`, color: cs.body }}
            >
              {summaryEl}
            </div>
          </div>
          {contentEl}
        </div>
      ) : block.layout === "image_right" ? (
        <div className="space-y-2">
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div className="overflow-hidden">
            <div className="float-right mb-2 ml-3 w-2/5">{img(0, "h-40")}</div>
            <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
            {contentEl}
          </div>
        </div>
      ) : block.layout === "six_image_grid" ? (
        <div className="space-y-3">
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <div key={n}>{img(n, "h-16", t("blockView.imageSlot", { n: n + 1 }))}</div>
            ))}
          </div>
        </div>
      ) : block.layout === "three_across" ? (
        <div className="space-y-3">
          <div className="text-center" style={tokenStyle(typo.title)}>{titleEl}</div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((n) => (
              <div key={n}>{img(n, "h-20", t("blockView.imageSlot", { n: n + 1 }))}</div>
            ))}
          </div>
          {contentEl}
        </div>
      ) : block.layout === "image_trio" ? (
        <div className="space-y-3">
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          <div className="grid grid-cols-[3fr_2fr] gap-2">
            {img(0, "h-40", t("blockView.imageSlot", { n: 1 }))}
            <div className="grid grid-rows-2 gap-2">
              {img(1, "h-full min-h-16", t("blockView.imageSlot", { n: 2 }))}
              {img(2, "h-full min-h-16", t("blockView.imageSlot", { n: 3 }))}
            </div>
          </div>
          {contentEl}
        </div>
      ) : block.layout === "two_image_single_column" ? (
        <div className="space-y-3">
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          <div className="grid grid-cols-[2fr_3fr] gap-3">
            <div className="grid grid-rows-2 gap-2">
              {img(0, "h-24", t("blockView.imageSlot", { n: 1 }))}
              {img(1, "h-24", t("blockView.imageSlot", { n: 2 }))}
            </div>
            <div>{contentEl}</div>
          </div>
        </div>
      ) : block.layout === "banner_text" ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-slate-100">
          <div
            className="border-b px-3 py-2"
            style={{ background: `${cs.accent}1a`, borderColor: `${cs.accent}40` }}
          >
            <div style={{ ...tokenStyle(typo.title), fontWeight: 700 }}>{titleEl}</div>
            <div style={{ ...tokenStyle(typo.summary), fontSize: 12 }}>{summaryEl}</div>
          </div>
          {img(0, "h-28 rounded-none border-x-0")}
          <div className="columns-2 gap-4 p-3 text-justify">{contentEl}</div>
        </div>
      ) : block.layout === "paired_column" ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 border-r border-slate-200 pr-3">
            <div style={tokenStyle(typo.title)}>{titleEl}</div>
            <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          </div>
          <div className="pl-1" style={tokenStyle(typo.content)}>{contentEl}</div>
        </div>
      ) : (
        <div className="space-y-2">
          <div style={tokenStyle(typo.title)}>{titleEl}</div>
          <div style={tokenStyle(typo.summary)}>{summaryEl}</div>
          {contentEl}
        </div>
      )}
    </div>
  );
}
