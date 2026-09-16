"use client";

import { RichText } from "./rich-text";
import { useT } from "../../lib/i18n";
import type { RenderedElement, RenderedTemplate } from "../../lib/types";

const JUSTIFY: Record<string, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

function substPage(html: string, pageIndex: number, total: number): string {
  return html
    .replace(/__NUM__/g, String(pageIndex + 1))
    .replace(/__TOTAL__/g, String(total));
}

export function BrandBand({
  tpl,
  pageIndex,
  total,
  activeElId,
  onSelectEl,
  onCommitEl,
}: {
  tpl: RenderedTemplate;
  pageIndex: number;
  total: number;
  activeElId: string | null;
  onSelectEl: (tplId: string, elId: string) => void;
  onCommitEl: (tplId: string, elId: string, html: string) => void;
}) {
  // Legacy templates (raw Jinja, no positioned elements) — render the blob as
  // before; nothing is inline-editable.
  if (!tpl.elements || tpl.elements.length === 0) {
    return (
      <div
        dangerouslySetInnerHTML={{
          __html: substPage(tpl.html, pageIndex, total),
        }}
      />
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: tpl.height ?? 80 }}>
      {tpl.elements.map((el) => (
        <BrandElementView
          key={el.id}
          el={el}
          pageIndex={pageIndex}
          total={total}
          active={el.editable && el.id === activeElId}
          onSelect={() => onSelectEl(tpl.id, el.id)}
          onCommit={(html) => onCommitEl(tpl.id, el.id, html)}
        />
      ))}
    </div>
  );
}

function BrandElementView({
  el,
  pageIndex,
  total,
  active,
  onSelect,
  onCommit,
}: {
  el: RenderedElement;
  pageIndex: number;
  total: number;
  active: boolean;
  onSelect: () => void;
  onCommit: (html: string) => void;
}) {
  const t = useT();
  if (el.editable && active) {
    // Positioned editor box mirrors the backend text-element geometry + style.
    return (
      <div
        style={{
          position: "absolute",
          left: `${el.xPct}%`,
          top: `${el.yPct}%`,
          width: `${el.wPct}%`,
          height: el.hpx,
          transform: `rotate(${el.rotation}deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: JUSTIFY[el.align] ?? "flex-start",
          fontSize: el.fontSize,
          color: el.color,
          fontWeight: el.bold ? 700 : 400,
          textAlign: el.align,
          lineHeight: 1.15,
        }}
      >
        <RichText
          value={el.text ?? ""}
          onCommit={onCommit}
          className="w-full"
          placeholder={t("brandBand.textPlaceholder")}
        />
      </div>
    );
  }

  // Display render: exact backend html (drift-free with export). The wrapper is
  // a zero-size static node; its child is absolutely positioned in the band, and
  // the click bubbles up here to select the element.
  return (
    <div
      className={el.editable ? "cursor-text" : undefined}
      onClick={el.editable ? onSelect : undefined}
      dangerouslySetInnerHTML={{
        __html: substPage(`<div style="${el.boxStyle}">${el.html}</div>`, pageIndex, total),
      }}
    />
  );
}
